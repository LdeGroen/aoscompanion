import { phaseLabel, enhancementCategoryLabel } from "./factions.js";
import { effectiveModel, modLabel } from "./enhancements.js";
import { icon } from "./icons.js";
import { openModal, buildModelPopupContent } from "./modelview.js";
import { loadGamedata } from "./battleplans.js";
import { buildBattleplanDetail } from "./battleplanview.js";
import { openDamageCalculator } from "./damage.js";
import * as sharedb from "./sharedb.js";
import { abilityBodyHtml } from "./abilityview.js";

// De naslag-menu's uit de topbar (battle tactics, spells, rules, enhancements, units,
// regiments, tegenstander, battleplan, schade) — gedeeld door de speelmodus en de set-up,
// zodat je in beide precies hetzelfde ziet.
//
// `game` mag null zijn (set-up zonder lopend potje): dan tellen alle units mee, komen
// je battle tactics uit de lijst en de seasonal rules uit het General's Handbook, en
// zijn de menu's die bij een potje horen (tegenstander, battleplan) niet beschikbaar.

// Rekenblad voor de schadecalculator buiten een potje: per leger, alleen deze sessie.
const scratch = new Map();

export function createArmyMenus({ army, game = null, el, esc, saveData = () => {}, onChange = () => {}, findUniversalManifest = null }) {
  const eff = (m) => effectiveModel(army, m);
  const wizLevel = (m) => parseInt(eff(m).model.wizardLevel) || 0;
  const prsLevel = (m) => parseInt(eff(m).model.priestLevel) || 0;
  const isActive = (m) => !game
    || ((m.type !== "Manifestation" || !!game.summoned?.[m.id]) && !game.disabled?.[m.id]);
  const activeModels = () => army.models.filter(isActive);

  // Zonder lopend potje laden we de universal manifestations zelf (voor klikbare lore-namen).
  let universal = null;
  const findManifest = (name) => findUniversalManifest
    ? findUniversalManifest(name)
    : (universal || []).find((m) => m.name.toLowerCase() === String(name || "").toLowerCase());
  const ensureUniversal = async () => {
    if (findUniversalManifest || universal || !army.manifestationLore?.universal) return;
    try { universal = (await sharedb.loadUniversalDb()).db.models.filter((m) => m.type === "Manifestation"); } catch { universal = []; }
  };

  function showModelPopup(m) {
    const extraTag = isActive(m) ? "" : (m.type === "Manifestation" ? "Niet gesummend" : "Uit de battle");
    openModal(buildModelPopupContent(m, { el, esc, army, extraTag }), el);
  }
  // Maakt een rij/kaart klikbaar om de model-popup te openen
  // (klikken op een knop erin blijft gewoon de knop bedienen).
  function makeClickable(node, m) {
    node.classList.add("clickable");
    node.addEventListener("click", (e) => {
      if (e.target.closest("button, input, label, .checkline")) return;
      showModelPopup(m);
    });
    return node;
  }

  // Detail-popup van één enhancement (naam, categorie, stat-mods, tekst).
  function enhDetail(enh) {
    const mods = (enh.statMods || []).map(modLabel).join(", ");
    return el(`<div>
      <h2>${icon("star")} ${esc(enh.name)}</h2>
      <p class="subtitle">${esc(enhancementCategoryLabel(enh.category))}</p>
      ${mods ? `<div class="subtitle">Stats: ${esc(mods)}</div>` : ""}
      <div style="margin-top:8px">${abilityBodyHtml(enh, esc)}</div>
    </div>`);
  }

  // Popup met de opvolgende stappen van een battle tactic.
  function showTacticSteps(t) {
    if (!t) return;
    const steps = t.steps || [];
    const wrap = el(`<div><h2>${esc(t.name)}</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    // Deployment-ability (bijv. Hideout / Fugitive): geen eigen stap, maar wel belangrijk om in te zien.
    for (const ab of t.abilities || []) {
      body.appendChild(el(`<div class="ability faction"><span class="aname">${esc(ab.name)}</span>${(ab.phases || []).includes("deployment") ? ' <span class="chip tag">Deployment</span>' : ""}${abilityBodyHtml(ab, esc)}</div>`));
    }
    if (!steps.length) body.appendChild(el(`<p class="empty">Geen stappen ingevoerd voor deze battle tactic (te bewerken in de database).</p>`));
    steps.forEach((s, i) => {
      const hasLabel = s.name && !/^stap\s*\d*$/i.test(s.name.trim());
      const heading = hasLabel ? esc(s.name) : `Stap ${i + 1}`;
      body.appendChild(el(`<div class="card inner"><div class="card-header"><h3>${heading}</h3></div>${s.description ? abilityBodyHtml({ description: s.description }, esc, { keywords: false, phases: false }) : ""}</div>`));
    });
    openModal(wrap, el);
  }

  // Jouw battle tactics (boven) en, in een potje, die van de tegenstander.
  async function showTacticsMenu() {
    let own = game?.tactics;
    if (!game) {
      let all = [];
      try { all = (await loadGamedata()).db.tactics || []; } catch { /* offline: alleen namen */ }
      own = (army.battleTactics || []).map((n) => all.find((t) => t.name === n) || { name: n });
    }
    const wrap = el(`<div><h2>${icon("flag")} Battle tactics</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    const section = (title, list, hint) => {
      body.appendChild(el(`<h3 style="margin-top:10px">${esc(title)}</h3>`));
      if (!list || !list.length) { body.appendChild(el(`<p class="empty">${hint}</p>`)); return; }
      for (const t of list) {
        const row = el(`<div class="card inner clickable" style="margin:4px 0"><div class="card-header"><strong>${esc(t.name)}</strong><span class="subtitle">stappen ›</span></div></div>`);
        row.addEventListener("click", () => showTacticSteps(t));
        body.appendChild(row);
      }
    };
    section("Jouw battle tactics", own, game ? "Geen battle tactics." : "Nog geen battle tactic cards gekozen — dat doe je in de set-up.");
    if (game) section(`Battle tactics van ${game.opponent?.name || "de tegenstander"}`, game.enemyTactics, "Geen battle tactics.");
    openModal(wrap, el);
  }

  function loreCard(title, lore, valuePrefix, linkManifests = false) {
    const card = el(`<div class="card inner"><h3>${title}: ${esc(lore.name)}</h3><div data-entries></div></div>`);
    const entries = card.querySelector("[data-entries]");
    for (const entry of lore.entries || []) {
      if (!entry.name && !entry.description) continue;
      const manif = linkManifests ? findManifest(entry.name) : null;
      const row = el(`<div class="lore-entry">
        <div class="lore-head">
          <strong class="${manif ? "lore-link" : ""}">${esc(entry.name)}</strong>
          ${entry.value ? `<span class="lval">${valuePrefix} ${esc(entry.value)}</span>` : ""}
        </div>
        ${abilityBodyHtml({ description: entry.description, keywords: entry.keywords }, esc, { phases: false })}
      </div>`);
      if (manif) row.querySelector("strong").addEventListener("click", () => openModal(buildModelPopupContent(manif, { el, esc }), el));
      entries.appendChild(row);
    }
    return card;
  }

  // Spell-/prayer-/manifestation lore + de spells van je models. Ook gebruikt in de hero phase.
  function renderLoresDisplay(target) {
    const hasWizard = army.models.some((m) => wizLevel(m) > 0);
    const hasPriest = army.models.some((m) => prsLevel(m) > 0);
    if (hasWizard && army.spellLore) target.appendChild(loreCard("Spell lore", army.spellLore, "Cast"));
    const spellModels = activeModels().filter((m) => (m.abilities || []).some((a) => a.isSpell));
    if (spellModels.length) {
      const card = el(`<div class="card inner"><h3>Spells van je models</h3><div data-entries></div></div>`);
      const entries = card.querySelector("[data-entries]");
      for (const m of spellModels) {
        for (const ab of m.abilities.filter((a) => a.isSpell)) {
          const row = el(`<div class="lore-entry">
            <div class="owner">${esc(m.name)}</div>
            <div class="lore-head"><strong>${esc(ab.name)}</strong> <span class="lval">Cast ${esc(ab.castingValue || "?")}</span></div>
            ${abilityBodyHtml(ab, esc, { phases: false })}
          </div>`);
          makeClickable(row, m);
          entries.appendChild(row);
        }
      }
      target.appendChild(card);
    }
    if (hasWizard && army.manifestationLore) target.appendChild(loreCard("Manifestation lore", army.manifestationLore, "Cast", army.manifestationLore.universal));
    if (hasPriest && army.prayerLore) target.appendChild(loreCard("Prayer lore", army.prayerLore, "Chant"));
  }

  async function showSpellsMenu() {
    await ensureUniversal();
    const wrap = el(`<div><h2>${icon("zap")} Spells & lores</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    renderLoresDisplay(body);
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen spell-, prayer- of manifestation lore in dit leger (of geen wizards/priests). Kies een lore in de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Faction-, subfaction- en seasonal rules.
  async function showRulesMenu() {
    let seasonal = game?.seasonalRules;
    if (!game) { try { seasonal = (await loadGamedata()).db.seasonalRules || []; } catch { seasonal = []; } }
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
          ${abilityBodyHtml(r, esc)}
        </div>`));
      }
    };
    addRules("Faction rules", army.factionRules);
    addRules(`Subfaction rules${army.subfaction ? " — " + army.subfaction : ""}`, army.subfactionRules);
    addRules("Seasonal rules", seasonal);
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen faction- of subfaction rules in dit leger. Kies een faction/subfaction in de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Alle enhancements op je models, gegroepeerd per model.
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
          ${abilityBodyHtml(enh, esc)}
        </div>`));
      }
      body.appendChild(card);
    }
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen enhancements op je models. Ken ze toe in de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Alle models in één lijst — klik voor de popup. In een potje kun je een unit
  // ook uit/aan zetten zodat hij uit de battle verdwijnt of weer meedoet.
  function showUnitsMenu() {
    const wrap = el(`<div>
      <h2>Units</h2>
      <p class="subtitle">${game
        ? "Klik op een unit voor alle informatie. Zet een unit uit (bijv. gesneuveld) om hem uit alle overzichten te halen; aanzetten brengt hem terug."
        : "Klik op een unit voor alle informatie."}</p>
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
          ${game ? `<button class="small ${active ? "" : "danger"}"></button>` : ""}
        </div>`);
        const btn = row.querySelector("button");
        if (btn) {
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
            onChange();
          });
        }
        makeClickable(row, m);
        list.appendChild(row);
      }
    };
    draw();
    openModal(wrap, el);
  }

  // Snel overzicht van welke units in welk regiment zitten.
  function showRegimentsMenu() {
    const wrap = el(`<div><h2>${icon("layers")} Regiments</h2>
      <p class="subtitle">Wie zit in welk regiment. Klik op een unit voor het kaartje.</p>
      <div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    const regs = army.regiments || [];
    const unitRow = (m, leader = false) => {
      const row = el(`<div class="card-header clickable" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span>${leader ? icon("star") + " " : ""}<strong>${esc(m.name)}</strong>${m.isGeneral ? ' <span class="chip tag">★ General</span>' : ""}${m.reinforced ? ' <span class="chip tag">Reinforced</span>' : ""}</span>
        <span class="subtitle">${esc(m.type || "")}</span>
      </div>`);
      makeClickable(row, m);
      return row;
    };
    const regCard = (title, models, titleIcon = "") => {
      const card = el(`<div class="card inner"><h3>${titleIcon}${esc(title)}</h3><div data-u></div></div>`);
      const u = card.querySelector("[data-u]");
      if (!models.length) u.appendChild(el(`<p class="empty">Leeg.</p>`));
      for (const [m, isL] of models) u.appendChild(unitRow(m, isL));
      body.appendChild(card);
    };
    const general = army.models.find((m) => m.isGeneral);
    const generalRid = general ? general.regimentId : null;
    const ordered = regs.filter((r) => !r.ror)
      .sort((a, b) => (a.id === generalRid ? -1 : 0) - (b.id === generalRid ? -1 : 0));
    for (const reg of ordered) {
      const inReg = army.models.filter((m) => m.regimentId === reg.id);
      const leader = inReg.find((m) => m.isLeader);
      const rest = inReg.filter((m) => !m.isLeader);
      regCard(leader ? leader.name : "Regiment zonder leider", [
        ...(leader ? [[leader, true]] : []),
        ...rest.map((m) => [m, false]),
      ]);
    }
    for (const reg of regs.filter((r) => r.ror)) {
      const inReg = army.models.filter((m) => m.regimentId === reg.id);
      regCard(reg.ror?.name || "Regiment of Renown", inReg.map((m) => [m, false]), icon("star") + " ");
    }
    const aux = army.models.filter((m) => !m.regimentId && !m.isLeader && m.type !== "Faction terrain" && m.type !== "Manifestation" && !m.fromTerrain);
    if (aux.length) regCard("Auxiliary units", aux.map((m) => [m, false]));
    const terrain = army.models.filter((m) => m.type === "Faction terrain" || m.fromTerrain);
    if (terrain.length) regCard("Faction terrain", terrain.map((m) => [m, false]));
    if (!body.children.length) {
      body.appendChild(el(`<p class="empty">Geen regiments ingedeeld. Deel je leger in bij de set-up.</p>`));
    }
    openModal(wrap, el);
  }

  // Het kaartje, de twist en hoe je scoort in het battleplan van dit potje.
  function showBattleplanMenu() {
    const bp = game?.battleplan;
    const wrap = el(`<div><h2>${icon("map")} Battleplan${bp ? " — " + esc(bp.name) : ""}</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    if (!bp) body.appendChild(el(`<p class="empty">Geen battleplan gekozen voor dit potje. Dat doe je in de battle set-up (bij een nieuw potje).</p>`));
    else body.appendChild(buildBattleplanDetail(bp, { el, esc }));
    openModal(wrap, el);
  }

  // Naam/faction van de tegenstander, de kaartjes van zijn models en zijn rules.
  function showOpponentMenu() {
    const o = game?.opponent || {};
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
      const row = el(`<div class="card-header clickable" style="padding:8px 0 6px">
        <span><strong>${esc(m.name)}</strong>${m.type ? ` <span class="chip tag">${esc(m.type)}</span>` : ""}</span>
        <span class="subtitle">Save ${esc(m.save)}${m.ward ? " · Ward " + esc(m.ward) : ""}</span>
      </div>`);
      row.addEventListener("click", () => openModal(buildModelPopupContent(m, { el, esc }), el));
      list.appendChild(row);
      const enhs = m.enhancements || [];
      const enhWrap = el(`<div class="chips" style="padding:0 0 8px;border-bottom:1px dashed var(--border);margin-bottom:2px"></div>`);
      for (const enh of enhs) {
        const chip = el(`<span class="chip tag clickable">${icon("star")} ${esc(enh.name)}</span>`);
        chip.addEventListener("click", () => openModal(enhDetail(enh), el));
        enhWrap.appendChild(chip);
      }
      if (enhs.length) list.appendChild(enhWrap);
      else row.style.borderBottom = "1px dashed var(--border)";
    }
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
                ${abilityBodyHtml(r, esc)}
              </div>`));
            }
          };
          addRules("Faction rules", db.factionRules);
          if (o.subfaction) addRules(`Subfaction rules — ${o.subfaction}`, db.subfactions?.[o.subfaction]?.rules);
          if (!rulesWrap.children.length) rulesWrap.appendChild(el(`<p class="empty">Geen rules in de ${esc(o.faction)}-database.</p>`));
        })
        .catch(() => {
          rulesWrap.innerHTML = "";
          rulesWrap.appendChild(el(`<p class="empty">Rules konden niet geladen worden (offline?).</p>`));
        });
    }
    openModal(wrap, el);
  }

  // Schadecalculator. In een potje bewaard op de game; daarbuiten een rekenblad zonder
  // tegenstander-kaartjes (save en ward vul je dan zelf in).
  function openDamage() {
    if (game) return openDamageCalculator({ army, game, el, esc, saveData });
    if (!scratch.has(army.id)) scratch.set(army.id, { opponent: { models: [] } });
    openDamageCalculator({ army, game: scratch.get(army.id), el, esc, saveData: () => {} });
  }

  // Alle knoppen op een rij, in dezelfde volgorde als de speelmodus. `extra` (html)
  // komt vooraan (bijv. de score-modus-schakelaar). Tegenstander en battleplan alleen in een potje.
  function buttonsHtml() {
    return `${game ? `<button class="small" data-menu="opponent">${icon("shield")} Tegenstander</button>` : ""}
      <button class="small" data-menu="damage">${icon("dice")} Schade</button>
      ${game ? `<button class="small" data-menu="battleplan">${icon("map")} Battleplan</button>` : ""}
      <button class="small" data-menu="tactics">${icon("flag")} Battle tactics</button>
      <button class="small" data-menu="spells">${icon("zap")} Spells</button>
      <button class="small" data-menu="rules">${icon("book")} Rules</button>
      <button class="small" data-menu="enh">${icon("star")} Enhancements</button>
      <button class="small" data-menu="units">${icon("users")} Units</button>
      <button class="small" data-menu="regiments">${icon("layers")} Regiments</button>`;
  }
  const ACTIONS = {
    opponent: showOpponentMenu, damage: openDamage, battleplan: showBattleplanMenu,
    tactics: showTacticsMenu, spells: showSpellsMenu, rules: showRulesMenu,
    enh: showEnhancementsMenu, units: showUnitsMenu, regiments: showRegimentsMenu,
  };
  function wireButtons(root) {
    for (const b of root.querySelectorAll("[data-menu]")) b.addEventListener("click", () => ACTIONS[b.dataset.menu]());
  }

  return {
    buttonsHtml, wireButtons, makeClickable, loreCard, showModelPopup, showTacticSteps, enhDetail, renderLoresDisplay,
    showTacticsMenu, showSpellsMenu, showRulesMenu, showEnhancementsMenu, showUnitsMenu, showRegimentsMenu,
    showBattleplanMenu, showOpponentMenu, openDamage,
  };
}
