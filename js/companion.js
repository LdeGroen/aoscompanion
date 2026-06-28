import { PHASES, AOS_FACTIONS, groupByType, phaseLabel, enhancementCategoryLabel } from "./factions.js";
import { effectiveModel, enhancementSource, migrateModelEnhancements, modLabel } from "./enhancements.js";
import { icon } from "./icons.js";
import { openModal, weaponTable as sharedWeaponTable, buildModelPopupContent } from "./modelview.js";
import { filterWeapons } from "./weaponoptions.js";
import * as sharedb from "./sharedb.js";
import { loadGamedata, scoringOptionsFor, calcScores, TACTIC_STEP_POINTS } from "./battleplans.js";
import { buildGameRecord, buildScoreSummary, buildExportButtons } from "./scorecard.js";

// Companion mode: het spelen van een battle met je leger.
export function renderCompanion(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.data.armies.find((a) => a.id === state.armyId);
  if (!army) return navigate("home");

  // Migratie voor data van vóór type/ward/enhancements
  for (const m of army.models) {
    m.type = m.type || "";
    m.ward = m.ward || "";
  }
  migrateModelEnhancements(army); // enhancementIds → embedded model.enhancements

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
      stage: "battleSetup", // battleSetup | deployment | roundSetup | turn | gameOver
      firstTurn: "player", // wie heeft de eerste beurt deze ronde
      turnIndex: 0,        // 0 = eerste beurt van de ronde, 1 = tweede
      phaseIndex: 0,
      cp: 0,
      usedCommands: {},    // commandId -> true (per beurt)
      usedAbilities: {},   // abilityKey -> true (once per battle, hele spel)
      summoned: {},        // modelId -> true (manifestations die in het spel zijn)
      disabled: {},        // modelId -> true (via het units-menu uit de battle gezet)
      opponent: { name: "", faction: "", subfaction: "", models: [] },
      battleplan: null,    // snapshot van het gekozen battleplan (naam, scoring, abilities)
      tactics: [],         // snapshots van jouw 2 battle tactics + scoredRounds per stap
      enemyTactics: [],    // de 2 battle tactics van je tegenstander
      seasonalRules: [],   // snapshot van de General's Handbook seasonal rules (game-breed)
      fury: { role: "", level: 0, rage: 0 }, // GHB 2026-27 fury level + rage dice (alleen als die seasonal rules actief zijn)
      scores: { player: {}, enemy: {} }, // [side][round][optKey] = true
      liferoot: { player: 0, enemy: 0 }, // cumulatief (The Liferoots)
      endBonusOwner: "",   // wie de eindbonus pakt (Noxious Nexus)
      underdog: {},        // round -> "player" | "enemy" | "none" (vanaf ronde 2)
      firstTurnByRound: {},// round -> wie eerste beurt had (voor de scorekaart)
    };
  }
  game.usedAbilities = game.usedAbilities || {}; // voor spellen gestart vóór deze feature
  game.summoned = game.summoned || {};
  game.disabled = game.disabled || {};
  // Migratie voor potjes van vóór de battleplan-feature
  game.opponent = game.opponent || { name: "", faction: "", subfaction: "" };
  game.opponent.models = game.opponent.models || [];
  game.tactics = game.tactics || [];
  game.enemyTactics = game.enemyTactics || [];
  game.seasonalRules = game.seasonalRules || [];
  game.fury = game.fury || { role: "", level: 0, rage: 0 };
  game.scores = game.scores || { player: {}, enemy: {} };
  game.liferoot = game.liferoot || { player: 0, enemy: 0 };
  game.endBonusOwner = game.endBonusOwner || "";
  game.underdog = game.underdog || {};
  game.firstTurnByRound = game.firstTurnByRound || {};

  // Weergavemodus (per apparaat, synct bewust niet): "full" = volledige companion,
  // "score" = compacte score-modus (alleen wie eerst + per beurt scores invullen).
  let scoreMode = localStorage.getItem("aoscomp_companion_mode") === "score";
  const setScoreMode = (on) => { scoreMode = on; localStorage.setItem("aoscomp_companion_mode", on ? "score" : "full"); rerender(true); };

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
    // General's Handbook seasonal rules (game-breed, snapshot in game.seasonalRules)
    for (const r of game.seasonalRules || []) {
      if ((r.phases || []).includes(fullKey)) result.push({ ...r, source: "Seasonal rule", type: "faction" });
    }
    // Battle tactic-abilities (bv. de Hideout-setup): tonen als jij of de tegenstander de tactic heeft.
    for (const t of game.tactics || []) {
      for (const ab of t.abilities || []) if ((ab.phases || []).includes(fullKey)) result.push({ ...ab, source: `Battle tactic: ${t.name}`, type: "tactic" });
    }
    for (const t of game.enemyTactics || []) {
      for (const ab of t.abilities || []) if ((ab.phases || []).includes(fullKey)) result.push({ ...ab, source: `Battle tactic (tegenstander): ${t.name}`, type: "tactic" });
    }
    // Battleplan-abilities: optioneel beperkt tot bepaalde battlerounds en/of
    // alleen actief als jij de underdog bent.
    for (const ab of game.battleplan?.abilities || []) {
      if (!(ab.phases || []).includes(fullKey)) continue;
      if (ab.rounds?.length && !ab.rounds.includes(game.round)) continue;
      if (ab.underdogOnly && game.underdog[game.round] !== "player") continue;
      result.push({ ...ab, source: `Battleplan: ${game.battleplan.name}`, type: "battleplan" });
    }
    return result;
  }

  // ---------- Passives & blijvende effecten (buffs) ----------
  game.activeBuffs = game.activeBuffs || {}; // key -> { name, source, description, dur }
  const isPassiveAb = (ab) => /\[passive\]/i.test(ab.description || "");
  // "rest of the turn" → deze beurt; "until the start of your next turn" → tot je volgende beurt.
  const buffDuration = (ab) => {
    const d = ab.description || "";
    if (/until the start of your next turn/i.test(d)) return "nextTurn";
    if (/rest of the turn|rest of the battle round/i.test(d)) return "turn";
    return null;
  };
  // Verzamel alle (army-brede) passive abilities, ongeacht phase — voor het uitschuifblad.
  function collectPassives() {
    const out = [];
    const add = (list, source) => { for (const ab of list || []) if (isPassiveAb(ab)) out.push({ ...ab, source }); };
    add(army.factionRules, "Faction rule");
    add(army.subfactionRules, "Subfaction rule");
    add(game.seasonalRules, "Seasonal rule");
    add(game.battleplan?.abilities, `Battleplan: ${game.battleplan?.name || ""}`);
    for (const t of game.tactics || []) add(t.abilities, `Battle tactic: ${t.name}`);
    for (const t of game.enemyTactics || []) add(t.abilities, `Battle tactic (tegenstander): ${t.name}`);
    return out;
  }
  // Verlopen buffs opruimen: "turn" aan het einde van elke beurt, "nextTurn" bij een nieuwe ronde.
  function pruneBuffs(scope) {
    for (const k of Object.keys(game.activeBuffs)) {
      const b = game.activeBuffs[k];
      if (scope === "round" || (scope === "turn" && b.dur === "turn")) delete game.activeBuffs[k];
    }
  }

  function minusOneToHit(toHit) {
    const map = { "2+": "3+", "3+": "4+", "4+": "5+", "5+": "6+", "6+": "6+" };
    return map[toHit] || toHit;
  }

  // ---------- Render ----------
  const LAST_ROUND = 5; // een game duurt altijd 5 battlerounds

  // scrollTop: alleen bij echte navigatie (phase/stage-wissel) naar boven;
  // bij invullen of aanvinken blijft de scrollpositie staan.
  function rerender(scrollTop = false) {
    const y = window.scrollY;
    app.innerHTML = "";
    if (game.stage === "battleSetup") renderBattleSetup();
    else if (game.stage === "deployment") renderDeployment();
    else if (game.stage === "gameOver") renderGameOver();
    else if (scoreMode) renderScoreMode(); // score-modus vervangt roundSetup + turn
    else if (game.stage === "roundSetup") renderRoundSetup();
    else renderTurn();
    window.scrollTo(0, scrollTop ? 0 : y);
  }

  // ===================== Battle set-up (vóór deployment) =====================
  // Tegenstander en battleplan kiezen + de battle tactics van de tegenstander
  // (de jouwe komen uit je lijst). Battleplan en tactics worden als snapshot in
  // de spelstatus gezet, zodat database-wijzigingen een lopend potje niet raken.
  let gamedata = null;
  let gamedataLoaded = false;

  // Popup met de opvolgende stappen van een battle tactic.
  function showTacticSteps(t) {
    if (!t) return;
    const steps = t.steps || [];
    const wrap = el(`<div><h2>${esc(t.name)}</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    // Deployment-ability (bijv. Hideout / Fugitive): geen eigen stap, maar wel belangrijk om in te zien.
    for (const ab of t.abilities || []) {
      body.appendChild(el(`<div class="ability faction"><span class="aname">${esc(ab.name)}</span>${(ab.phases || []).includes("deployment") ? ' <span class="chip tag">Deployment</span>' : ""}<div class="adesc">${esc(ab.description || "")}</div></div>`));
    }
    if (!steps.length) body.appendChild(el(`<p class="empty">Geen stappen ingevoerd voor deze battle tactic (te bewerken in de database).</p>`));
    steps.forEach((s, i) => {
      const hasLabel = s.name && !/^stap\s*\d*$/i.test(s.name.trim());
      const heading = hasLabel ? esc(s.name) : `Stap ${i + 1}`;
      body.appendChild(el(`<div class="card inner"><div class="card-header"><h3>${heading}</h3></div>${s.description ? `<div class="muted-list">${esc(s.description)}</div>` : ""}</div>`));
    });
    openModal(wrap, el);
  }

  // Overzicht van jouw battle tactics (boven) en die van de tegenstander; klik voor de stappen.
  function showTacticsMenu() {
    const wrap = el(`<div><h2>${icon("flag")} Battle tactics</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    const section = (title, list) => {
      body.appendChild(el(`<h3 style="margin-top:10px">${esc(title)}</h3>`));
      if (!list || !list.length) { body.appendChild(el(`<p class="empty">Geen battle tactics.</p>`)); return; }
      for (const t of list) {
        const row = el(`<div class="card inner clickable" style="margin:4px 0"><div class="card-header"><strong>${esc(t.name)}</strong><span class="subtitle">stappen ›</span></div></div>`);
        row.addEventListener("click", () => showTacticSteps(t));
        body.appendChild(row);
      }
    };
    section("Jouw battle tactics", game.tactics);
    section(`Battle tactics van ${esc(game.opponent?.name || "de tegenstander")}`, game.enemyTactics);
    openModal(wrap, el);
  }

  function renderBattleSetup() {
    topbar("Battle set-up");
    if (!gamedataLoaded) {
      loadGamedata()
        .then(({ db }) => { gamedata = db; gamedataLoaded = true; rerender(); })
        .catch(() => { gamedata = null; gamedataLoaded = true; rerender(); });
      app.appendChild(el(`<p class="empty">Battleplans en battle tactics laden…</p>`));
      return;
    }

    // --- Tegenstander ---
    const opp = game.opponent;
    const oppCard = el(`<div class="card">
      <h2>Tegenstander</h2>
      <label>Naam van je tegenstander</label>
      <input type="text" id="opp-name" value="${esc(opp.name)}" placeholder="bijv. Nico" />
      <div class="row">
        <div>
          <label>Faction</label>
          <select id="opp-faction">
            <option value="">— kies faction —</option>
            ${Object.keys(AOS_FACTIONS).map((f) => `<option ${f === opp.faction ? "selected" : ""}>${esc(f)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Subfaction</label>
          <select id="opp-subfaction"></select>
        </div>
      </div>
    </div>`);
    app.appendChild(oppCard);
    const subSel = oppCard.querySelector("#opp-subfaction");
    const fillSubs = () => {
      subSel.innerHTML = `<option value="">— geen —</option>`;
      for (const s of AOS_FACTIONS[opp.faction] || []) {
        subSel.appendChild(el(`<option ${s === opp.subfaction ? "selected" : ""}>${esc(s)}</option>`));
      }
    };
    fillSubs();
    oppCard.querySelector("#opp-name").addEventListener("input", (e) => { opp.name = e.target.value; saveData(); });
    oppCard.querySelector("#opp-faction").addEventListener("change", (e) => { opp.faction = e.target.value; opp.subfaction = ""; fillSubs(); saveData(); });
    subSel.addEventListener("change", (e) => { opp.subfaction = e.target.value; saveData(); });

    // --- Unieke models van de tegenstander (uit de database) ---
    opp.models = opp.models || [];
    const omCard = el(`<div class="card"><h2>Models van ${esc(opp.name || "je tegenstander")}</h2>
      <p class="subtitle">Voeg de unieke models van je tegenstander toe uit de database. Tijdens de game open je hun kaartjes via de Tegenstander-knop bovenin.</p>
      <div data-list></div>
      <div class="btnrow"><button class="small" data-add>${icon("import")} Kaartje uit de database</button></div>
    </div>`);
    app.appendChild(omCard);
    const omList = omCard.querySelector("[data-list]");
    if (!opp.models.length) omList.appendChild(el(`<p class="empty">Nog geen models toegevoegd.</p>`));
    for (const m of opp.models) {
      const row = el(`<div class="card-header clickable" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span><strong>${esc(m.name)}</strong>${m.type ? ` <span class="chip tag">${esc(m.type)}</span>` : ""}</span>
        <button class="danger small">✕</button>
      </div>`);
      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        openModal(buildModelPopupContent(m, { el, esc }), el);
      });
      row.querySelector("button").addEventListener("click", () => {
        opp.models = opp.models.filter((x) => x !== m);
        saveData();
        rerender();
      });
      omList.appendChild(row);
    }
    omCard.querySelector("[data-add]").addEventListener("click", openOpponentModelPicker);

    // --- Battleplan ---
    const bpCard = el(`<div class="card">
      <h2>Battleplan</h2>
      <label>Welk battleplan spelen jullie?</label>
      <select id="bp-select">
        <option value="">— geen battleplan (alleen phases) —</option>
        ${(gamedata?.battleplans || []).map((b) => `<option value="${esc(b.id)}" ${b.id === game.setupBattleplanId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
      </select>
      ${gamedata ? "" : `<p class="subtitle" style="color:var(--red)">Battleplans konden niet geladen worden — je kunt wel zonder spelen.</p>`}
    </div>`);
    app.appendChild(bpCard);
    bpCard.querySelector("#bp-select").addEventListener("change", (e) => { game.setupBattleplanId = e.target.value; saveData(); });

    // --- Battle tactics ---
    // Jouw battle tactics komen uit je lijst (army.battleTactics, gekozen in set-up);
    // hier kies je alleen die van je tegenstander.
    game.setupEnemyTacticIds = game.setupEnemyTacticIds || [];

    const ownNames = army.battleTactics || [];
    const ownCard = el(`<div class="card"><h2>Jouw battle tactics</h2>
      <p class="subtitle">Uit je lijst — aan te passen in set-up mode. Klik voor de stappen.</p>
      <div data-list></div></div>`);
    app.appendChild(ownCard);
    const ownList = ownCard.querySelector("[data-list]");
    if (!ownNames.length) ownList.appendChild(el(`<p class="empty">Geen battle tactics in je lijst gekozen.</p>`));
    for (const name of ownNames) {
      const t = (gamedata?.tactics || []).find((x) => x.name === name);
      const row = el(`<div class="card inner clickable" style="margin:4px 0"><div class="card-header"><strong>${esc(name)}</strong><span class="subtitle">stappen ›</span></div></div>`);
      row.addEventListener("click", () => showTacticSteps(t || { name }));
      ownList.appendChild(row);
    }

    const tacticPicker = (title, hint, ids) => {
      const tCard = el(`<div class="card"><h2>${title}</h2>
        <p class="subtitle">${hint}</p>
        <div data-list></div>
      </div>`);
      app.appendChild(tCard);
      const tList = tCard.querySelector("[data-list]");
      if (!gamedata?.tactics?.length) { tList.appendChild(el(`<p class="empty">Geen battle tactics beschikbaar.</p>`)); return; }
      for (const t of gamedata.tactics) {
        const line = el(`<div class="checkline" style="align-items:center">
          <input type="checkbox" ${ids.includes(t.id) ? "checked" : ""} />
          <span style="flex:1"><strong>${esc(t.name)}</strong></span>
          <button class="small" data-steps>stappen ›</button>
        </div>`);
        line.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) {
            if (ids.length >= 2) { e.target.checked = false; alert("Kies maximaal 2 battle tactics."); return; }
            ids.push(t.id);
          } else {
            ids.splice(ids.indexOf(t.id), 1);
          }
          saveData();
        });
        line.querySelector("[data-steps]").addEventListener("click", () => showTacticSteps(t));
        tList.appendChild(line);
      }
    };
    tacticPicker(`Battle tactics van ${esc(opp.name || "je tegenstander")}`, "Welke 2 heeft je tegenstander gekozen? Die scoor je aan het einde van zijn beurt.", game.setupEnemyTacticIds);

    const startBtn = el(`<button class="primary bigbtn">${icon("play")} Naar deployment</button>`);
    startBtn.addEventListener("click", () => {
      const bp = (gamedata?.battleplans || []).find((b) => b.id === game.setupBattleplanId);
      if (bp && game.setupEnemyTacticIds.length !== 2
          && !confirm(`Je hebt ${game.setupEnemyTacticIds.length} battle tactics van de tegenstander gekozen in plaats van 2. Toch doorgaan?`)) return;
      const snap = (t) => ({ name: t.name, steps: JSON.parse(JSON.stringify(t.steps || [])), abilities: JSON.parse(JSON.stringify(t.abilities || [])), scoredRounds: [] });
      game.battleplan = bp ? JSON.parse(JSON.stringify(bp)) : null;
      game.tactics = (army.battleTactics || []).map((n) => (gamedata?.tactics || []).find((t) => t.name === n)).filter(Boolean).map(snap);
      game.enemyTactics = game.setupEnemyTacticIds.map((id) => (gamedata?.tactics || []).find((t) => t.id === id)).filter(Boolean).map(snap);
      game.seasonalRules = JSON.parse(JSON.stringify(gamedata?.seasonalRules || []));
      game.stage = "deployment";
      saveData();
      rerender(true);
    });
    bottomBar(startBtn);
  }

  // ---------- Modal (model-popup en units-menu) ----------
  // Maakt een rij/kaart klikbaar om de model-popup te openen
  // (klikken op een knop erin blijft gewoon de knop bedienen).
  function makeClickable(node, m) {
    node.classList.add("clickable");
    node.addEventListener("click", (e) => {
      // Klikken op een knop of een (buff-/CP-)vinkje opent de popup niet.
      if (e.target.closest("button, input, label, .checkline")) return;
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

  // Spells-menu: altijd je spell-/prayer-/manifestation lore + de spells van je models.
  function showSpellsMenu() {
    const wrap = el(`<div><h2>${icon("zap")} Spells & lores</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    renderLoresDisplay(body);
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen spell-, prayer- of manifestation lore in dit leger (of geen wizards/priests). Kies een lore in de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Rules-menu: faction- en subfaction rules/abilities altijd snel inzien.
  function showRulesMenu() {
    const wrap = el(`<div><h2>${icon("book")} Rules</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    const addRules = (title, rules) => {
      if (!rules?.length) return;
      body.appendChild(el(`<h3>${esc(title)}</h3>`));
      for (const r of rules) {
        const phases = (r.phases || []).map((p) => esc(phaseLabel(p))).filter(Boolean).join(" · ");
        body.appendChild(el(`<div class="ability faction">
          <span class="aname">${esc(r.name)}</span>
          ${r.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}
          ${phases ? `<div class="subtitle">${phases}</div>` : ""}
          <div class="adesc">${esc(r.description || "")}</div>
        </div>`));
      }
    };
    addRules("Faction rules", army.factionRules);
    addRules(`Subfaction rules${army.subfaction ? " — " + esc(army.subfaction) : ""}`, army.subfactionRules);
    addRules("Seasonal rules", game.seasonalRules);
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen faction- of subfaction rules in dit leger. Kies een faction/subfaction in de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Enhancements-menu: alle enhancements op je models, gegroepeerd per model.
  function showEnhancementsMenu() {
    const wrap = el(`<div><h2>${icon("star")} Enhancements</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    for (const m of activeModels()) {
      const enhs = eff(m).enhancements;
      if (!enhs.length) continue;
      const card = el(`<div class="card inner"><div class="card-header clickable"><strong>${esc(m.name)}</strong></div><div data-entries></div></div>`);
      makeClickable(card.querySelector(".card-header"), m);
      const entries = card.querySelector("[data-entries]");
      for (const enh of enhs) {
        const mods = (enh.statMods || []).map(modLabel).join(", ");
        entries.appendChild(el(`<div class="ability enhancement">
          <span class="aname">${esc(enh.name)}</span> <span class="asrc">— ${esc(enhancementCategoryLabel(enh.category))}</span>
          ${mods ? `<div class="subtitle">Stats: ${esc(mods)}</div>` : ""}
          <div class="adesc">${esc(enh.description || "")}</div>
        </div>`));
      }
      body.appendChild(card);
    }
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen enhancements op je models. Ken ze toe in de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Tegenstander-menu: zijn naam/faction en de kaartjes van zijn unieke models
  // (toegevoegd in de battle set-up), in dezelfde popup als je eigen models.
  function showOpponentMenu() {
    const o = game.opponent || {};
    const wrap = el(`<div>
      <h2>${esc(o.name || "Tegenstander")}</h2>
      ${o.faction ? `<p class="subtitle">${esc(o.faction)}${o.subfaction ? " — " + esc(o.subfaction) : ""}</p>` : ""}
      <div data-list></div>
    </div>`);
    const list = wrap.querySelector("[data-list]");
    const models = o.models || [];
    if (!models.length) {
      list.appendChild(el(`<p class="empty">Geen models toegevoegd voor je tegenstander. Dat doe je in de battle set-up (bij een nieuw potje).</p>`));
    }
    for (const m of models) {
      const row = el(`<div class="card-header clickable" style="padding:8px 0;border-bottom:1px dashed var(--border)">
        <span><strong>${esc(m.name)}</strong>${m.type ? ` <span class="chip tag">${esc(m.type)}</span>` : ""}</span>
        <span class="subtitle">Save ${esc(m.save)}${m.ward ? " · Ward " + esc(m.ward) : ""}</span>
      </div>`);
      row.addEventListener("click", () => openModal(buildModelPopupContent(m, { el, esc }), el));
      list.appendChild(row);
    }

    // Faction- en subfaction rules van de tegenstander (uit de gedeelde database)
    if (o.faction) {
      const rulesWrap = el(`<div><p class="empty">Rules laden…</p></div>`);
      wrap.appendChild(rulesWrap);
      sharedb.loadFactionDb(o.faction)
        .then(({ db }) => {
          rulesWrap.innerHTML = "";
          const addRules = (title, rules) => {
            if (!rules?.length) return;
            rulesWrap.appendChild(el(`<h3>${esc(title)}</h3>`));
            for (const r of rules) {
              rulesWrap.appendChild(el(`<div class="ability faction">
                <span class="aname">${esc(r.name)}</span>
                ${r.oncePerBattle ? ' <span class="chip tag">Once per battle</span>' : ""}
                <div class="adesc">${esc(r.description)}</div>
              </div>`));
            }
          };
          addRules("Faction rules", db.factionRules);
          if (o.subfaction) addRules(`Subfaction rules — ${o.subfaction}`, db.subfactions?.[o.subfaction]?.rules);
          if (!rulesWrap.children.length) {
            rulesWrap.appendChild(el(`<p class="empty">Geen rules in de ${esc(o.faction)}-database.</p>`));
          }
        })
        .catch(() => {
          rulesWrap.innerHTML = "";
          rulesWrap.appendChild(el(`<p class="empty">Rules konden niet geladen worden (offline?).</p>`));
        });
    }
    openModal(wrap, el);
  }

  // Picker (battle set-up): kaartjes uit de database van de tegenstander-faction
  // + universal manifestations toevoegen aan de tegenstander.
  async function openOpponentModelPicker() {
    const opp = game.opponent;
    if (!opp.faction) { alert("Kies eerst de faction van je tegenstander."); return; }
    let models;
    try {
      const { db } = await sharedb.loadFactionDb(opp.faction);
      const { db: uni } = await sharedb.loadUniversalDb();
      models = [...db.models, ...uni.models];
    } catch (e) {
      alert("Database niet beschikbaar: " + e.message);
      return;
    }
    const wrap = el(`<div><h2>Kaartjes — ${esc(opp.faction)}</h2>
      <p class="subtitle">Klik op een naam voor het kaartje; voeg toe (of haal weg) wat je tegenstander meeneemt.</p>
      <div data-list></div></div>`);
    const list = wrap.querySelector("[data-list]");
    if (!models.length) list.appendChild(el(`<p class="empty">Geen kaartjes in de ${esc(opp.faction)}-database.</p>`));
    // Gegroepeerd per type; Manifestation begint ingeklapt
    for (const [typeLabel, groupModels] of groupByType(models)) {
      const group = el(`<details class="type-group" ${typeLabel === "Manifestation" ? "" : "open"}>
        <summary>${esc(typeLabel)} <span class="count">(${groupModels.length})</span></summary>
        <div data-items></div>
      </details>`);
      const items = group.querySelector("[data-items]");
      for (const m of groupModels) {
        const isAdded = () => opp.models.some((x) => x.name.toLowerCase() === m.name.toLowerCase());
        const row = el(`<div class="card-header clickable" style="padding:8px 0;border-bottom:1px dashed var(--border)">
          <span><strong>${esc(m.name)}</strong></span>
          <button class="small"></button>
        </div>`);
        const btn = row.querySelector("button");
        const refresh = () => {
          btn.innerHTML = isAdded() ? `${icon("trash")} Verwijderen` : `${icon("plus")} Toevoegen`;
          btn.className = isAdded() ? "danger small" : "primary small";
        };
        refresh();
        btn.addEventListener("click", () => {
          if (isAdded()) {
            opp.models = opp.models.filter((x) => x.name.toLowerCase() !== m.name.toLowerCase());
          } else {
            const copy = JSON.parse(JSON.stringify(m));
            delete copy.addedBy;
            delete copy.enhancementIds;
            copy.enhancements = [];
            opp.models.push(copy);
          }
          saveData();
          refresh();
          rerender(); // lijst in de battle set-up bijwerken (scrollpositie blijft staan)
        });
        row.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          openModal(buildModelPopupContent(m, { el, esc }), el);
        });
        items.appendChild(row);
      }
      list.appendChild(group);
    }
    openModal(wrap, el);
  }

  // De belangrijkste actieknop (volgende phase / start ronde) altijd in beeld,
  // optioneel met een terugknop ernaast (terug in phases/beurten/battlerounds).
  function bottomBar(btn, prevBtn = null) {
    const bar = el(`<div class="bottombar"></div>`);
    if (prevBtn) {
      const row = el(`<div style="display:flex;gap:8px"></div>`);
      prevBtn.classList.add("bigbtn");
      prevBtn.style.cssText = "flex:0 0 auto;width:auto;margin-top:0";
      btn.style.flex = "1";
      btn.style.marginTop = "0";
      row.appendChild(prevBtn);
      row.appendChild(btn);
      bar.appendChild(row);
    } else {
      bar.appendChild(btn);
    }
    app.appendChild(bar);
  }

  function topbar(subtitle) {
    const bar = el(`<div class="topbar">
      <div>
        <span class="title">${esc(army.name)}</span>
        <div class="subtitle">${esc(subtitle)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${(game.stage === "roundSetup" || game.stage === "turn") ? `<button class="small ${scoreMode ? "primary" : ""}" id="btn-mode">${icon(scoreMode ? "monitor" : "list")} ${scoreMode ? "Volledig" : "Score-modus"}</button>` : ""}
        <button class="small" id="btn-opponent">${icon("shield")} Tegenstander</button>
        <button class="small" id="btn-tactics">${icon("flag")} Battle tactics</button>
        <button class="small" id="btn-spells">${icon("zap")} Spells</button>
        <button class="small" id="btn-rules">${icon("book")} Rules</button>
        <button class="small" id="btn-enh">${icon("star")} Enhancements</button>
        <button class="small" id="btn-units">${icon("users")} Units</button>
        <button class="small" id="btn-endgame">${icon("flag")} Einde spel</button>
        <button class="small" id="btn-home">${icon("back")} Legers</button>
      </div>
    </div>`);
    const modeBtn = bar.querySelector("#btn-mode");
    if (modeBtn) modeBtn.addEventListener("click", () => setScoreMode(!scoreMode));
    bar.querySelector("#btn-opponent").addEventListener("click", showOpponentMenu);
    bar.querySelector("#btn-tactics").addEventListener("click", showTacticsMenu);
    bar.querySelector("#btn-spells").addEventListener("click", showSpellsMenu);
    bar.querySelector("#btn-rules").addEventListener("click", showRulesMenu);
    bar.querySelector("#btn-enh").addEventListener("click", showEnhancementsMenu);
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
  // Fury level + rage dice (General's Handbook 2026-27). Alleen tonen als die
  // seasonal rules in dit potje actief zijn.
  const furyActive = () => (game.seasonalRules || []).some((r) => /fury level/i.test(r.description || ""));
  function renderFuryPanel({ role = false, roundStart = false } = {}) {
    if (!furyActive()) return;
    game.fury = game.fury || { role: "", level: 0, rage: 0 };
    const f = game.fury;
    const card = el(`<div class="card"><div class="card-header"><h3>${icon("zap")} Fury</h3></div><div data-body></div></div>`);
    const body = card.querySelector("[data-body]");
    if (role) {
      body.appendChild(el(`<p class="subtitle">Ben jij de attacker of defender? (suggereert je fury level)</p>`));
      const row = el(`<div class="btnrow"></div>`);
      for (const [val, label, lvl] of [["attacker", "Attacker (fury 1)", 1], ["defender", "Defender (fury 2)", 2]]) {
        const b = el(`<button class="small ${f.role === val ? "primary" : ""}">${label}</button>`);
        b.addEventListener("click", () => { f.role = val; f.level = lvl; saveData(); rerender(); });
        row.appendChild(b);
      }
      body.appendChild(row);
    }
    const stepper = (label, key, min, max, hint) => {
      const r = el(`<div class="scoreline"><span>${label}${hint != null ? ` <span class="subtitle">(suggestie: ${hint})</span>` : ""}</span>
        <span style="display:flex;align-items:center;gap:10px"><button class="small" data-dec>−</button><strong style="min-width:1.5em;text-align:center;font-size:1.1rem">${f[key] || 0}</strong><button class="small" data-inc>+</button></span></div>`);
      r.querySelector("[data-dec]").addEventListener("click", () => { f[key] = Math.max(min, (f[key] || 0) - 1); saveData(); rerender(); });
      r.querySelector("[data-inc]").addEventListener("click", () => { f[key] = Math.min(max, (f[key] || 0) + 1); saveData(); rerender(); });
      body.appendChild(r);
    };
    stepper("Fury level", "level", 0, 7, role && f.role ? (f.role === "attacker" ? 1 : 2) : null);
    stepper("Rage dice", "rage", 0, 99, roundStart ? f.level : null);
    // Snelknoppen voor de samengestelde aanpassingen uit de seasonal rules
    if (!role) {
      const quick = (label, dLevel, dRage) => {
        const b = el(`<button class="small">${label}</button>`);
        b.addEventListener("click", () => { f.level = Math.max(0, Math.min(7, (f.level || 0) + dLevel)); f.rage = Math.max(0, (f.rage || 0) + dRage); saveData(); rerender(); });
        return b;
      };
      const qrow = el(`<div class="btnrow" style="margin-top:6px"></div>`);
      qrow.appendChild(quick(`${icon("zap")} Ignite Fury (+2 fury, +2 rage)`, 2, 2));
      qrow.appendChild(quick("Fight Through the Pain (−1 fury, −1 rage)", -1, -1));
      qrow.appendChild(quick("Rage die uitgeven (−1)", 0, -1));
      body.appendChild(qrow);
    }
    if (roundStart) {
      const btn = el(`<button class="small primary" style="margin-top:6px">${icon("zap")} Nieuwe battleround: ${f.level} rage dice (= fury level)</button>`);
      btn.addEventListener("click", () => { f.rage = f.level; saveData(); rerender(); });
      body.appendChild(btn);
      body.appendChild(el(`<p class="subtitle">Onbestede rage dice vervallen aan het eind van de battleround.</p>`));
    }
    app.appendChild(card);
  }

  function renderDeployment() {
    topbar("Deployment");
    app.appendChild(el(`<h2>Deployment</h2>`));
    renderFuryPanel({ role: true });
    // Battleplan: kaart (klikbaar voor schermvullend) + twist + alle regels
    const bp = game.battleplan;
    if (bp) {
      const card = el(`<div class="card">
        <div class="card-header"><h3>${esc(bp.name)}</h3></div>
        ${bp.card ? `<img class="bp-card" src="${esc(bp.card)}" alt="${esc(bp.name)}" loading="lazy" />` : ""}
        ${bp.twist ? `<div class="muted-list"><strong>Twist:</strong> ${esc(bp.twist)}</div>` : ""}
      </div>`);
      const img = card.querySelector(".bp-card");
      if (img) img.addEventListener("click", () => openModal(el(`<div class="bp-card-full"><img src="${esc(bp.card)}" alt="${esc(bp.name)}" /></div>`), el));
      app.appendChild(card);
      for (const ab of bp.abilities || []) app.appendChild(abilityCard({ ...ab, type: "battleplan", source: `Battleplan: ${bp.name}` }));
    }
    const abs = collectAbilities("deployment").filter((a) => a.type !== "battleplan");
    if (abs.length) {
      app.appendChild(el(`<h3>Abilities tijdens deployment</h3>`));
      for (const ab of abs) app.appendChild(abilityCard(ab));
    } else if (!bp) {
      app.appendChild(el(`<p class="empty">Geen abilities voor de deployment.</p>`));
    }
    const nextBtn = el(`<button class="primary bigbtn">${icon("play")} Deployment klaar — naar battleround 1</button>`);
    nextBtn.addEventListener("click", () => {
      game.stage = "roundSetup";
      saveData();
      rerender(true);
    });
    const prevBtn = el(`<button title="Terug naar battle set-up">${icon("back")}</button>`);
    prevBtn.addEventListener("click", () => { game.stage = "battleSetup"; saveData(); rerender(true); });
    bottomBar(nextBtn, prevBtn);
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
    renderFuryPanel({ roundStart: true });

    const card = el(`<div class="card">
      <h2>Battleround ${game.round} van ${LAST_ROUND}</h2>
      <label>Wie heeft deze battleround de eerste beurt?</label>
      <div class="btnrow">
        <button id="first-player" class="${game.firstTurn === "player" ? "primary" : ""}">Ik (de speler)</button>
        <button id="first-enemy" class="${game.firstTurn === "enemy" ? "primary" : ""}">De tegenstander</button>
      </div>
      <label>Met hoeveel command points begin je deze battleround? (standaard 4, als underdog 5)</label>
      <input type="number" id="cp-input" min="0" value="${game.underdog[game.round] === "player" ? 5 : 4}" />
      <div data-underdog></div>
    </div>`);
    app.appendChild(card);

    // Underdog: vanaf battleround 2 aangeven wie achterstaat
    if (game.round >= 2 && game.battleplan) {
      const udWrap = card.querySelector("[data-underdog]");
      udWrap.appendChild(el(`<label>Wie is deze battleround de underdog?</label>`));
      const row = el(`<div class="btnrow"></div>`);
      const current = game.underdog[game.round] || "none";
      for (const [key, label] of [["player", "Ik"], ["enemy", game.opponent?.name || "De tegenstander"], ["none", "Niemand"]]) {
        const b = el(`<button class="${current === key ? "primary" : ""}">${esc(label)}</button>`);
        b.addEventListener("click", () => { game.underdog[game.round] = key; saveData(); rerender(); });
        row.appendChild(b);
      }
      udWrap.appendChild(row);
    }

    const startBtn = el(`<button class="primary bigbtn" id="btn-start">${icon("play")} Start battleround ${game.round}</button>`);
    const backBtn = el(`<button title="Terug">${icon("back")}</button>`);
    backBtn.addEventListener("click", () => {
      if (game.round === 1) {
        game.stage = "deployment";
      } else {
        // terug naar de laatste beurt van de vorige battleround
        game.round--;
        game.stage = "turn";
        game.turnIndex = 1;
        game.phaseIndex = PHASES.length - 1;
      }
      saveData();
      rerender(true);
    });
    bottomBar(startBtn, backBtn);

    card.querySelector("#first-player").addEventListener("click", () => { game.firstTurn = "player"; saveData(); rerender(); });
    card.querySelector("#first-enemy").addEventListener("click", () => { game.firstTurn = "enemy"; saveData(); rerender(); });
    startBtn.addEventListener("click", () => {
      game.cp = parseInt(card.querySelector("#cp-input").value) || 0;
      game.stage = "turn";
      game.turnIndex = 0;
      game.phaseIndex = 0;
      game.usedCommands = {};
      game.firstTurnByRound[game.round] = game.firstTurn; // voor de scorekaart
      saveData();
      rerender(true);
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

    // Lopende score
    if (game.battleplan) {
      const s = calcScores(game);
      app.appendChild(el(`<div class="scoreline">
        <span>${esc(state.user.name)} <strong>${s.player.total}</strong></span>
        <span class="subtitle">—</span>
        <span><strong>${s.enemy.total}</strong> ${esc(game.opponent?.name || "Tegenstander")}</span>
      </div>`));
    }

    renderFuryPanel();

    // Phase navigatie
    const nav = el(`<div class="phase-nav"></div>`);
    PHASES.forEach((p, i) => {
      const btn = el(`<button class="${i === game.phaseIndex ? "active" : ""}">${p.label}</button>`);
      btn.addEventListener("click", () => { game.phaseIndex = i; saveData(); rerender(true); });
      nav.appendChild(btn);
    });
    app.appendChild(nav);

    app.appendChild(el(`<h2>${phase.label}</h2>`));

    // Phase-specifieke inhoud
    renderPhaseContent(owner, phase.key);

    // Abilities voor deze phase (passives niet hier, die staan in het uitschuifblad onderaan)
    const abs = abilitiesFor(owner, phase.key).filter((ab) => !isPassiveAb(ab));
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

    // Passives & blijvende effecten (uitschuifbaar, onderaan)
    renderPassivePanel();

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
        pruneBuffs("turn"); // "rest of the turn"-buffs vervallen aan het einde van de beurt
      } else if (isLastRound) {
        game.stage = "gameOver";
      } else {
        game.round++;
        game.stage = "roundSetup";
        pruneBuffs("round"); // nieuwe ronde → alle buffs (ook "tot je volgende beurt") vervallen
      }
      saveData();
      rerender(true);
    });
    // Terug: vorige phase, of de vorige beurt / het rondescherm
    const prevBtn = el(`<button title="Vorige phase / beurt">${icon("back")}</button>`);
    prevBtn.addEventListener("click", () => {
      if (game.phaseIndex > 0) {
        game.phaseIndex--;
      } else if (game.turnIndex === 1) {
        game.turnIndex = 0;
        game.phaseIndex = PHASES.length - 1;
      } else {
        game.stage = "roundSetup";
      }
      saveData();
      rerender(true);
    });
    bottomBar(nextBtn, prevBtn);
  }

  // ===================== Game over (na battleround 5) =====================
  function renderGameOver() {
    topbar(`Game afgelopen`);

    if (game.battleplan) {
      // Record opbouwen en (eenmalig) automatisch archiveren
      state.data.gameArchive = state.data.gameArchive || [];
      let rec = state.data.gameArchive.find((x) => x.id === game.archivedId);
      if (!rec) {
        rec = buildGameRecord(army, game, state.user.name);
        state.data.gameArchive.push(rec);
        game.archivedId = rec.id;
        saveData();
      }
      app.appendChild(buildScoreSummary(rec, { el, esc }));
      app.appendChild(buildExportButtons(rec, { el }));
      app.appendChild(el(`<p class="subtitle">${icon("check")} Opgeslagen in het archief (zie home-scherm).</p>`));
    } else {
      app.appendChild(el(`<div class="card" style="text-align:center">
        <h2>${icon("flag", 20)} Game afgelopen</h2>
        <p class="subtitle">Alle ${LAST_ROUND} battlerounds zijn gespeeld. Goed gespeeld!</p>
      </div>`));
    }

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

    const backBtn = el(`<button class="bigbtn">${icon("undo")} Toch terug naar battleround ${LAST_ROUND}</button>`);
    backBtn.addEventListener("click", () => {
      // het automatisch gearchiveerde record weghalen — bij opnieuw afronden
      // wordt een vers record gemaakt
      if (game.archivedId) {
        state.data.gameArchive = (state.data.gameArchive || []).filter((x) => x.id !== game.archivedId);
        delete game.archivedId;
      }
      game.stage = "turn";
      game.turnIndex = 1;
      game.phaseIndex = PHASES.length - 1;
      saveData();
      rerender(true);
    });
    app.appendChild(backBtn);
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

      // Scoren aan het einde van iedere beurt (battleplan gekozen)
      if (game.battleplan) renderScoringCard(owner, { endBonus: game.round === LAST_ROUND && game.turnIndex === 1 });
    }
  }

  // ---------- Scoren (End of Turn, per beurt-eigenaar) ----------
  function renderScoringCard(owner, { endBonus = false } = {}) {
    const r = game.round;
    const oppName = game.opponent?.name || "tegenstander";
    app.appendChild(el(`<h3>${owner === "player" ? "Jouw score" : `Score van ${esc(oppName)}`} — einde van deze beurt</h3>`));
    const card = el(`<div class="card"></div>`);

    game.scores[owner] = game.scores[owner] || {};
    game.scores[owner][r] = game.scores[owner][r] || {};
    const slot = game.scores[owner][r];

    const opts = scoringOptionsFor(game.battleplan, r);
    if (!opts.length) card.appendChild(el(`<p class="empty">Geen objective-score in battleround ${r} bij dit battleplan.</p>`));
    for (const opt of opts) {
      const line = el(`<div class="checkline">
        <input type="checkbox" ${slot[opt.key] ? "checked" : ""} />
        <span>${esc(opt.label)} <span class="lval">+${opt.points}</span></span>
      </div>`);
      line.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) slot[opt.key] = true;
        else delete slot[opt.key];
        saveData();
        rerender();
      });
      card.appendChild(line);
    }

    // Liferoot points (The Liferoots): cumulatief, doorgeven aan het einde van je beurt
    if (game.battleplan.scoring?.liferoot) {
      const lf = el(`<div>
        <label>Liferoot points van ${owner === "player" ? "jou" : esc(oppName)} (cumulatief)</label>
        <input type="number" min="0" value="${game.liferoot[owner] || 0}" />
      </div>`);
      lf.querySelector("input").addEventListener("change", (e) => {
        game.liferoot[owner] = parseInt(e.target.value) || 0;
        saveData();
      });
      card.appendChild(lf);
    }

    // Eindbonus (Noxious Nexus): pas aan het einde van de laatste beurt van ronde 5
    if (game.battleplan.scoring?.endBonus && endBonus) {
      const eb = game.battleplan.scoring.endBonus;
      const wrap = el(`<div><label>${esc(eb.label)} (+${eb.points} punten) — wie?</label><div class="btnrow" data-eb></div></div>`);
      const ebRow = wrap.querySelector("[data-eb]");
      for (const [key, label] of [["player", "Ik"], ["enemy", oppName], ["", "Niemand"]]) {
        const b = el(`<button class="small ${game.endBonusOwner === key ? "primary" : ""}">${esc(label)}</button>`);
        b.addEventListener("click", () => { game.endBonusOwner = key; saveData(); rerender(); });
        ebRow.appendChild(b);
      }
      card.appendChild(wrap);
    }
    app.appendChild(card);

    // Battle tactics: jouw 2 aan het einde van je eigen beurt, die van de
    // tegenstander aan het einde van zijn beurt; max 1 stap per tactic per beurt.
    const tacticsList = owner === "player" ? game.tactics : game.enemyTactics;
    if (tacticsList.length) {
      app.appendChild(el(`<h3>${owner === "player" ? "Jouw battle tactics" : `Battle tactics van ${esc(oppName)}`}</h3>`));
      const tc = el(`<div class="card"></div>`);
      for (const t of tacticsList) {
        t.scoredRounds = t.scoredRounds || [];
        const done = t.scoredRounds.length;
        const idxThisRound = t.scoredRounds.indexOf(r);
        const scoredThis = idxThisRound >= 0;
        const stepIdx = scoredThis ? idxThisRound : done;
        const step = (t.steps || [])[stepIdx];
        let label;
        if (scoredThis) label = `Stap ${stepIdx + 1} gescoord deze beurt (+${TACTIC_STEP_POINTS})`;
        else if (done < 3) label = `Stap ${done + 1} scoren: ${esc(step?.name || "")} (+${TACTIC_STEP_POINTS})`;
        else label = "Alle 3 stappen gescoord";
        const row = el(`<div class="checkline" style="align-items:flex-start">
          <input type="checkbox" ${scoredThis ? "checked" : ""} ${scoredThis || done < 3 ? "" : "disabled"} />
          <span><strong>${esc(t.name)}</strong> <span class="subtitle">(${done}/3)</span><br>${label}
            ${!scoredThis && done < 3 && step?.description ? `<div class="muted-list">${esc(step.description)}</div>` : ""}
          </span>
        </div>`);
        row.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) t.scoredRounds.push(r);
          else t.scoredRounds = t.scoredRounds.filter((x) => x !== r);
          saveData();
          rerender();
        });
        tc.appendChild(row);
      }
      app.appendChild(tc);
    }
  }

  // ===================== Score-modus =====================
  // Compacte weergave per battleround: kies wie eerst gaat en vul per beurt
  // (eigen + tegenstander) de scores in. Snel overzicht; geen phases.
  function renderScoreMode() {
    topbar(`Score-modus · battleround ${game.round}/${LAST_ROUND}`);
    const oppName = game.opponent?.name || "Tegenstander";

    const head = el(`<div class="card">
      <h2>Battleround ${game.round} van ${LAST_ROUND}</h2>
      <label>Wie heeft deze battleround de eerste beurt?</label>
      <div class="btnrow">
        <button id="f-player" class="${game.firstTurn === "player" ? "primary" : ""}">Ik</button>
        <button id="f-enemy" class="${game.firstTurn === "enemy" ? "primary" : ""}">${esc(oppName)}</button>
      </div>
    </div>`);
    head.querySelector("#f-player").addEventListener("click", () => { game.firstTurn = "player"; game.firstTurnByRound[game.round] = "player"; saveData(); rerender(); });
    head.querySelector("#f-enemy").addEventListener("click", () => { game.firstTurn = "enemy"; game.firstTurnByRound[game.round] = "enemy"; saveData(); rerender(); });
    app.appendChild(head);

    if (game.battleplan) {
      const s = calcScores(game);
      app.appendChild(el(`<div class="scoreline">
        <span>${esc(state.user.name)} <strong>${s.player.total}</strong></span>
        <span class="subtitle">—</span>
        <span><strong>${s.enemy.total}</strong> ${esc(oppName)}</span>
      </div>`));
      // Beide beurten in de juiste volgorde, elk met zijn scorekaart
      const order = game.firstTurn === "player" ? ["player", "enemy"] : ["enemy", "player"];
      order.forEach((owner, idx) => {
        app.appendChild(el(`<h2>${idx === 0 ? "Eerste beurt" : "Tweede beurt"}: ${owner === "player" ? "jij" : esc(oppName)}</h2>`));
        renderScoringCard(owner, { endBonus: game.round === LAST_ROUND && idx === 1 });
      });
    } else {
      app.appendChild(el(`<p class="empty">Geen battleplan gekozen — er zijn geen scores om in te vullen.</p>`));
    }

    // Navigatie tussen battlerounds
    const isLast = game.round >= LAST_ROUND;
    const nextBtn = el(`<button class="primary bigbtn">${isLast ? `${icon("flag")} Einde spel` : "Volgende battleround →"}</button>`);
    nextBtn.addEventListener("click", () => {
      if (isLast) { game.stage = "gameOver"; }
      else { game.round++; game.firstTurn = game.firstTurnByRound[game.round] || game.firstTurn; game.stage = "roundSetup"; game.turnIndex = 0; game.phaseIndex = 0; game.usedCommands = {}; }
      saveData(); rerender(true);
    });
    let prevBtn = null;
    if (game.round > 1) {
      prevBtn = el(`<button title="Vorige battleround">${icon("back")}</button>`);
      prevBtn.addEventListener("click", () => { game.round--; game.firstTurn = game.firstTurnByRound[game.round] || game.firstTurn; game.stage = "roundSetup"; game.turnIndex = 0; game.phaseIndex = 0; saveData(); rerender(true); });
    }
    bottomBar(nextBtn, prevBtn);
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
      target.appendChild(weaponTable(filterWeapons(e.model[key], m), toHitTransform));
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
    // Spells van je eigen models (abilities die als spell gemarkeerd zijn)
    const spellModels = activeModels().filter((m) => (m.abilities || []).some((a) => a.isSpell));
    if (spellModels.length) {
      const card = el(`<div class="card inner"><h3>Spells van je models</h3><div data-entries></div></div>`);
      const entries = card.querySelector("[data-entries]");
      for (const m of spellModels) {
        for (const ab of m.abilities.filter((a) => a.isSpell)) {
          const row = el(`<div class="lore-entry">
            <div class="owner">${esc(m.name)}</div>
            <strong>${esc(ab.name)}</strong> <span class="lval">Cast ${esc(ab.castingValue || "?")}</span>
            <div class="subtitle">${esc(ab.description)}</div>
          </div>`);
          makeClickable(row, m);
          entries.appendChild(row);
        }
      }
      target.appendChild(card);
    }
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

  // Buff-knop: abilities die "for the rest of the turn" / "until the start of your next turn"
  // in hun tekst hebben krijgen een knop "Actief gegaan" → komen in het Passives-blad te staan.
  function attachBuff(card, ab) {
    const dur = buffDuration(ab);
    if (!dur) return;
    const key = `${ab.source}|${ab.name}`;
    const active = !!game.activeBuffs[key];
    const durLabel = dur === "nextTurn" ? "tot je volgende beurt" : "deze beurt";
    const line = el(`<div class="checkline" style="margin-top:6px">
      <input type="checkbox" ${active ? "checked" : ""} />
      <span>Actief gegaan — blijft in het Passives-blad staan (${durLabel})</span>
    </div>`);
    line.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) game.activeBuffs[key] = { name: ab.name, source: ab.source, description: ab.description, dur };
      else delete game.activeBuffs[key];
      saveData(); rerender();
    });
    card.appendChild(line);
  }

  function abilityCard(ab) {
    const typeClass = ab.type === "faction" ? "faction" : ab.type === "enhancement" ? "enhancement" : ab.type === "battleplan" ? "battleplan" : "";
    const cost = parseInt(ab.cpCost) || 0;
    const costTag = cost > 0 ? ` <span class="ccost">(${cost} CP)</span>` : "";
    if (!ab.oncePerBattle) {
      const card = el(`<div class="ability ${typeClass}">
        <div class="owner">${esc(ab.source)}</div>
        <span class="aname">${esc(ab.name)}</span>${costTag}
        <div class="adesc">${esc(ab.description)}</div>
        <div data-cp></div>
      </div>`);
      // Kost CP: afvinken bij gebruik trekt de kosten van de teller af (per beurt)
      if (cost > 0) {
        const cpKey = `abcp|${ab.source}|${ab.name}`;
        const cpUsed = !!game.usedCommands[cpKey];
        const affordable = cpUsed || game.cp >= cost;
        const line = el(`<div class="checkline" style="margin-top:6px">
          <input type="checkbox" ${cpUsed ? "checked" : ""} ${affordable ? "" : "disabled"} />
          <span>Gebruikt deze beurt (−${cost} CP)</span>
        </div>`);
        line.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) {
            if (game.cp < cost) { e.target.checked = false; return; }
            game.cp -= cost;
            game.usedCommands[cpKey] = true;
          } else {
            game.cp += cost;
            delete game.usedCommands[cpKey];
          }
          saveData();
          rerender();
        });
        card.querySelector("[data-cp]").appendChild(line);
      }
      attachBuff(card, ab);
      if (ab.model) makeClickable(card, ab.model);
      return card;
    }
    // Once per battle: knop om hem te gebruiken; daarna doorgestreept zichtbaar
    const key = `${ab.source}|${ab.name}`;
    const used = !!game.usedAbilities[key];
    const card = el(`<div class="ability ${typeClass} ${used ? "used" : ""}">
      <div class="owner">${esc(ab.source)}</div>
      <span class="aname">${esc(ab.name)}</span>${costTag}
      <span class="chip tag ${used ? "dim" : ""}">Once per battle</span>
      <div class="adesc">${esc(ab.description)}</div>
      <div class="btnrow">
        <button class="small ${used ? "" : "primary"}">${used ? `${icon("undo")} Toch niet gebruikt` : `${icon("zap")} Gebruik (once per battle)`}</button>
      </div>
    </div>`);
    card.querySelector("button").addEventListener("click", () => {
      if (game.usedAbilities[key]) {
        delete game.usedAbilities[key];
        if (cost > 0) game.cp += cost;
      } else {
        if (cost > 0 && game.cp < cost) { alert(`Niet genoeg command points (kost ${cost} CP).`); return; }
        if (cost > 0) game.cp -= cost;
        game.usedAbilities[key] = true;
      }
      saveData();
      rerender();
    });
    attachBuff(card, ab);
    if (ab.model) makeClickable(card, ab.model);
    return card;
  }

  // Uitschuifbaar blad onderaan: alle passive abilities + actieve buffs (rest of turn / next turn).
  function renderPassivePanel() {
    const passives = collectPassives();
    const buffEntries = Object.entries(game.activeBuffs || {});
    if (!passives.length && !buffEntries.length) return;
    const det = el(`<details class="passive-sheet"><summary>${icon("shield")} Passives & blijvende effecten (${passives.length + buffEntries.length})</summary><div data-body></div></details>`);
    const body = det.querySelector("[data-body]");
    if (buffEntries.length) {
      body.appendChild(el(`<h4>Actieve effecten</h4>`));
      for (const [key, b] of buffEntries) {
        const card = el(`<div class="ability">
          <div class="owner">${esc(b.source)} · ${b.dur === "nextTurn" ? "tot je volgende beurt" : "deze beurt"}</div>
          <span class="aname">${esc(b.name)}</span>
          <div class="adesc">${esc(b.description)}</div>
          <div class="btnrow"><button class="small danger">${icon("undo")} Afgelopen</button></div>
        </div>`);
        card.querySelector("button").addEventListener("click", () => { delete game.activeBuffs[key]; saveData(); rerender(); });
        body.appendChild(card);
      }
    }
    if (passives.length) {
      body.appendChild(el(`<h4>Passives</h4>`));
      for (const ab of passives) body.appendChild(abilityCard(ab));
    }
    app.appendChild(det);
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
          mc.appendChild(weaponTable(filterWeapons(eff(m).model.rangedAttacks, m), minusOneToHit));
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
