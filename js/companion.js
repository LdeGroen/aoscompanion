import { PHASES, phaseLabel } from "./factions.js";

// Companion mode: het spelen van een battle met je leger.
export function renderCompanion(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.data.armies.find((a) => a.id === state.armyId);
  if (!army) return navigate("home");

  // Spelstatus wordt op het leger bewaard zodat je app kunt verversen zonder je spel kwijt te raken.
  if (!army.game) {
    army.game = newGame();
    saveData();
  }
  const game = army.game;

  function newGame() {
    return {
      round: 1,
      stage: "roundSetup", // roundSetup | turn
      firstTurn: "player", // wie heeft de eerste beurt deze ronde
      turnIndex: 0,        // 0 = eerste beurt van de ronde, 1 = tweede
      phaseIndex: 0,
      cp: 0,
      usedCommands: {},    // commandId -> true (per beurt)
      usedAbilities: {},   // abilityKey -> true (once per battle, hele spel)
    };
  }
  game.usedAbilities = game.usedAbilities || {}; // voor spellen gestart vóór deze feature

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
    const fullKey = `${owner === "player" ? "own" : "enemy"}-${phaseKey}`;
    const result = [];
    for (const m of army.models) {
      for (const ab of m.abilities) {
        if (ab.phases.includes(fullKey)) result.push({ ...ab, source: m.name, type: "model" });
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
  function rerender() {
    app.innerHTML = "";
    window.scrollTo(0, 0);
    if (game.stage === "roundSetup") renderRoundSetup();
    else renderTurn();
  }

  function topbar(subtitle) {
    const bar = el(`<div class="topbar">
      <div>
        <span class="title">${esc(army.name)}</span>
        <div class="subtitle">${esc(subtitle)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="small" id="btn-endgame">Einde spel</button>
        <button class="small" id="btn-home">← Legers</button>
      </div>
    </div>`);
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

  // ===================== Battleround set-up =====================
  function renderRoundSetup() {
    topbar(`Battleround ${game.round}`);
    const card = el(`<div class="card">
      <h2>Battleround ${game.round}</h2>
      <label>Wie heeft deze battleround de eerste beurt?</label>
      <div class="btnrow">
        <button id="first-player" class="${game.firstTurn === "player" ? "primary" : ""}">Ik (de speler)</button>
        <button id="first-enemy" class="${game.firstTurn === "enemy" ? "primary" : ""}">De tegenstander</button>
      </div>
      <label>Met hoeveel command points begin je deze battleround?</label>
      <input type="number" id="cp-input" min="0" value="${game.round === 1 ? 4 : game.cp || 4}" />
      <button class="primary bigbtn" id="btn-start">▶ Start battleround ${game.round}</button>
    </div>`);
    app.appendChild(card);

    card.querySelector("#first-player").addEventListener("click", () => { game.firstTurn = "player"; saveData(); rerender(); });
    card.querySelector("#first-enemy").addEventListener("click", () => { game.firstTurn = "enemy"; saveData(); rerender(); });
    card.querySelector("#btn-start").addEventListener("click", () => {
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
    topbar(`Battleround ${game.round} · beurt ${game.turnIndex + 1} van 2`);

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
    let nextLabel;
    if (!isLastPhase) nextLabel = `Volgende: ${PHASES[game.phaseIndex + 1].label} →`;
    else if (game.turnIndex === 0) nextLabel = `Einde beurt — start beurt van ${owner === "player" ? "de tegenstander" : "jou"} →`;
    else nextLabel = `Einde battleround ${game.round} — naar battleround ${game.round + 1} →`;

    const nextBtn = el(`<button class="primary bigbtn">${nextLabel}</button>`);
    nextBtn.addEventListener("click", () => {
      if (!isLastPhase) {
        game.phaseIndex++;
      } else if (game.turnIndex === 0) {
        game.turnIndex = 1;
        game.phaseIndex = 0;
        game.usedCommands = {};
      } else {
        game.round++;
        game.stage = "roundSetup";
      }
      saveData();
      rerender();
    });
    app.appendChild(nextBtn);
  }

  // ---------- Phase-specifieke inhoud ----------
  function renderPhaseContent(owner, phaseKey) {
    if (phaseKey === "start") {
      app.appendChild(el(`<div class="reminder">⚑ Reminder: Place of Power gebruiken?</div>`));
    }

    if (phaseKey === "hero" && owner === "player") {
      const casters = army.models.filter((m) => m.wizardLevel > 0 || m.priestLevel > 0);
      if (casters.length) {
        app.appendChild(el(`<h3>Wizards & priests</h3>`));
        for (const m of casters) {
          const roles = [];
          if (m.wizardLevel > 0) roles.push(`Wizard (${m.wizardLevel})`);
          if (m.priestLevel > 0) roles.push(`Priest (${m.priestLevel})`);
          app.appendChild(el(`<div class="card inner"><div class="card-header"><strong>${esc(m.name)}</strong><span class="chip tag">${roles.join(" · ")}</span></div></div>`));
        }
        renderLoresDisplay();
      } else {
        app.appendChild(el(`<p class="empty">Geen models met wizard of priest level.</p>`));
      }
    }

    if (phaseKey === "movement" && owner === "player") {
      app.appendChild(el(`<h3>Movement van je units</h3>`));
      const card = el(`<div class="card"></div>`);
      for (const m of army.models) {
        card.appendChild(el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
          <span>${esc(m.name)}</span>
          <span><span class="stat" style="display:inline-block"><span class="v">${esc(m.move)}"</span></span>${m.fly ? ' <span class="chip tag">Fly</span>' : ""}</span>
        </div>`));
      }
      app.appendChild(card);
    }

    if (phaseKey === "shooting" && owner === "player") {
      renderWeaponsDisplay("rangedAttacks", "Ranged attacks");
    }

    if (phaseKey === "combat") {
      // Speler-combat altijd; bij de tegenstander mogen alle melee profielen ook getoond worden
      renderWeaponsDisplay("meleeAttacks", "Melee attacks");
    }

    if (phaseKey === "end") {
      app.appendChild(el(`<h3>Control scores</h3>`));
      const card = el(`<div class="card"></div>`);
      for (const m of army.models) {
        const total = (m.control || 0) + (m.controlBonus || 0);
        card.appendChild(el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
          <span>${esc(m.name)}${m.standardBearer ? ' <span class="chip tag">Standard Bearer</span>' : ""}</span>
          <span class="stat" style="display:inline-block"><span class="v">${total}</span><span class="k">control</span></span>
        </div>`));
      }
      app.appendChild(card);
    }
  }

  function renderWeaponsDisplay(key, title, toHitTransform) {
    const withWeapons = army.models.filter((m) => m[key].length > 0);
    if (!withWeapons.length) {
      app.appendChild(el(`<p class="empty">Geen models met ${title.toLowerCase()}.</p>`));
      return;
    }
    app.appendChild(el(`<h3>${title}</h3>`));
    for (const m of withWeapons) {
      const card = el(`<div class="card inner">
        <div class="card-header"><strong>${esc(m.name)}</strong>${m.champion ? '<span class="chip tag">Champion</span>' : ""}</div>
        <div data-weapons></div>
      </div>`);
      card.querySelector("[data-weapons]").appendChild(weaponTable(m[key], toHitTransform));
      app.appendChild(card);
    }
  }

  function weaponTable(weapons, toHitTransform) {
    const wrap = el(`<div></div>`);
    const hasRange = weapons.some((w) => w.range);
    const table = el(`<table class="weapons">
      <tr><th>Wapen</th>${hasRange ? "<th>Range</th>" : ""}<th>Atk</th><th>Hit</th><th>Wnd</th><th>Rend</th><th>Dmg</th></tr>
    </table>`);
    for (const w of weapons) {
      const hit = toHitTransform ? toHitTransform(w.toHit) : w.toHit;
      table.appendChild(el(`<tr>
        <td class="name">${esc(w.name)}</td>
        ${hasRange ? `<td>${esc(w.range || "")}"</td>` : ""}
        <td>${esc(w.attacks)}</td>
        <td>${esc(hit)}</td>
        <td>${esc(w.toWound)}</td>
        <td>${esc(w.rend)}</td>
        <td>${esc(w.damage)}</td>
      </tr>`));
    }
    wrap.appendChild(table);
    for (const w of weapons) {
      for (const b of w.bonuses.filter(Boolean)) {
        wrap.appendChild(el(`<div class="weapon-bonus">✦ ${esc(w.name)}: ${esc(b)}</div>`));
      }
    }
    return wrap;
  }

  function renderLoresDisplay(target = app) {
    const hasWizard = army.models.some((m) => m.wizardLevel > 0);
    const hasPriest = army.models.some((m) => m.priestLevel > 0);
    if (hasWizard && army.spellLore) target.appendChild(loreCard("Spell lore", army.spellLore, "Cast"));
    if (hasWizard && army.manifestationLore) target.appendChild(loreCard("Manifestation lore", army.manifestationLore, "Cast"));
    if (hasPriest && army.prayerLore) target.appendChild(loreCard("Prayer lore", army.prayerLore, "Chant"));
  }

  function loreCard(title, lore, valuePrefix) {
    const card = el(`<div class="card inner"><h3>${title}: ${esc(lore.name)}</h3><div data-entries></div></div>`);
    const entries = card.querySelector("[data-entries]");
    for (const entry of lore.entries) {
      if (!entry.name && !entry.description) continue;
      entries.appendChild(el(`<div class="lore-entry">
        <strong>${esc(entry.name)}</strong> <span class="lval">${valuePrefix} ${esc(entry.value)}</span>
        <div class="subtitle">${esc(entry.description)}</div>
      </div>`));
    }
    return card;
  }

  function abilityCard(ab) {
    if (!ab.oncePerBattle) {
      return el(`<div class="ability ${ab.type === "faction" ? "faction" : ""}">
        <span class="aname">${esc(ab.name)}</span> <span class="asrc">— ${esc(ab.source)}</span>
        <div class="adesc">${esc(ab.description)}</div>
      </div>`);
    }
    // Once per battle: knop om hem te gebruiken; daarna doorgestreept zichtbaar
    const key = `${ab.source}|${ab.name}`;
    const used = !!game.usedAbilities[key];
    const card = el(`<div class="ability ${ab.type === "faction" ? "faction" : ""} ${used ? "used" : ""}">
      <span class="aname">${esc(ab.name)}</span> <span class="asrc">— ${esc(ab.source)}</span>
      <span class="chip tag ${used ? "dim" : ""}">Once per battle</span>
      <div class="adesc">${esc(ab.description)}</div>
      <div class="btnrow">
        <button class="small ${used ? "" : "primary"}">${used ? "↩ Toch niet gebruikt" : "⚡ Gebruik (once per battle)"}</button>
      </div>
    </div>`);
    card.querySelector("button").addEventListener("click", () => {
      if (game.usedAbilities[key]) delete game.usedAbilities[key];
      else game.usedAbilities[key] = true;
      saveData();
      rerender();
    });
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
        const withRanged = army.models.filter((m) => m.rangedAttacks.length > 0);
        if (!withRanged.length) sub.appendChild(el(`<p class="empty">Geen models met ranged attacks.</p>`));
        for (const m of withRanged) {
          const mc = el(`<div class="card inner" style="margin-top:6px"><div class="card-header"><strong>${esc(m.name)}</strong>${m.champion ? '<span class="chip tag">Champion</span>' : ""}</div></div>`);
          mc.appendChild(weaponTable(m.rangedAttacks, minusOneToHit));
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
