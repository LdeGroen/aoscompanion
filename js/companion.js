import { PHASES } from "./factions.js";
import { effectiveModel, enhancementSource } from "./enhancements.js";
import { icon } from "./icons.js";
import { openModal, weaponTable as sharedWeaponTable, buildModelPopupContent } from "./modelview.js";
import * as sharedb from "./sharedb.js";

// Companion mode: het spelen van een battle met je leger.
export function renderCompanion(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.data.armies.find((a) => a.id === state.armyId);
  if (!army) return navigate("home");

  // Migratie voor data van vóór type/ward/enhancements
  army.enhancements = army.enhancements || [];
  for (const m of army.models) {
    m.type = m.type || "";
    m.ward = m.ward || "";
    m.enhancementIds = m.enhancementIds || [];
  }

  // Effectieve stats: enhancement stat improvements verwerkt
  const eff = (m) => effectiveModel(army, m);
  // Effectieve wizard/priest-levels (incl. enhancements die een caster maken)
  const wizLevel = (m) => parseInt(eff(m).model.wizardLevel) || 0;
  const prsLevel = (m) => parseInt(eff(m).model.priestLevel) || 0;

  // Spelstatus wordt op het leger bewaard zodat je app kunt verversen zonder je spel kwijt te raken.
  if (!army.game) {
    army.game = newGame();
    saveData();
  }
  const game = army.game;

  function newGame() {
    return {
      round: 1,
      stage: "deployment", // deployment (alleen vóór battleround 1) | roundSetup | turn
      firstTurn: "player", // wie heeft de eerste beurt deze ronde
      turnIndex: 0,        // 0 = eerste beurt van de ronde, 1 = tweede
      phaseIndex: 0,
      cp: 0,
      usedCommands: {},    // commandId -> true (per beurt)
      usedAbilities: {},   // abilityKey -> true (once per battle, hele spel)
      summoned: {},        // modelId -> true (manifestations die in het spel zijn)
      disabled: {},        // modelId -> true (via het units-menu uit de battle gezet)
    };
  }
  game.usedAbilities = game.usedAbilities || {}; // voor spellen gestart vóór deze feature
  game.summoned = game.summoned || {};
  game.disabled = game.disabled || {};

  // Manifestations tellen pas mee (stats, abilities) nadat ze gesummend zijn;
  // "Destroyed" haalt ze weer uit het spel tot de volgende summon. Daarnaast
  // kan ieder model via het units-menu uit de battle gezet worden.
  const isActive = (m) =>
    (m.type !== "Manifestation" || !!game.summoned[m.id]) && !game.disabled[m.id];
  const activeModels = () => army.models.filter(isActive);

  // Universal manifestation-models uit de gedeelde database: nodig om bij een
  // universal manifestation lore de spell-namen klikbaar te maken (popup van
  // het bijbehorende kaartje). Async geladen; bij binnenkomst opnieuw renderen.
  let universalManifests = null;
  if (army.manifestationLore?.universal) {
    sharedb.loadUniversalDb()
      .then(({ db }) => { universalManifests = db.models.filter((m) => m.type === "Manifestation"); rerender(); })
      .catch(() => { universalManifests = []; });
  }
  const findUniversalManifest = (name) =>
    (universalManifests || []).find((m) => m.name.toLowerCase() === String(name || "").toLowerCase());

  // Destroyed-knop op de vakjes van een gesummende manifestation
  function attachDestroyed(row, m) {
    if (m.type !== "Manifestation") return row;
    const btn = el(`<button class="danger small">${icon("skull")} Destroyed</button>`);
    btn.addEventListener("click", () => {
      delete game.summoned[m.id];
      saveData();
      rerender();
    });
    row.appendChild(btn);
    return row;
  }

  const currentTurnOwner = () =>
    game.turnIndex === 0 ? game.firstTurn : game.firstTurn === "player" ? "enemy" : "player";

  // ---------- Universal commands per phase ----------
  function commandsFor(owner, phaseKey) {
    const cmds = [];
    const add = (id, name, cost, desc, extra) => cmds.push({ id: `${owner}-${phaseKey}-${id}`, name, cost, desc, extra });
    if (phaseKey === "hero") {
      add("rally", "Rally", 1, "Roll 6 dice (+1 dice als de unit een Musician heeft). Voor iedere 4+ krijg je een rally point.");
      if (owner === "enemy") {
        add("magical-intervention", "Magical Intervention", 1, "Een wizard of priest mag casten of prayen met -1 to cast / -1 to pray.", "lores");
      }
    }
    if (phaseKey === "movement") {
      if (owner === "player") add("at-the-double", "At the Double", 1, 'Auto run 6".');
      else add("redeploy", "Redeploy", 1, 'Move een unit D6".');
    }
    if (phaseKey === "shooting") {
      if (owner === "player") add("all-out-attack", "All-out Attack", 1, "Geeft een unit +1 to hit, maar -1 op hun armour save voor de rest van de beurt.");
      else add("covering-fire", "Covering Fire", 1, "Een unit mag zijn ranged attacks maken met -1 to hit.", "ranged-minus1");
    }
    if (phaseKey === "charge") {
      if (owner === "player") add("forward-to-victory", "Forward to Victory", 1, "Reroll de charge.");
      else add("counter-charge", "Counter-charge", 2, "Charge met een unit.");
    }
    if (phaseKey === "combat") {
      add("all-out-attack", "All-out Attack", 1, "Geeft een unit +1 to hit, maar -1 op hun armour save voor de rest van de beurt.");
      add("all-out-defence", "All-out Defence", 1, "Geeft +1 op de armour save, alleen voor die attack sequence.");
    }
    if (phaseKey === "end") {
      add("power-through", "Power Through", 1, "Kies een enemy model met minder wounds dan jouw model: doe D3 mortal wounds en gebruik je move characteristic. Je mag uit combat bewegen (hoeft niet), maar mag niet met nieuwe units in combat komen.");
    }
    return cmds;
  }

  // ---------- Abilities verzamelen voor een phase ----------
  function abilitiesFor(owner, phaseKey) {
    return collectAbilities(`${owner === "player" ? "own" : "enemy"}-${phaseKey}`);
  }

  function collectAbilities(fullKey) {
    const result = [];
    for (const m of army.models) {
      if (!isActive(m)) continue; // niet-gesummende manifestations doen niet mee
      for (const ab of m.abilities) {
        if (ab.phases.includes(fullKey)) result.push({ ...ab, source: m.name, type: "model", model: m });
      }
      for (const enh of eff(m).enhancements) {
        if ((enh.phases || []).includes(fullKey)) {
          result.push({ ...enh, source: enhancementSource(enh, m.name), type: "enhancement", model: m });
        }
      }
    }
    for (const r of army.factionRules) {
      if (r.phases.includes(fullKey)) result.push({ ...r, source: "Faction rule", type: "faction" });
    }
    for (const r of army.subfactionRules) {
      if (r.phases.includes(fullKey)) result.push({ ...r, source: "Subfaction rule", type: "faction" });
    }
    return result;
  }

  function minusOneToHit(toHit) {
    const map = { "2+": "3+", "3+": "4+", "4+": "5+", "5+": "6+", "6+": "6+" };
    return map[toHit] || toHit;
  }

  // ---------- Render ----------
  const LAST_ROUND = 5; // een game duurt altijd 5 battlerounds

  function rerender() {
    app.innerHTML = "";
    window.scrollTo(0, 0);
    if (game.stage === "deployment") renderDeployment();
    else if (game.stage === "roundSetup") renderRoundSetup();
    else if (game.stage === "gameOver") renderGameOver();
    else renderTurn();
  }

  // ---------- Modal (model-popup en units-menu) ----------
  // Maakt een rij/kaart klikbaar om de model-popup te openen
  // (klikken op een knop erin blijft gewoon de knop bedienen).
  function makeClickable(node, m) {
    node.classList.add("clickable");
    node.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      showModelPopup(m);
    });
    return node;
  }

  // Popup met alle informatie van één model, met enhancements van het leger
  // verwerkt (✦). Gebruikt de gedeelde popup (zie modelview.js).
  function showModelPopup(m) {
    const extraTag = isActive(m) ? "" : (m.type === "Manifestation" ? "Niet gesummend" : "Uit de battle");
    openModal(buildModelPopupContent(m, { el, esc, army, extraTag }), el);
  }

  // Units-menu: alle models in één lijst — klik voor de popup, of zet een
  // unit uit/aan zodat hij uit de battle verdwijnt of weer meedoet.
  function showUnitsMenu() {
    const wrap = el(`<div>
      <h2>Units</h2>
      <p class="subtitle">Klik op een unit voor alle informatie. Zet een unit uit (bijv. gesneuveld) om hem uit alle overzichten te halen; aanzetten brengt hem terug.</p>
      <div data-list></div>
    </div>`);
    const list = wrap.querySelector("[data-list]");

    const draw = () => {
      list.innerHTML = "";
      if (!army.models.length) list.appendChild(el(`<p class="empty">Geen models in dit leger.</p>`));
      for (const m of army.models) {
        const isManif = m.type === "Manifestation";
        const active = isActive(m);
        const row = el(`<div class="card-header" style="padding:8px 0;border-bottom:1px dashed var(--border);${active ? "" : "opacity:0.55"}">
          <span><strong>${esc(m.name)}</strong>${m.type ? ` <span class="chip tag">${esc(m.type)}</span>` : ""}</span>
          <button class="small ${active ? "" : "danger"}"></button>
        </div>`);
        const btn = row.querySelector("button");
        btn.innerHTML = isManif
          ? (active ? `${icon("skull")} Destroyed` : `${icon("zap")} Summon`)
          : (active ? `${icon("check")} In battle` : `${icon("undo")} Zet terug`);
        btn.addEventListener("click", () => {
          if (isManif) {
            if (game.summoned[m.id]) delete game.summoned[m.id];
            else { game.summoned[m.id] = true; delete game.disabled[m.id]; }
          } else {
            if (game.disabled[m.id]) delete game.disabled[m.id];
            else game.disabled[m.id] = true;
          }
          saveData();
          draw();
          rerender();
        });
        makeClickable(row, m);
        list.appendChild(row);
      }
    };
    draw();
    openModal(wrap, el);
  }

  // De belangrijkste actieknop (volgende phase / start ronde) altijd in beeld
  function bottomBar(btn) {
    const bar = el(`<div class="bottombar"></div>`);
    bar.appendChild(btn);
    app.appendChild(bar);
  }

  function topbar(subtitle) {
    const bar = el(`<div class="topbar">
      <div>
        <span class="title">${esc(army.name)}</span>
        <div class="subtitle">${esc(subtitle)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="small" id="btn-units">${icon("users")} Units</button>
        <button class="small" id="btn-endgame">${icon("flag")} Einde spel</button>
        <button class="small" id="btn-home">${icon("back")} Legers</button>
      </div>
    </div>`);
    bar.querySelector("#btn-units").addEventListener("click", showUnitsMenu);
    bar.querySelector("#btn-home").addEventListener("click", () => { saveData(); navigate("home"); });
    bar.querySelector("#btn-endgame").addEventListener("click", () => {
      if (confirm("Spel beëindigen? De spelstatus wordt gewist.")) {
        delete army.game;
        saveData();
        navigate("home");
      }
    });
    app.appendChild(bar);
  }

  // ===================== Deployment (alleen vóór battleround 1) =====================
  function renderDeployment() {
    topbar("Deployment");
    app.appendChild(el(`<h2>Deployment</h2>`));
    const abs = collectAbilities("deployment");
    if (abs.length) {
      app.appendChild(el(`<h3>Abilities tijdens deployment</h3>`));
      for (const ab of abs) app.appendChild(abilityCard(ab));
    } else {
      app.appendChild(el(`<p class="empty">Geen abilities voor de deployment.</p>`));
    }
    const nextBtn = el(`<button class="primary bigbtn">${icon("play")} Deployment klaar — naar battleround 1</button>`);
    nextBtn.addEventListener("click", () => {
      game.stage = "roundSetup";
      saveData();
      rerender();
    });
    bottomBar(nextBtn);
  }

  // ===================== Battleround set-up =====================
  function renderRoundSetup() {
    topbar(`Battleround ${game.round}`);

    // Start of Battleround: vóór de eerste beurt, niet per speler/tegenstander
    const abs = collectAbilities("startOfRound");
    if (abs.length) {
      app.appendChild(el(`<h3>Start of Battleround</h3>`));
      for (const ab of abs) app.appendChild(abilityCard(ab));
    }

    const card = el(`<div class="card">
      <h2>Battleround ${game.round} van ${LAST_ROUND}</h2>
      <label>Wie heeft deze battleround de eerste beurt?</label>
      <div class="btnrow">
        <button id="first-player" class="${game.firstTurn === "player" ? "primary" : ""}">Ik (de speler)</button>
        <button id="first-enemy" class="${game.firstTurn === "enemy" ? "primary" : ""}">De tegenstander</button>
      </div>
      <label>Met hoeveel command points begin je deze battleround?</label>
      <input type="number" id="cp-input" min="0" value="${game.round === 1 ? 4 : game.cp || 4}" />
    </div>`);
    app.appendChild(card);

    const startBtn = el(`<button class="primary bigbtn" id="btn-start">${icon("play")} Start battleround ${game.round}</button>`);
    bottomBar(startBtn);

    card.querySelector("#first-player").addEventListener("click", () => { game.firstTurn = "player"; saveData(); rerender(); });
    card.querySelector("#first-enemy").addEventListener("click", () => { game.firstTurn = "enemy"; saveData(); rerender(); });
    startBtn.addEventListener("click", () => {
      game.cp = parseInt(card.querySelector("#cp-input").value) || 0;
      game.stage = "turn";
      game.turnIndex = 0;
      game.phaseIndex = 0;
      game.usedCommands = {};
      saveData();
      rerender();
    });
  }

  // ===================== Beurt =====================
  function renderTurn() {
    const owner = currentTurnOwner();
    const phase = PHASES[game.phaseIndex];
    const ownerLabel = owner === "player" ? "Jouw beurt" : "Beurt van de tegenstander";
    topbar(`Battleround ${game.round}/${LAST_ROUND} · beurt ${game.turnIndex + 1} van 2`);

    // Sticky balk met beurt-info en command points
    const turnbar = el(`<div class="turnbar">
      <span class="who ${owner === "player" ? "player" : "enemy"}">${ownerLabel}</span>
      <div class="cp-counter">
        <span class="subtitle">CP</span>
        <button id="cp-min">−</button>
        <span class="cp">${game.cp}</span>
        <button id="cp-plus">+</button>
      </div>
    </div>`);
    turnbar.querySelector("#cp-min").addEventListener("click", () => { if (game.cp > 0) { game.cp--; saveData(); rerender(); } });
    turnbar.querySelector("#cp-plus").addEventListener("click", () => { game.cp++; saveData(); rerender(); });
    app.appendChild(turnbar);

    // Phase navigatie
    const nav = el(`<div class="phase-nav"></div>`);
    PHASES.forEach((p, i) => {
      const btn = el(`<button class="${i === game.phaseIndex ? "active" : ""}">${p.label}</button>`);
      btn.addEventListener("click", () => { game.phaseIndex = i; saveData(); rerender(); });
      nav.appendChild(btn);
    });
    app.appendChild(nav);

    app.appendChild(el(`<h2>${phase.label}</h2>`));

    // Phase-specifieke inhoud
    renderPhaseContent(owner, phase.key);

    // Abilities voor deze phase
    const abs = abilitiesFor(owner, phase.key);
    if (abs.length) {
      app.appendChild(el(`<h3>Abilities in deze phase</h3>`));
      for (const ab of abs) app.appendChild(abilityCard(ab));
    }

    // Universal commands
    const cmds = commandsFor(owner, phase.key);
    if (cmds.length) {
      app.appendChild(el(`<h3>Universal commands</h3>`));
      for (const c of cmds) app.appendChild(commandRow(c, owner));
    }

    // Volgende phase / beurt
    const isLastPhase = game.phaseIndex === PHASES.length - 1;
    const isLastRound = game.round >= LAST_ROUND;
    let nextLabel;
    if (!isLastPhase) nextLabel = `Volgende: ${PHASES[game.phaseIndex + 1].label} →`;
    else if (game.turnIndex === 0) nextLabel = `Einde beurt — start beurt van ${owner === "player" ? "de tegenstander" : "jou"} →`;
    else if (isLastRound) nextLabel = `${icon("flag")} Einde battleround ${game.round} — einde van de game`;
    else nextLabel = `Einde battleround ${game.round} — naar battleround ${game.round + 1} →`;

    const nextBtn = el(`<button class="primary bigbtn">${nextLabel}</button>`);
    nextBtn.addEventListener("click", () => {
      if (!isLastPhase) {
        game.phaseIndex++;
      } else if (game.turnIndex === 0) {
        game.turnIndex = 1;
        game.phaseIndex = 0;
        game.usedCommands = {};
      } else if (isLastRound) {
        game.stage = "gameOver";
      } else {
        game.round++;
        game.stage = "roundSetup";
      }
      saveData();
      rerender();
    });
    bottomBar(nextBtn);
  }

  // ===================== Game over (na battleround 5) =====================
  function renderGameOver() {
    topbar(`Game afgelopen`);
    app.appendChild(el(`<div class="card" style="text-align:center">
      <h2>${icon("flag", 20)} Game afgelopen</h2>
      <p class="subtitle">Alle ${LAST_ROUND} battlerounds zijn gespeeld. Goed gespeeld!</p>
    </div>`));

    const newGameBtn = el(`<button class="primary bigbtn">${icon("play")} Nieuw potje met dit leger</button>`);
    newGameBtn.addEventListener("click", () => {
      // renderCompanion maakt een verse game aan als army.game ontbreekt
      delete army.game;
      saveData();
      navigate("companion", { armyId: army.id });
    });
    app.appendChild(newGameBtn);

    const homeBtn = el(`<button class="bigbtn">${icon("back")} Terug naar mijn legers</button>`);
    homeBtn.addEventListener("click", () => {
      delete army.game;
      saveData();
      navigate("home");
    });
    app.appendChild(homeBtn);
  }

  // ---------- Phase-specifieke inhoud ----------
  function renderPhaseContent(owner, phaseKey) {
    if (phaseKey === "start") {
      app.appendChild(el(`<div class="reminder">⚑ Reminder: Place of Power gebruiken?</div>`));
    }

    if (phaseKey === "hero") renderManifestations();

    // In de tegenstander-hero-phase ook de manifestation lore tonen (met
    // klikbare spell-namen) — in jouw hero phase staat hij al bij de wizards.
    if (phaseKey === "hero" && owner === "enemy" && army.manifestationLore
        && army.models.some((m) => wizLevel(m) > 0)) {
      app.appendChild(el(`<h3>Manifestation lore</h3>`));
      app.appendChild(loreCard("Manifestation lore", army.manifestationLore, "Cast", army.manifestationLore.universal));
    }

    if (phaseKey === "hero" && owner === "player") {
      // Effectieve levels: ook een model dat via een enhancement wizard/priest
      // is geworden telt als caster.
      const casters = activeModels().filter((m) => wizLevel(m) > 0 || prsLevel(m) > 0);
      if (casters.length) {
        app.appendChild(el(`<h3>Wizards & priests</h3>`));
        for (const m of casters) {
          const roles = [];
          if (wizLevel(m) > 0) roles.push(`Wizard (${wizLevel(m)})`);
          if (prsLevel(m) > 0) roles.push(`Priest (${prsLevel(m)})`);
          const card = el(`<div class="card inner"><div class="card-header"><strong>${esc(m.name)}</strong><span class="chip tag">${roles.join(" · ")}</span></div></div>`);
          makeClickable(card, m);
          app.appendChild(card);
        }
        renderLoresDisplay();
      } else {
        app.appendChild(el(`<p class="empty">Geen models met wizard of priest level.</p>`));
      }
    }

    if (phaseKey === "movement" && owner === "player") {
      app.appendChild(el(`<h3>Movement van je units</h3>`));
      const card = el(`<div class="card"></div>`);
      for (const m of activeModels()) {
        const e = eff(m);
        const row = el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
          <span>${esc(m.name)}</span>
          <span><span class="stat" style="display:inline-block"><span class="v">${esc(e.model.move)}"${e.changed.has("move") ? "✦" : ""}</span></span>${m.fly ? ' <span class="chip tag">Fly</span>' : ""}</span>
        </div>`);
        makeClickable(row, m);
        card.appendChild(attachDestroyed(row, m));
      }
      app.appendChild(card);
    }

    if (phaseKey === "shooting" && owner === "player") {
      renderWeaponsDisplay("rangedAttacks", "Ranged attacks");
    }

    if (phaseKey === "shooting" && owner === "enemy") {
      // De tegenstander schiet: wat zijn de saves van mijn units?
      renderDefenceDisplay();
    }

    if (phaseKey === "combat") {
      // Speler-combat altijd; bij de tegenstander mogen alle melee profielen ook getoond worden
      renderDefenceDisplay();
      renderWeaponsDisplay("meleeAttacks", "Melee attacks");
    }

    if (phaseKey === "end") {
      app.appendChild(el(`<h3>Control scores</h3>`));
      const card = el(`<div class="card"></div>`);
      for (const m of activeModels()) {
        const e = eff(m);
        const total = (parseInt(e.model.control) || 0) + (parseInt(m.controlBonus) || 0);
        const row = el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
          <span>${esc(m.name)}${m.standardBearer ? ' <span class="chip tag">Standard Bearer</span>' : ""}</span>
          <span class="stat" style="display:inline-block"><span class="v">${total}${e.changed.has("control") ? "✦" : ""}</span><span class="k">control</span></span>
        </div>`);
        makeClickable(row, m);
        card.appendChild(attachDestroyed(row, m));
      }
      app.appendChild(card);
    }
  }

  // ---------- Manifestations: summonen in de hero phase ----------
  function renderManifestations() {
    const manifs = army.models.filter((m) => m.type === "Manifestation");
    if (!manifs.length) return;
    app.appendChild(el(`<h3>Manifestations</h3>`));
    const card = el(`<div class="card"></div>`);
    for (const m of manifs) {
      const summoned = !!game.summoned[m.id];
      const row = el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span>${esc(m.name)}${summoned ? ' <span class="chip tag">In het spel</span>' : ""}</span>
        <span style="display:flex;gap:6px;align-items:center">
          ${m.banishment ? `<span class="stat" style="display:inline-block"><span class="v">${esc(m.banishment)}</span><span class="k">banish</span></span>` : ""}
          <button class="small ${summoned ? "danger" : "primary"}">${summoned ? `${icon("skull")} Destroyed` : `${icon("zap")} Summoned`}</button>
        </span>
      </div>`);
      row.querySelector("button").addEventListener("click", () => {
        if (game.summoned[m.id]) delete game.summoned[m.id];
        else game.summoned[m.id] = true;
        saveData();
        rerender();
      });
      makeClickable(row, m);
      card.appendChild(row);
    }
    app.appendChild(card);
  }

  // ---------- Armour & ward saves van je eigen units ----------
  function renderDefenceDisplay() {
    app.appendChild(el(`<h3>Saves van je units</h3>`));
    const card = el(`<div class="card"></div>`);
    let anyNote = false;
    for (const m of activeModels()) {
      const e = eff(m);
      const ward = e.model.ward && e.model.ward !== "-" ? e.model.ward : "";
      anyNote = anyNote || e.changed.has("save") || e.changed.has("ward");
      const row = el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span>${esc(m.name)}</span>
        <span style="display:flex;gap:6px">
          <span class="stat" style="display:inline-block"><span class="v">${esc(e.model.health)}${e.changed.has("health") ? "✦" : ""}</span><span class="k">health</span></span>
          <span class="stat" style="display:inline-block"><span class="v">${esc(e.model.save)}${e.changed.has("save") ? "✦" : ""}</span><span class="k">save</span></span>
          ${ward ? `<span class="stat" style="display:inline-block"><span class="v">${esc(ward)}${e.changed.has("ward") ? "✦" : ""}</span><span class="k">ward</span></span>` : ""}
        </span>
      </div>`);
      makeClickable(row, m);
      card.appendChild(attachDestroyed(row, m));
    }
    if (anyNote) card.appendChild(el(`<div class="weapon-bonus">✦ = incl. enhancement</div>`));
    app.appendChild(card);
  }

  const WEAPON_STATS = new Set(["toHit", "toWound", "rend", "attacks", "damage"]);

  function renderWeaponsDisplay(key, title, toHitTransform) {
    const withWeapons = activeModels().filter((m) => m[key].length > 0);
    if (!withWeapons.length) {
      app.appendChild(el(`<p class="empty">Geen models met ${title.toLowerCase()}.</p>`));
      return;
    }
    app.appendChild(el(`<h3>${title}</h3>`));
    for (const m of withWeapons) {
      const e = eff(m);
      const card = el(`<div class="card inner">
        <div class="card-header"><strong>${esc(m.name)}</strong>${m.champion ? '<span class="chip tag">Champion</span>' : ""}</div>
        <div data-weapons></div>
      </div>`);
      makeClickable(card, m);
      attachDestroyed(card.querySelector(".card-header"), m);
      const target = card.querySelector("[data-weapons]");
      target.appendChild(weaponTable(e.model[key], toHitTransform));
      // Wapen-gerelateerde enhancement-mods als voetnoot bij de tabel
      for (const note of e.notes.filter((n) => WEAPON_STATS.has(n.stat))) {
        target.appendChild(el(`<div class="weapon-bonus">✦ ${esc(note.source)}: ${esc(note.label)} (verwerkt in de tabel)</div>`));
      }
      app.appendChild(card);
    }
  }

  const weaponTable = (weapons, toHitTransform) => sharedWeaponTable(weapons, el, esc, toHitTransform);

  function renderLoresDisplay(target = app) {
    const hasWizard = army.models.some((m) => wizLevel(m) > 0);
    const hasPriest = army.models.some((m) => prsLevel(m) > 0);
    if (hasWizard && army.spellLore) target.appendChild(loreCard("Spell lore", army.spellLore, "Cast"));
    // Bij een universal manifestation lore zijn de spells universal manifestation-models:
    // de namen worden klikbaar en openen het kaartje als popup.
    if (hasWizard && army.manifestationLore) target.appendChild(loreCard("Manifestation lore", army.manifestationLore, "Cast", army.manifestationLore.universal));
    if (hasPriest && army.prayerLore) target.appendChild(loreCard("Prayer lore", army.prayerLore, "Chant"));
  }

  function loreCard(title, lore, valuePrefix, linkManifests = false) {
    const card = el(`<div class="card inner"><h3>${title}: ${esc(lore.name)}</h3><div data-entries></div></div>`);
    const entries = card.querySelector("[data-entries]");
    for (const entry of lore.entries) {
      if (!entry.name && !entry.description) continue;
      const manif = linkManifests ? findUniversalManifest(entry.name) : null;
      const row = el(`<div class="lore-entry">
        <strong class="${manif ? "lore-link" : ""}">${esc(entry.name)}</strong> <span class="lval">${valuePrefix} ${esc(entry.value)}</span>
        <div class="subtitle">${esc(entry.description)}</div>
      </div>`);
      if (manif) {
        const name = row.querySelector("strong");
        name.addEventListener("click", () => openModal(buildModelPopupContent(manif, { el, esc }), el));
      }
      entries.appendChild(row);
    }
    return card;
  }

  function abilityCard(ab) {
    const typeClass = ab.type === "faction" ? "faction" : ab.type === "enhancement" ? "enhancement" : "";
    if (!ab.oncePerBattle) {
      const card = el(`<div class="ability ${typeClass}">
        <div class="owner">${esc(ab.source)}</div>
        <span class="aname">${esc(ab.name)}</span>
        <div class="adesc">${esc(ab.description)}</div>
      </div>`);
      if (ab.model) makeClickable(card, ab.model);
      return card;
    }
    // Once per battle: knop om hem te gebruiken; daarna doorgestreept zichtbaar
    const key = `${ab.source}|${ab.name}`;
    const used = !!game.usedAbilities[key];
    const card = el(`<div class="ability ${typeClass} ${used ? "used" : ""}">
      <div class="owner">${esc(ab.source)}</div>
      <span class="aname">${esc(ab.name)}</span>
      <span class="chip tag ${used ? "dim" : ""}">Once per battle</span>
      <div class="adesc">${esc(ab.description)}</div>
      <div class="btnrow">
        <button class="small ${used ? "" : "primary"}">${used ? `${icon("undo")} Toch niet gebruikt` : `${icon("zap")} Gebruik (once per battle)`}</button>
      </div>
    </div>`);
    card.querySelector("button").addEventListener("click", () => {
      if (game.usedAbilities[key]) delete game.usedAbilities[key];
      else game.usedAbilities[key] = true;
      saveData();
      rerender();
    });
    if (ab.model) makeClickable(card, ab.model);
    return card;
  }

  function commandRow(cmd, owner) {
    const used = !!game.usedCommands[cmd.id];
    const affordable = used || game.cp >= cmd.cost;
    const row = el(`<div class="command ${used ? "used" : ""} ${affordable ? "" : "disabled"}">
      <input type="checkbox" ${used ? "checked" : ""} ${affordable ? "" : "disabled"} />
      <div style="flex:1">
        <span class="cname">${esc(cmd.name)}</span> <span class="ccost">(${cmd.cost} CP)</span>
        <div class="cdesc">${esc(cmd.desc)}</div>
        <div data-extra></div>
      </div>
    </div>`);
    const extra = row.querySelector("[data-extra]");

    const drawExtra = () => {
      extra.innerHTML = "";
      if (!game.usedCommands[cmd.id]) return;
      if (cmd.extra === "lores") {
        // Magical Intervention: toon de lores
        const sub = el(`<div style="margin-top:8px"></div>`);
        renderLoresDisplay(sub);
        if (!sub.children.length) sub.appendChild(el(`<p class="empty">Geen lores gekozen in set-up.</p>`));
        extra.appendChild(sub);
      }
      if (cmd.extra === "ranged-minus1") {
        // Covering Fire: ranged attacks met -1 to hit
        const sub = el(`<div style="margin-top:8px"><div class="subtitle">Ranged attacks met -1 to hit toegepast:</div></div>`);
        const withRanged = activeModels().filter((m) => m.rangedAttacks.length > 0);
        if (!withRanged.length) sub.appendChild(el(`<p class="empty">Geen models met ranged attacks.</p>`));
        for (const m of withRanged) {
          const mc = el(`<div class="card inner" style="margin-top:6px"><div class="card-header"><strong>${esc(m.name)}</strong>${m.champion ? '<span class="chip tag">Champion</span>' : ""}</div></div>`);
          mc.appendChild(weaponTable(eff(m).model.rangedAttacks, minusOneToHit));
          sub.appendChild(mc);
        }
        extra.appendChild(sub);
      }
    };

    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        if (game.cp < cmd.cost) { e.target.checked = false; return; }
        game.cp -= cmd.cost;
        game.usedCommands[cmd.id] = true;
      } else {
        game.cp += cmd.cost;
        delete game.usedCommands[cmd.id];
      }
      saveData();
      rerender();
    });

    drawExtra();
    return row;
  }

  rerender();
}
