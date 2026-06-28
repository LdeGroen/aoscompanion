import { AOS_FACTIONS, enhancementCategoryLabel, groupByType, loreKind, phaseLabel } from "./factions.js";
import { buildModelEditor, buildRuleEditor, buildLoreEditor, buildEnhancementEditor } from "./editors.js";
import { effectiveModel, migrateModelEnhancements, enhancementFits, modLabel } from "./enhancements.js";
import { hasWeaponOptions, groupKey, effectiveMax, groupBudget, groupUsed, loadoutSummary } from "./weaponoptions.js";
import { openModal, buildModelPopupContent } from "./modelview.js";
import { loadGamedata } from "./battleplans.js";
import * as sharedb from "./sharedb.js";
import { uid } from "./storage.js";
import { icon } from "./icons.js";

// Set-up mode: leger samenstellen, models invoeren, enhancements, lores en faction rules.
export function renderSetup(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.data.armies.find((a) => a.id === state.armyId);
  if (!army) return navigate("home");

  // Migratie voor data van vóór deze features
  for (const m of army.models) {
    m.type = m.type || "";
    m.ward = m.ward || "";
  }
  migrateModelEnhancements(army); // enhancementIds → embedded model.enhancements

  // ===================== List-building (regiments + punten) =====================
  const POINTS_LIMIT = 2000;
  const FREE_TYPES = new Set(["Manifestation", "Faction terrain"]);
  const isHero = (m) => m.type === "Hero" || m.type === "Named hero";
  // RoR-units tellen niet los mee (de RoR heeft een vaste prijs op het regiment).
  // Manifestaties zijn altijd gratis (lore-gedreven); faction terrain kán punten kosten
  // (bijv. Zontari Endrin Dock 20) en telt dus gewoon op m.points mee.
  const enhPoints = (m) => (m.enhancements || []).reduce((s, e) => s + (parseInt(e.points) || 0), 0);
  const pointsOf = (m) => (m.type === "Manifestation" || m.inRoR) ? 0 : ((parseInt(m.points) || 0) * (m.reinforced ? 2 : 1) + enhPoints(m));
  const rorPoints = () => army.regiments.reduce((s, r) => s + (r.ror ? (parseInt(r.ror.points) || 0) : 0), 0);
  const subfactionPoints = () => parseInt(army.subfactionPoints) || 0;
  // Lores kunnen punten kosten (sommige spell/prayer lores en universal manifestation lores).
  const lorePoints = () => ["spellLore", "manifestationLore", "prayerLore"].reduce((s, k) => s + (parseInt(army[k]?.points) || 0), 0);
  const totalPoints = () => army.models.reduce((s, m) => s + pointsOf(m), 0) + rorPoints() + subfactionPoints() + lorePoints();

  // Mag een unit in het regiment van deze leider? Geport van Sigdex' matchesRegimentOption:
  // keyword-opties gelden voor niet-heroes; heroes mogen alleen via een specifieke named-optie.
  // Geen opties bekend (oude data / ontbreekt) → alles toestaan (pragmatisch).
  function canTakeInRegiment(leader, unit) {
    const opts = leader && leader.regimentOptions;
    if (!opts || !opts.length) return true;
    const nm = (unit.name || "").toLowerCase();
    const kw = (unit.keywords || []).map((k) => k.toLowerCase());
    const hk = (unit.heroKeywords || []).map((k) => k.toLowerCase()); // hero-keywords (bijv. Guild Officer)
    const hero = isHero(unit);
    for (const opt of opts) {
      for (const o of opt.names || []) {
        const lo = o.toLowerCase();
        if (nm === lo) return true; // exacte unit/hero-naam
        if (hero) { if (hk.includes(lo)) return true; continue; } // heroes alleen via naam of hero-keyword (niet via brede keywords als "Infantry")
        const nonM = lo.match(/^non-(\S+)\s+(.+)/); // bijv. "non-Monster Skink"
        if (nonM) { if (!kw.includes(nonM[1]) && nonM[2].split(/\s+/).every((p) => kw.includes(p))) return true; continue; }
        if (kw.includes(lo)) return true; // hele keyword (ook met spatie, bijv. "kharadron overlords")
        if (lo.includes(" ") && lo.split(/\s+/).every((p) => kw.includes(p))) return true; // compound van losse keywords
      }
    }
    return false;
  }

  function copyForArmy(m) {
    const c = JSON.parse(JSON.stringify(m));
    c.id = uid(); c.type = c.type || ""; c.ward = c.ward || "";
    c.enhancements = []; c.reinforced = false; c.regimentId = ""; c.inRoR = false;
    delete c.enhancementIds; delete c.addedBy; delete c.isLeader; delete c.isGeneral; delete c.fromLore;
    return c;
  }

  // Migratie van bestaande legers naar de regiment-structuur (eenmalig)
  army.regiments = army.regiments || [];
  for (const m of army.models) {
    m.reinforced = m.reinforced || false;
    if (m.regimentId === undefined) m.regimentId = "";
  }
  if (army.models.length && !army.regiments.length) {
    const heroes = army.models.filter(isHero);
    const looseUnits = army.models.filter((m) => !isHero(m) && !FREE_TYPES.has(m.type));
    heroes.forEach((h, i) => {
      const rid = uid();
      army.regiments.push({ id: rid });
      h.isLeader = true; h.regimentId = rid;
      if (i === 0) for (const u of looseUnits) u.regimentId = rid;
    });
    if (heroes.length) heroes[0].isGeneral = true;
  }

  // Modal-picker: kies een warscroll uit de gedeelde database (gefilterd).
  // `restrict` (optioneel) = strengere filter (regiment-opties); een checkbox
  // laat de speler die negeren en alles tonen.
  async function pickModel({ title, filter, onPick, restrict = null }) {
    const wrap = el(`<div><h2>${esc(title)}</h2>${restrict ? `<label class="subtitle" style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="checkbox" data-all> Toon alle units (negeer regiment-opties)</label>` : ""}<div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    body.appendChild(el(`<p class="empty">Database laden…</p>`));
    const overlay = openModal(wrap, el);
    let models = [];
    try {
      const { db } = await sharedb.loadFactionDb(army.faction);
      const { db: uni } = await sharedb.loadUniversalDb();
      let factionModels = db.models || [];
      // Army of Renown: alleen de toegestane faction-units (strikt). Geen units
      // bekend → geen beperking. Universal manifestations blijven altijd kiesbaar.
      const a = currentArmyAoR();
      if (a && (a.units || []).length) {
        const allowed = new Set((a.units || []).map(normUnit));
        factionModels = factionModels.filter((m) => allowed.has(normUnit(m.name)));
      }
      models = [...factionModels, ...(uni.models || [])];
    } catch (e) {
      body.innerHTML = ""; body.appendChild(el(`<p class="empty" style="color:var(--red)">Database niet beschikbaar: ${esc(e.message)}</p>`));
      return;
    }
    const draw = (showAll) => {
      const filtered = models.filter((m) => filter(m) && (showAll || !restrict || restrict(m)));
      body.innerHTML = "";
      if (!filtered.length) { body.appendChild(el(`<p class="empty">${restrict && !showAll ? "Geen units die in dit regiment passen — vink hierboven aan om alles te tonen." : `Niets beschikbaar in de ${esc(army.faction)}-database.`}</p>`)); return; }
      for (const [typeLabel, group] of groupByType(filtered)) {
        const det = el(`<details class="type-group" open><summary>${esc(typeLabel)} <span class="count">(${group.length})</span></summary><div data-items></div></details>`);
        const items = det.querySelector("[data-items]");
        for (const m of group) {
          const row = el(`<div class="card-header clickable" style="padding:8px 0;border-bottom:1px dashed var(--border)">
            <span><strong>${esc(m.name)}</strong>${m.unique ? ' <span class="chip tag">Unique</span>' : ""}</span>
            <span class="subtitle">${m.points != null ? m.points + " pts" : "—"}${m.reinforceable ? " · reinf." : ""}</span>
          </div>`);
          row.addEventListener("click", () => { onPick(copyForArmy(m)); overlay.remove(); saveData(); rerender(); });
          items.appendChild(row);
        }
        body.appendChild(det);
      }
    };
    const cb = wrap.querySelector("[data-all]");
    if (cb) cb.addEventListener("change", () => draw(cb.checked));
    draw(false);
  }

  // Pragmatische validatie-waarschuwingen
  function rosterWarnings() {
    const w = [];
    if (totalPoints() > POINTS_LIMIT) w.push(`Boven de ${POINTS_LIMIT} punten.`);
    if (army.models.some(isHero) && !army.models.some((m) => m.isGeneral)) w.push("Nog geen General gekozen.");
    const uniq = {};
    for (const m of army.models) if (m.unique) uniq[m.name] = (uniq[m.name] || 0) + 1;
    for (const [n, c] of Object.entries(uniq)) if (c > 1) w.push(`Unique unit meer dan 1× in het leger: ${n}.`);
    // Regiment-opbouw: leider verplicht een hero; units moeten bij de regiment-opties passen
    for (const reg of army.regiments) {
      if (reg.ror) continue; // RoR is een vaste warband
      const inReg = army.models.filter((m) => m.regimentId === reg.id);
      const leader = inReg.find((m) => m.isLeader);
      if (!leader) { w.push("Een regiment heeft geen hero als leider."); continue; }
      if (!isHero(leader)) w.push(`Leider van een regiment is geen hero: ${leader.name}.`);
      const heroes = inReg.filter((m) => !m.isLeader && isHero(m));
      if (heroes.length > 1) w.push(`Regiment ${leader.name}: meer dan 1 extra hero.`);
      for (const u of inReg) {
        if (u.isLeader) continue;
        if (!canTakeInRegiment(leader, u)) w.push(`${u.name} past niet in het regiment van ${leader.name} (regiment-opties).`);
      }
    }
    return w;
  }

  // ===================== Personaliseren (alleen voor dit leger) =====================
  // Items komen 1-op-1 uit de database; met "Personaliseren" bewerk je de kopie in
  // jouw leger (volledige editor). De gedeelde database verandert hier niet.
  function personalizeModal(title, buildEditor) {
    const wrap = el(`<div><h2>${icon("edit")} Personaliseren — ${esc(title)}</h2>
      <p class="subtitle">Alleen voor dit leger; de gedeelde database verandert niet.</p>
      <div data-ed></div></div>`);
    const cont = wrap.querySelector("[data-ed]");
    const editor = buildEditor(cont);
    const overlay = openModal(wrap, el);
    const done = el(`<button class="primary bigbtn">${icon("check")} Klaar</button>`);
    done.addEventListener("click", () => { if (editor && editor.commit) editor.commit(); overlay.remove(); saveData(); rerender(); });
    wrap.appendChild(done);
  }
  function personalizeModel(m) {
    personalizeModal(m.name || "warscroll", (cont) => buildModelEditor({ container: cont, m, el, esc, onChange: () => {} }));
  }
  function personalizeEnhancement(enh) {
    personalizeModal(enh.name || "enhancement", (cont) => { cont.appendChild(buildEnhancementEditor({ enh, el, esc, onChange: saveData })); return null; });
  }
  function personalizeRule(r) {
    personalizeModal(r.name || "rule", (cont) => { cont.appendChild(buildRuleEditor({ rule: r, el, esc, onChange: saveData })); return null; });
  }
  function personalizeLore(kindKey, lore) {
    const build = (names) => personalizeModal(lore.name || "lore", (cont) => { cont.appendChild(buildLoreEditor({ lore, kind: kindKey, el, esc, onChange: saveData, universalChoice: true, manifestationOptions: names, onRedraw: () => {} })); return null; });
    if (kindKey === "manifestation") getUniversalManifestNames().then(build);
    else build(null);
  }

  // Compacte rij voor één model in de roster
  function modelRow(m, { leader = false } = {}) {
    const isManif = m.type === "Manifestation", isTerrain = m.type === "Faction terrain";
    const card = el(`<div class="card inner clickable" style="margin:6px 0">
      <div class="card-header"><div>
        <strong>${esc(m.name)}</strong>${m.isGeneral ? ' <span class="chip tag">★ General</span>' : ""}${m.unique ? ' <span class="chip tag">Unique</span>' : ""}${(m.keywords || []).some((k) => String(k).toLowerCase() === "paragon") ? ` <span class="chip paragon">${icon("star")} Paragon</span>` : ""}
        <div class="subtitle">${pointsOf(m)} pts${m.reinforced ? " · reinforced" : ""}${(m.enhancements || []).length ? ` · ${m.enhancements.length} enh` : ""}${hasWeaponOptions(m) && loadoutSummary(m) ? ` · ${esc(loadoutSummary(m))}` : ""}</div>
      </div></div>
      <div class="btnrow" data-actions></div>
    </div>`);
    card.addEventListener("click", (e) => { if (e.target.closest("button")) return; openModal(buildModelPopupContent(m, { el, esc, army }), el); });
    const act = card.querySelector("[data-actions]");
    const addBtn = (label, cls, fn) => { const b = el(`<button class="small ${cls || ""}">${label}</button>`); b.addEventListener("click", fn); act.appendChild(b); };
    if (m.reinforceable) addBtn(`${icon(m.reinforced ? "check" : "plus")} Reinforced`, m.reinforced ? "primary" : "", () => { m.reinforced = !m.reinforced; saveData(); rerender(); });
    if (!isManif && !isTerrain) addBtn(`${icon("plus")} Enhancements${(m.enhancements || []).length ? ` (${m.enhancements.length})` : ""}`, "", () => showEnhancementPicker(m));
    if (hasWeaponOptions(m)) addBtn(`${icon("sword")} Wapenopties`, "", () => showWeaponOptions(m));
    if (!m.inRoR) addBtn(`${icon("edit")} Personaliseren`, "", () => personalizeModel(m));
    if (leader) addBtn(`★ ${m.isGeneral ? "General" : "Maak general"}`, m.isGeneral ? "primary" : "", () => { army.models.forEach((x) => { x.isGeneral = false; }); m.isGeneral = true; saveData(); rerender(); });
    addBtn(icon("trash"), "danger", () => {
      if (leader) {
        if (!confirm("Leider verwijderen? Het hele regiment (met units) wordt verwijderd.")) return;
        army.models = army.models.filter((x) => x.regimentId !== m.regimentId);
        army.regiments = army.regiments.filter((r) => r.id !== m.regimentId);
      } else {
        army.models = army.models.filter((x) => x.id !== m.id);
      }
      saveData(); rerender();
    });
    return card;
  }

  function renderRegiment(reg) {
    if (reg.ror) return renderRoR(reg);
    const inReg = army.models.filter((m) => m.regimentId === reg.id);
    const leader = inReg.find((m) => m.isLeader);
    const units = inReg.filter((m) => !m.isLeader);
    const regPts = inReg.reduce((s, m) => s + pointsOf(m), 0);
    const card = el(`<div class="card">
      <div class="card-header"><h3>${icon("shield")} ${leader ? esc(leader.name) : "Regiment"}</h3><span class="subtitle">${regPts} pts</span></div>
      <div data-leader></div><div data-units></div>
      <div class="btnrow"><button class="small" data-add>${icon("plus")} Unit toevoegen</button></div>
    </div>`);
    if (leader) card.querySelector("[data-leader]").appendChild(modelRow(leader, { leader: true }));
    const uwrap = card.querySelector("[data-units]");
    if (!units.length) uwrap.appendChild(el(`<p class="empty">Nog geen units in dit regiment.</p>`));
    for (const u of units) uwrap.appendChild(modelRow(u, {}));
    card.querySelector("[data-add]").addEventListener("click", () => pickModel({
      title: "Unit toevoegen aan regiment",
      // heroes mogen ook (regimental heroes), maar alleen als de leider ze toestaat
      filter: (m) => m.type !== "Faction terrain" && m.type !== "Manifestation" && !(m.isLeader),
      restrict: (m) => canTakeInRegiment(leader, m),
      onPick: (u) => { u.regimentId = reg.id; u.isLeader = false; army.models.push(u); },
    }));
    app.appendChild(card);
  }

  // Regiment of Renown: vaste warband (eigen prijs, units niet bewerkbaar).
  function showRoRRules(reg) {
    const ror = reg.ror || {};
    let abilities = ror.abilities;
    if ((!abilities || !abilities.length) && rorList) abilities = (rorList.find((r) => r.name === ror.name) || {}).abilities;
    const inReg = army.models.filter((m) => m.regimentId === reg.id);
    const wrap = el(`<div>
      <h2>${icon("star")} ${esc(ror.name)}</h2>
      <p class="subtitle">${parseInt(ror.points) || 0} pts · ${inReg.map((m) => esc(m.name)).join(", ")}</p>
      <div data-abs></div>
    </div>`);
    const ab = wrap.querySelector("[data-abs]");
    if (abilities && abilities.length) {
      for (const a of abilities) ab.appendChild(el(`<div class="card inner"><h3>${esc(a.name || "Regel")}</h3><div class="muted-list">${esc(a.description || "")}</div></div>`));
    } else {
      ab.appendChild(el(`<p class="empty">Geen RoR-regels bekend. Je kunt ze toevoegen in de database.</p>`));
    }
    openModal(wrap, el);
  }

  function renderRoR(reg) {
    const inReg = army.models.filter((m) => m.regimentId === reg.id);
    const card = el(`<div class="card">
      <div class="card-header clickable" data-info><h3>${icon("star")} ${esc(reg.ror.name)} <span class="chip tag">RoR</span></h3><span class="subtitle">${parseInt(reg.ror.points) || 0} pts ${icon("book")}</span></div>
      <p class="subtitle" style="margin-top:0">Klik voor de RoR-regel(s).</p>
      <div data-units></div>
      <div class="btnrow"><button class="small danger" data-del>${icon("trash")} Regiment of Renown verwijderen</button></div>
    </div>`);
    card.querySelector("[data-info]").addEventListener("click", () => showRoRRules(reg));
    const uwrap = card.querySelector("[data-units]");
    for (const u of inReg) {
      const row = el(`<div class="card inner clickable" style="margin:6px 0"><div class="card-header"><div><strong>${esc(u.name)}</strong><div class="subtitle">vast onderdeel van de RoR</div></div></div></div>`);
      row.addEventListener("click", () => openModal(buildModelPopupContent(u, { el, esc, army }), el));
      uwrap.appendChild(row);
    }
    card.querySelector("[data-del]").addEventListener("click", () => {
      army.models = army.models.filter((m) => m.regimentId !== reg.id);
      army.regiments = army.regiments.filter((r) => r.id !== reg.id);
      saveData(); rerender();
    });
    app.appendChild(card);
  }

  function renderRoster() {
    const total = totalPoints(), over = total > POINTS_LIMIT;
    const warns = rosterWarnings();
    app.appendChild(el(`<div class="card">
      <div class="scoreline"><span>Punten</span> <strong style="color:${over ? "var(--red)" : "var(--gold)"}">${total}</strong> <span class="subtitle">/ ${POINTS_LIMIT}</span></div>
      ${warns.length ? `<div class="muted-list" style="color:var(--red)">⚠ ${warns.map(esc).join("<br>⚠ ")}</div>` : ""}
    </div>`));

    app.appendChild(el(`<h2>Regiments</h2>`));
    // Volgorde: het regiment van de general bovenaan, daarna de overige gewone regiments.
    const generalRid = (army.models.find((m) => m.isGeneral) || {}).regimentId;
    const regiments = army.regiments.filter((r) => !r.ror)
      .sort((a, b) => (a.id === generalRid ? -1 : 0) - (b.id === generalRid ? -1 : 0));
    for (const reg of regiments) renderRegiment(reg);
    const addRegCard = el(`<div class="card"><button class="primary" data-add>${icon("plus")} Regiment toevoegen (kies een hero als leider)</button></div>`);
    addRegCard.querySelector("[data-add]").addEventListener("click", () => pickModel({
      title: "Kies een hero als regiment-leider",
      filter: (m) => isHero(m),
      onPick: (h) => { const rid = uid(); army.regiments.push({ id: rid }); h.isLeader = true; h.regimentId = rid; if (!army.models.some((x) => x.isGeneral)) h.isGeneral = true; army.models.push(h); },
    }));
    app.appendChild(addRegCard);

    // Auxiliary units (niet in een regiment)
    const aux = army.models.filter((m) => !m.regimentId && !m.isLeader && !FREE_TYPES.has(m.type));
    const auxCard = el(`<div class="card"><h2>Auxiliary units</h2><div data-list></div><div class="btnrow"><button class="small" data-add>${icon("plus")} Auxiliary unit toevoegen</button></div></div>`);
    const auxList = auxCard.querySelector("[data-list]");
    if (!aux.length) auxList.appendChild(el(`<p class="empty">Geen auxiliary units.</p>`));
    for (const u of aux) auxList.appendChild(modelRow(u, {}));
    auxCard.querySelector("[data-add]").addEventListener("click", () => pickModel({
      title: "Auxiliary unit toevoegen",
      filter: (m) => m.type !== "Faction terrain" && m.type !== "Manifestation",
      onPick: (u) => { u.regimentId = ""; army.models.push(u); },
    }));
    app.appendChild(auxCard);

    // Faction terrain (gratis, 1)
    const terrain = army.models.filter((m) => m.type === "Faction terrain");
    const terCard = el(`<div class="card"><h2>Faction terrain</h2><div data-list></div><div class="btnrow"><button class="small" data-add>${icon("plus")} Faction terrain toevoegen</button></div></div>`);
    const terList = terCard.querySelector("[data-list]");
    if (!terrain.length) terList.appendChild(el(`<p class="empty">Geen faction terrain (gratis, max 1).</p>`));
    for (const t of terrain) terList.appendChild(modelRow(t, {}));
    terCard.querySelector("[data-add]").addEventListener("click", () => pickModel({
      title: "Faction terrain toevoegen",
      filter: (m) => m.type === "Faction terrain",
      onPick: (t) => { t.regimentId = ""; army.models.push(t); },
    }));
    app.appendChild(terCard);

    // Regiments of Renown (vaste warbands) — onderaan, en maximaal 1 per leger.
    if (rorList === null) loadRoR().then(() => rerender());
    app.appendChild(el(`<h2>${icon("star")} Regiments of Renown</h2>`));
    const rorRegs = army.regiments.filter((r) => r.ror);
    for (const reg of rorRegs) renderRoR(reg);
    const rorCard = el(`<div class="card"><div class="btnrow"></div></div>`);
    const rorBtnRow = rorCard.querySelector(".btnrow");
    if (rorRegs.length) {
      rorBtnRow.appendChild(el(`<p class="subtitle">Een leger mag maximaal 1 Regiment of Renown hebben.</p>`));
    } else if (rorList === null) {
      rorBtnRow.appendChild(el(`<p class="empty">Laden…</p>`));
    } else {
      const avail = rorForFaction();
      if (!avail.length) {
        rorBtnRow.appendChild(el(`<p class="empty">Geen Regiments of Renown voor ${esc(army.faction)}.</p>`));
      } else {
        const addBtn = el(`<button class="small" data-add>${icon("plus")} Regiment of Renown toevoegen</button>`);
        addBtn.addEventListener("click", () => {
          const wrap = el(`<div><h2>Regiment of Renown kiezen</h2><div data-body></div></div>`);
          const body = wrap.querySelector("[data-body]");
          const overlay = openModal(wrap, el);
          for (const r of avail) {
            const row = el(`<div class="card inner clickable" style="margin:6px 0"><div class="card-header"><div><strong>${esc(r.name)}</strong><div class="subtitle">${(r.units || []).map((u) => `${u.count > 1 ? u.count + "× " : ""}${esc(u.name)}`).join(", ")}</div></div><span class="subtitle">${parseInt(r.points) || 0} pts</span></div></div>`);
            row.addEventListener("click", () => { overlay.remove(); addRoR(r); });
            body.appendChild(row);
          }
        });
        rorBtnRow.appendChild(addBtn);
      }
    }
    app.appendChild(rorCard);

    // Manifestations (lore-gedreven, ter inzage)
    const manifs = army.models.filter((m) => m.type === "Manifestation");
    if (manifs.length) {
      const mc = el(`<div class="card"><h2>Manifestations</h2><p class="subtitle">Komen automatisch via je manifestation lore.</p><div data-list></div></div>`);
      for (const m of manifs) mc.querySelector("[data-list]").appendChild(modelRow(m, {}));
      app.appendChild(mc);
    }
  }

  // Faction-enhancements uit de database, voor de picker in de model-editor.
  // Async geladen; bij binnenkomst opnieuw renderen.
  let factionEnhancements = null;
  async function loadFactionEnhancements() {
    const a = currentArmyAoR();
    if (a) { factionEnhancements = a.enhancements || []; return; }
    try {
      const { db } = await sharedb.loadFactionDb(army.faction);
      factionEnhancements = db.enhancements || [];
    } catch {
      factionEnhancements = [];
    }
  }

  // Regiments of Renown uit de gedeelde database (key "regimentsofrenown").
  // Async geladen; null = nog niet geladen.
  let rorList = null;
  async function loadRoR() {
    try {
      const { db } = await sharedb.loadSharedBlob("regimentsofrenown", (raw) => (raw && Array.isArray(raw.list)) ? raw : { list: [] });
      rorList = db.list;
    } catch {
      rorList = [];
    }
  }
  // Armies of Renown uit de gedeelde database (key "armiesofrenown").
  let aorList = null;
  async function loadAoR() {
    try {
      const { db } = await sharedb.loadSharedBlob("armiesofrenown", (raw) => (raw && Array.isArray(raw.list)) ? raw : { list: [] });
      aorList = db.list;
    } catch {
      aorList = [];
    }
  }
  const aorForFaction = () => (aorList || []).filter((a) => a.faction === army.faction);
  const currentArmyAoR = () => (aorList || []).find((a) => a.faction === army.faction && a.name === army.aor) || null;
  const normUnit = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");

  // Een Army of Renown kiezen: faction rules vervangen door de AoR-battle-traits,
  // de enhancement-pool en lores worden die van de AoR, en de unit-keuze wordt
  // beperkt tot de toegestane units (afgedwongen in pickModel/de lore-picker).
  async function applyArmyOfRenownDefaults() {
    factionEnhancements = null; // pool verandert
    const a = currentArmyAoR();
    if (a) {
      army.factionRules = JSON.parse(JSON.stringify(a.rules || []));
      army.subfaction = ""; army.subfactionRules = []; army.subfactionPoints = 0;
    } else {
      await applyFactionDefaults();
    }
  }

  // RoR die deze faction mag nemen
  const rorForFaction = () => (rorList || []).filter((r) => (r.allowedArmies || []).some((a) => a.toLowerCase() === (army.faction || "").toLowerCase()));
  function addRoR(r) {
    if (army.regiments.some((x) => x.ror)) { alert("Een leger mag maximaal 1 Regiment of Renown hebben."); return; }
    const rid = uid();
    army.regiments.push({ id: rid, ror: { name: r.name, points: r.points, abilities: r.abilities || [] } });
    for (const u of r.units || []) {
      const n = parseInt(u.count) || 1;
      for (let i = 0; i < n; i++) {
        const m = copyForArmy(u.model || { name: u.name, type: "" });
        m.regimentId = rid; m.isLeader = false; m.inRoR = true; m.reinforced = false;
        army.models.push(m);
      }
    }
    saveData(); rerender();
  }

  // Kopieert de faction rules van de gekozen faction uit de gedeelde database
  // in dit leger (enhancements worden niet meer leger-breed gekopieerd — die
  // voeg je per model toe vanuit de database).
  async function applyFactionDefaults() {
    factionEnhancements = null; // andere faction → andere enhancement-pool
    try {
      const { db } = await sharedb.loadFactionDb(army.faction);
      army.factionRules = JSON.parse(JSON.stringify(db.factionRules));
      army.subfactionRules = [];
    } catch (e) {
      console.warn("Faction-database niet beschikbaar, geen defaults geladen:", e.message);
    }
  }

  async function applySubfactionDefaults() {
    try {
      const { db } = await sharedb.loadFactionDb(army.faction);
      const sub = db.subfactions[army.subfaction];
      army.subfactionRules = JSON.parse(JSON.stringify(sub?.rules || []));
      army.subfactionPoints = parseInt(sub?.points) || 0;
    } catch (e) {
      console.warn("Faction-database niet beschikbaar, geen defaults geladen:", e.message);
    }
  }

  // Een vers leger krijgt meteen de defaults van de (standaard geselecteerde) faction
  if (!army.dbDefaultsLoaded && !army.models.length && !army.factionRules.length && !army.subfactionRules.length) {
    army.dbDefaultsLoaded = true;
    applyFactionDefaults().then(() => { saveData(); rerender(); });
  }

  // sub-state binnen set-up
  let editing = null; // null | model object dat bewerkt wordt
  const collapsedTypes = new Set(); // ingeklapte type-groepen (blijft staan tijdens rerenders)

  // Delen in de gedeelde faction-database (voor alle accounts zichtbaar)
  async function shareToDb(fn, label, target = `${army.faction}-database`) {
    try {
      await fn();
      universalManifestNames = null; // cache verversen: er kan een universal manifestation bij zijn
      alert(`${label} gedeeld in de ${target}.`);
    } catch (e) {
      alert("Delen in de database mislukt: " + e.message);
    }
  }

  const modelShareTarget = (m) =>
    m.type === "Manifestation" && m.universal ? "universal database" : `${army.faction}-database`;

  // Snelle enhancement-picker (modal) voor één model — zonder de warscroll te
  // bewerken. Toont de faction-enhancements die bij het model-type passen;
  // aanvinken embedt een kopie op m.enhancements.
  function showEnhancementPicker(m) {
    m.enhancements = m.enhancements || [];
    const same = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() && a.category === b.category;
    const wrap = el(`<div><h2>Enhancements — ${esc(m.name)}</h2>
      <p class="subtitle">Artifacts of Power en Heroic Traits zijn voor Heroes; Other Enhancements voor het ingestelde model-type.</p>
      <div data-body></div>
    </div>`);
    const body = wrap.querySelector("[data-body]");
    const draw = () => {
      body.innerHTML = "";
      const pool = factionEnhancements || [];
      // Volgorde: Artefacts of Power, dan Heroic Traits, dan de rest (per type gegroepeerd).
      const catOrder = { artifact: 0, heroicTrait: 1, monstrousTrait: 2, other: 3 };
      const fits = pool.filter((e) => enhancementFits(e, m))
        .sort((a, b) => (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9) || String(a.name).localeCompare(String(b.name)));
      const stale = m.enhancements.filter((sel) => !fits.some((e) => same(e, sel)));
      if (factionEnhancements === null) { body.appendChild(el(`<p class="empty">Enhancements laden…</p>`)); return; }
      if (!fits.length && !stale.length) {
        body.appendChild(el(`<p class="empty">Geen enhancements in de ${esc(army.faction)}-database voor het type "${esc(m.type || "?")}".</p>`));
        return;
      }
      const render = (e, isStale) => {
        const mods = (e.statMods || []).map(modLabel).join(", ");
        const checked = m.enhancements.some((sel) => same(sel, e));
        const line = el(`<div class="checkline" style="align-items:flex-start">
          <input type="checkbox" ${checked ? "checked" : ""} />
          <span><strong>${esc(e.name)}</strong> <span class="subtitle">— ${esc(enhancementCategoryLabel(e.category))}${e.category === "other" && e.forType ? " (" + esc(e.forType) + ")" : ""}${e.points ? " · " + e.points + " pts" : ""}${mods ? " · " + esc(mods) : ""}</span>${isStale ? ' <span class="chip tag dim">past niet bij type</span>' : ""}${e.description ? `<div class="muted-list">${esc(e.description)}</div>` : ""}</span>
        </div>`);
        line.querySelector("input").addEventListener("change", (ev) => {
          if (ev.target.checked) m.enhancements.push(JSON.parse(JSON.stringify(e)));
          else m.enhancements = m.enhancements.filter((sel) => !same(sel, e));
          saveData();
          draw();
          rerender(); // werkt de teller in het overzicht bij (scrollpositie blijft)
        });
        // Personaliseren van een gekozen enhancement (de kopie op dit model, leger-only)
        if (checked) {
          const sel = m.enhancements.find((x) => same(x, e));
          const pBtn = el(`<button class="small">${icon("edit")} Personaliseren</button>`);
          pBtn.addEventListener("click", () => personalizeEnhancement(sel));
          line.querySelector("span").appendChild(el(`<div style="margin-top:4px"></div>`)).appendChild(pBtn);
        }
        body.appendChild(line);
      };
      for (const e of fits) render(e, false);
      for (const e of stale) render(e, true);
    };
    draw();
    if (factionEnhancements === null) loadFactionEnhancements().then(draw);
    openModal(wrap, el);
  }

  // Wapenopties: per optie kiezen op hoeveel modellen het wapen wordt gepakt.
  // Optional = los maximum (×2 bij reinforced); grouped = kies binnen een groep
  // (totaalbudget = aantal modellen, ×2 reinforced).
  function showWeaponOptions(m) {
    m.weaponLoadout = m.weaponLoadout || {};
    const lo = m.weaponLoadout;
    const reinf = !!m.reinforced;
    const wrap = el(`<div><h2>${icon("sword")} Wapenopties — ${esc(m.name)}</h2>
      <p class="subtitle">Kies op hoeveel modellen je het standaardwapen vervangt.${reinf ? " (Reinforced: dubbele aantallen.)" : ""}</p>
      <div data-body></div>
    </div>`);
    const body = wrap.querySelector("[data-body]");
    // groeperen: optionals los; grouped per (modelGroup+group)
    const opts = m.weaponOptions || [];
    const draw = () => {
      body.innerHTML = "";
      // per modelgroep een kopje als er meerdere zijn
      const modelGroups = [...new Set(opts.map((o) => o.modelGroup || ""))];
      for (const mg of modelGroups) {
        const inMg = opts.filter((o) => (o.modelGroup || "") === mg);
        if (mg) body.appendChild(el(`<h3 style="margin:10px 0 2px">${esc(mg)}</h3>`));
        // grouped-keuzes per group-naam bundelen
        const grouped = inMg.filter((o) => o.type === "grouped");
        const optional = inMg.filter((o) => o.type === "optional");
        for (const o of optional) row(o, effectiveMax(o, reinf));
        const byGroup = [...new Set(grouped.map((o) => o.group || ""))];
        for (const g of byGroup) {
          const gOpts = grouped.filter((o) => (o.group || "") === g);
          const budget = groupBudget(gOpts[0], reinf);
          body.appendChild(el(`<div class="subtitle" style="margin-top:6px">${esc(g || "Keuze")} — kies max ${budget}</div>`));
          for (const o of gOpts) {
            const used = groupUsed(m, o, o.name);
            row(o, Math.min(budget - used, budget));
          }
        }
      }
    };
    const row = (o, max) => {
      const cur = parseInt(lo[o.name]) || 0;
      const line = el(`<div class="checkline" style="justify-content:space-between;align-items:center">
        <span><strong>${esc(o.name)}</strong>${o.replaces && o.replaces.length ? ` <span class="subtitle">— vervangt ${esc(o.replaces.join(" / "))}</span>` : ""}</span>
        <span class="btnrow" style="margin:0">
          <button class="small" data-dec>−</button>
          <span data-val style="min-width:2.4em;text-align:center">${cur}</span>
          <button class="small" data-inc>+</button>
        </span>
      </div>`);
      const set = (v) => { v = Math.max(0, Math.min(max, v)); if (v) lo[o.name] = v; else delete lo[o.name]; saveData(); draw(); rerender(); };
      line.querySelector("[data-dec]").addEventListener("click", () => set(cur - 1));
      line.querySelector("[data-inc]").addEventListener("click", () => set(cur + 1));
      body.appendChild(line);
    };
    draw();
    openModal(wrap, el);
  }

  // Manifestaties op het model zetten op basis van de gekozen manifestation-lore
  // (warscrolls uit faction- + universal-database, gematcht op "Summon X" → "X").
  const normManif = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
  function syncArmyManifestations(lore, pool) {
    army.models = (army.models || []).filter((m) => !m.fromLore);
    if (!lore || lore.kind !== "manifestation") return;
    const manifs = pool.filter((m) => m.type === "Manifestation");
    for (const entry of lore.entries || []) {
      const name = entry.name.replace(/^summon\s+/i, "").trim();
      const src = manifs.find((m) => normManif(m.name) === normManif(name));
      if (!src) continue;
      const mc = JSON.parse(JSON.stringify(src));
      mc.id = uid();
      mc.enhancements = [];
      delete mc.enhancementIds; delete mc.addedBy;
      mc.fromLore = true;
      army.models.push(mc);
    }
  }

  // Lore kiezen uit de database (modal). Spell/prayer uit de faction-database,
  // manifestation uit faction + universal. Je maakt geen nieuwe lores meer aan.
  function showLorePicker(kindKey) {
    const def = loreKind(kindKey);
    const wrap = el(`<div><h2>${def.label} kiezen</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    body.appendChild(el(`<p class="empty">Lores laden…</p>`));
    const overlay = openModal(wrap, el);
    (async () => {
      let candidates = [], pool = [];
      try {
        const { db } = await sharedb.loadFactionDb(army.faction);
        const { db: uni } = await sharedb.loadUniversalDb();
        pool = [...(uni.models || []), ...(db.models || [])];
        const aorActive = currentArmyAoR();
        // Bij een Army of Renown gelden de AoR-lores in plaats van de faction-lores.
        candidates = (aorActive ? (aorActive.lores || []) : (db.lores || [])).filter((l) => l.kind === kindKey);
        if (kindKey === "manifestation") {
          candidates = candidates.concat((uni.lores || []).filter((l) => l.kind === "manifestation").map((l) => ({ ...l, universal: true })));
        }
      } catch (e) {
        body.innerHTML = "";
        body.appendChild(el(`<p class="empty" style="color:var(--red)">Database niet beschikbaar: ${esc(e.message)}</p>`));
        return;
      }
      body.innerHTML = "";
      if (!candidates.length) {
        body.appendChild(el(`<p class="empty">Geen ${def.label.toLowerCase()} in de database voor ${esc(army.faction)}.</p>`));
        return;
      }
      for (const l of candidates) {
        const entryNames = (l.entries || []).map((e) => e.name).filter(Boolean).join(" · ");
        const item = el(`<div class="card inner clickable">
          <div class="card-header"><h3>${esc(l.name)}</h3>${l.universal ? '<span class="chip tag">Universal</span>' : ""}</div>
          ${entryNames ? `<div class="muted-list">${esc(entryNames)}</div>` : ""}
        </div>`);
        item.addEventListener("click", () => {
          const copy = JSON.parse(JSON.stringify(l));
          delete copy.id; delete copy.addedBy;
          if (kindKey === "manifestation") {
            copy.universal = !!l.universal;
            syncArmyManifestations(copy, pool);
          }
          army[def.armyField] = copy;
          saveData();
          overlay.remove();
          rerender();
        });
        body.appendChild(item);
      }
    })();
  }

  // Namen van universal manifestation-models, voor de spell-picker in een
  // universal manifestation lore.
  let universalManifestNames = null;
  async function getUniversalManifestNames() {
    if (universalManifestNames) return universalManifestNames;
    try {
      const { db } = await sharedb.loadUniversalDb();
      universalManifestNames = db.models.filter((m) => m.type === "Manifestation").map((m) => m.name);
    } catch {
      universalManifestNames = [];
    }
    return universalManifestNames;
  }

  // scrollTop: alleen bij echte navigatie (editor openen/sluiten) naar boven;
  // bij invullen of aanvinken blijft de scrollpositie staan.
  function rerender(scrollTop = false) {
    const y = window.scrollY;
    app.innerHTML = "";
    if (editing) {
      renderModelEditor(editing);
    } else {
      renderArmyOverview();
    }
    window.scrollTo(0, scrollTop ? 0 : y);
  }

  // ===================== Battle tactic cards (bij de lijst) =====================
  let gdTactics = null; // gamedata-tactics, async geladen
  async function loadTactics() {
    try { gdTactics = (await loadGamedata()).db.tactics || []; } catch { gdTactics = []; }
  }
  function renderBattleTactics() {
    army.battleTactics = army.battleTactics || [];
    const card = el(`<div class="card"><h2>Battle Tactic Cards</h2><div data-body></div></div>`);
    app.appendChild(card);
    const body = card.querySelector("[data-body]");
    if (gdTactics === null) { loadTactics().then(() => rerender()); body.appendChild(el(`<p class="empty">Laden…</p>`)); return; }
    if (!army.battleTactics.length) body.appendChild(el(`<p class="empty">Nog geen battle tactic cards gekozen (kies er 2).</p>`));
    for (const name of army.battleTactics) {
      const row = el(`<div class="card inner clickable" style="margin:4px 0"><div class="card-header"><strong>${esc(name)}</strong><span class="subtitle">stappen ›</span></div></div>`);
      row.addEventListener("click", () => showTacticSteps(tacticByName(name)));
      body.appendChild(row);
    }
    const btn = el(`<button class="small" style="margin-top:6px">${icon("plus")} Battle tactic cards kiezen</button>`);
    btn.addEventListener("click", showTacticPicker);
    body.appendChild(btn);
  }
  const tacticByName = (name) => (gdTactics || []).find((t) => t.name === name);
  // Popup met de opvolgende stappen van een battle tactic.
  function showTacticSteps(t) {
    if (!t) return;
    const steps = t.steps || [];
    const wrap = el(`<div><h2>${esc(t.name)}</h2><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
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
  function showTacticPicker() {
    const wrap = el(`<div><h2>Battle tactic cards</h2><p class="subtitle">Kies er maximaal 2. Klik op "stappen" om de stappen te zien.</p><div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    const draw = () => {
      body.innerHTML = "";
      for (const t of (gdTactics || [])) {
        const checked = army.battleTactics.includes(t.name);
        const line = el(`<div class="checkline" style="align-items:center"><input type="checkbox" ${checked ? "checked" : ""} ${!checked && army.battleTactics.length >= 2 ? "disabled" : ""}/> <span style="flex:1"><strong>${esc(t.name)}</strong></span><button class="small" data-steps>stappen ›</button></div>`);
        line.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) { if (army.battleTactics.length < 2) army.battleTactics.push(t.name); }
          else army.battleTactics = army.battleTactics.filter((n) => n !== t.name);
          saveData(); draw();
        });
        line.querySelector("[data-steps]").addEventListener("click", () => showTacticSteps(t));
        body.appendChild(line);
      }
    };
    draw();
    const overlay = openModal(wrap, el);
    const done = el(`<button class="primary bigbtn">${icon("check")} Klaar</button>`);
    done.addEventListener("click", () => { overlay.remove(); rerender(); });
    wrap.appendChild(done);
  }

  // ===================== Lijst exporteren =====================
  function dropCount() {
    const regs = army.regiments.length; // elk regiment + RoR = 1 drop
    const aux = army.models.filter((m) => !m.regimentId && !m.isLeader && !FREE_TYPES.has(m.type)).length;
    return regs + aux;
  }
  function unitExportLines(m) {
    const out = [`${m.name} (${pointsOf(m)})`];
    if (m.isGeneral) out.push(" • General");
    if (m.reinforced) out.push(" • Reinforced");
    for (const e of (m.enhancements || [])) out.push(` • ${e.name}`);
    const wl = loadoutSummary(m);
    if (wl) out.push(` • ${wl}`);
    return out;
  }
  function buildExportText() {
    const L = [];
    L.push(`${army.name || "(naamloos)"} ${totalPoints()}/${POINTS_LIMIT} pts`);
    L.push("");
    if (army.faction) L.push(army.faction);
    const formation = army.aor || army.subfaction;
    if (formation) L.push(formation);
    L.push(`Drops: ${dropCount()}`);
    if (army.spellLore?.name) L.push(`Spell Lore - ${army.spellLore.name}`);
    if (army.prayerLore?.name) L.push(`Prayer Lore - ${army.prayerLore.name}`);
    if (army.manifestationLore?.name) L.push(`Manifestation Lore - ${army.manifestationLore.name}`);
    if ((army.battleTactics || []).length) { L.push(""); L.push(`Battle Tactic Cards: ${army.battleTactics.join(", ")}`); }

    // Regiments: generals regiment eerst, daarna genummerd
    const generalRid = (army.models.find((m) => m.isGeneral) || {}).regimentId;
    const regs = army.regiments.filter((r) => !r.ror).sort((a, b) => (a.id === generalRid ? -1 : 0) - (b.id === generalRid ? -1 : 0));
    let regNo = 0;
    for (const reg of regs) {
      L.push("");
      L.push(reg.id === generalRid ? "General's Regiment" : `Regiment ${++regNo}`);
      const inReg = army.models.filter((m) => m.regimentId === reg.id);
      const ordered = [...inReg.filter((m) => m.isLeader), ...inReg.filter((m) => !m.isLeader)];
      for (const m of ordered) L.push(...unitExportLines(m));
    }
    // Auxiliary units
    const aux = army.models.filter((m) => !m.regimentId && !m.isLeader && !FREE_TYPES.has(m.type));
    if (aux.length) { L.push(""); L.push("Auxiliary Units"); for (const m of aux) L.push(...unitExportLines(m)); }
    // Regiments of Renown
    for (const reg of army.regiments.filter((r) => r.ror)) {
      L.push(""); L.push("Regiment of Renown");
      L.push(`${reg.ror.name} (${parseInt(reg.ror.points) || 0})`);
      for (const m of army.models.filter((x) => x.regimentId === reg.id)) L.push(` • ${m.name}`);
    }
    // Faction terrain
    const terrain = army.models.filter((m) => m.type === "Faction terrain");
    if (terrain.length) { L.push(""); L.push("Faction Terrain"); for (const t of terrain) L.push(pointsOf(t) > 0 ? `${t.name} (${pointsOf(t)})` : t.name); }
    return L.join("\n");
  }
  function showExport() {
    const text = buildExportText();
    const wrap = el(`<div><h2>${icon("copy")} Lijst exporteren</h2>
      <p class="subtitle">Kopieer de tekst en plak hem waar je wilt.</p>
      <textarea readonly style="width:100%;min-height:320px;font-family:monospace;font-size:0.8rem;white-space:pre"></textarea>
      <div class="btnrow"></div></div>`);
    const ta = wrap.querySelector("textarea"); ta.value = text;
    const overlay = openModal(wrap, el);
    const copyBtn = el(`<button class="primary bigbtn">${icon("copy")} Kopieer naar klembord</button>`);
    copyBtn.addEventListener("click", async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { ta.focus(); ta.select(); try { ok = document.execCommand("copy"); } catch {} }
      copyBtn.innerHTML = ok ? `${icon("check")} Gekopieerd!` : `${icon("copy")} Kopiëren mislukt — selecteer handmatig`;
      setTimeout(() => { copyBtn.innerHTML = `${icon("copy")} Kopieer naar klembord`; }, 2000);
    });
    wrap.querySelector(".btnrow").appendChild(copyBtn);
  }

  // ===================== Leger-overzicht =====================
  function renderArmyOverview() {
    const header = el(`<div class="topbar">
      <span class="title">Set-up mode</span>
      <div style="display:flex;gap:6px">
        <button class="small" id="btn-export">${icon("share")} Exporteren</button>
        <button class="small" id="btn-db">${icon("book")} Database</button>
        <button class="small" id="btn-back">${icon("back")} Mijn legers</button>
      </div>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => { saveData(); navigate("home"); });
    header.querySelector("#btn-db").addEventListener("click", () => { saveData(); navigate("database", { armyId: army.id, dbReturn: "setup" }); });
    header.querySelector("#btn-export").addEventListener("click", showExport);
    app.appendChild(header);

    // --- Leger basis ---
    const base = el(`<div class="card">
      <h2>Leger</h2>
      <label>Naam van je leger</label>
      <input type="text" id="army-name" value="${esc(army.name)}" placeholder="bijv. De Doodskloppers" />
      <div class="row">
        <div>
          <label>Army</label>
          <select id="army-faction"></select>
        </div>
        <div>
          <label>Subfaction</label>
          <select id="army-subfaction"></select>
        </div>
      </div>
      <div data-aor></div>
      <div data-subpts></div>
      <p class="subtitle">Bij het kiezen van een army of subfaction worden de rules en enhancements uit de gedeelde database automatisch in dit leger gezet — daarna kun je ze hier aanpassen.</p>
    </div>`);
    app.appendChild(base);

    // Army of Renown-keuze: een alternatieve manier om de faction te spelen
    // (eigen faction rules, enhancements, lores en een beperkte unit-keuze).
    if (aorList === null) loadAoR().then(() => rerender());
    const aorWrap = base.querySelector("[data-aor]");
    const aors = aorForFaction();
    if (aorList === null) {
      aorWrap.appendChild(el(`<p class="subtitle">Armies of Renown laden…</p>`));
    } else if (aors.length) {
      const aw = el(`<div style="margin-top:6px"><label>Army of Renown</label><select id="army-aor"><option value="">— geen (standaard) —</option>${aors.map((a) => `<option value="${esc(a.name)}" ${a.name === army.aor ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>${army.aor ? `<p class="subtitle">Army of Renown actief: eigen faction rules en enhancements, en alleen de toegestane units zijn kiesbaar.</p>` : ""}</div>`);
      aw.querySelector("#army-aor").addEventListener("change", async (e) => {
        army.aor = e.target.value || null;
        await applyArmyOfRenownDefaults();
        saveData();
        rerender();
      });
      aorWrap.appendChild(aw);
    }

    // Subfaction-punten (battle formations kunnen punten kosten; bewerkbaar voor uitzonderingen)
    const subPtsWrap = base.querySelector("[data-subpts]");
    if (army.subfaction) {
      const sp = el(`<div style="margin-top:6px"><label>Punten subfaction / battle formation</label><input type="number" id="army-subpts" min="0" value="${esc(army.subfactionPoints || 0)}" /></div>`);
      sp.querySelector("#army-subpts").addEventListener("change", (e) => { army.subfactionPoints = parseInt(e.target.value) || 0; saveData(); rerender(); });
      subPtsWrap.appendChild(sp);
    }

    const facSel = base.querySelector("#army-faction");
    const subSel = base.querySelector("#army-subfaction");
    for (const f of Object.keys(AOS_FACTIONS)) {
      facSel.appendChild(el(`<option value="${esc(f)}" ${f === army.faction ? "selected" : ""}>${esc(f)}</option>`));
    }
    const fillSubs = () => {
      subSel.innerHTML = `<option value="">— geen —</option>`;
      for (const s of AOS_FACTIONS[army.faction] || []) {
        subSel.appendChild(el(`<option value="${esc(s)}" ${s === army.subfaction ? "selected" : ""}>${esc(s)}</option>`));
      }
    };
    fillSubs();
    base.querySelector("#army-name").addEventListener("input", (e) => { army.name = e.target.value; saveData(); });
    // Bij het kiezen van een (sub)faction worden de bijbehorende rules en
    // enhancements automatisch uit de gedeelde database gekopieerd.
    facSel.addEventListener("change", async () => {
      army.faction = facSel.value;
      army.subfaction = "";
      army.aor = null; // Army of Renown hoort bij een faction
      await applyFactionDefaults();
      saveData();
      rerender();
    });
    subSel.addEventListener("change", async () => {
      army.subfaction = subSel.value;
      if (army.subfaction) {
        if (army.aor) { army.aor = null; await applyFactionDefaults(); } // subfaction en AoR sluiten elkaar uit
        await applySubfactionDefaults();
      } else { army.subfactionRules = []; army.subfactionPoints = 0; }
      saveData();
      rerender();
    });

    // --- Battle tactic cards (bij de lijst) — direct onder faction/subfaction ---
    renderBattleTactics();

    // --- Roster (regiments, punten, auxiliary, terrain) ---
    renderRoster();

    // --- Lores ---
    renderLores();

    // --- Faction & subfaction rules ---
    renderRulesSection("Faction rules", army.factionRules, false);
    renderRulesSection("Subfaction rules", army.subfactionRules, true);

    const done = el(`<button class="primary bigbtn">${icon("check")} Klaar — terug naar mijn legers</button>`);
    done.addEventListener("click", () => { saveData(); navigate("home"); });
    app.appendChild(done);
  }

  // ===================== Kaartjes-picker (uit de gedeelde database) =====================
  // Haalt de kaartjes uit de gedeelde faction-database (+ universal
  // manifestations) — niet uit lokale opslag; daar is de database voor.
  function renderLibraryPicker() {
    app.innerHTML = "";
    const header = el(`<div class="topbar">
      <span class="title">Kaartjes uit de database</span>
      <button class="small" id="btn-back">${icon("back")} Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", rerender);
    app.appendChild(header);

    const body = el(`<div></div>`);
    app.appendChild(body);
    body.appendChild(el(`<p class="empty">Database laden…</p>`));

    (async () => {
      let models = [];
      try {
        const { db } = await sharedb.loadFactionDb(army.faction);
        const { db: uni } = await sharedb.loadUniversalDb();
        // Manifestaties komen lore-gedreven in het leger, niet via deze picker
        models = [
          ...db.models.map((m) => ({ m, isUniversal: false })),
          ...uni.models.map((m) => ({ m, isUniversal: true })),
        ].filter(({ m }) => m.type !== "Manifestation");
      } catch (e) {
        body.innerHTML = "";
        body.appendChild(el(`<p class="empty" style="color:var(--red)">Database laden mislukt: ${esc(e.message)}</p>`));
        return;
      }
      body.innerHTML = "";
      if (!models.length) {
        body.appendChild(el(`<p class="empty">Nog geen kaartjes in de ${esc(army.faction)}-database. Deel een kaartje bij het opslaan van een model, of via de knop "Deel in database".</p>`));
        return;
      }
      for (const { m, isUniversal } of models) {
        const tags = [m.type, isUniversal ? "Universal" : ""].filter(Boolean);
        const card = el(`<div class="card">
          <div class="card-header">
            <div>
              <h3>${esc(m.name)}</h3>
              <div class="subtitle">Move ${esc(m.move)} · Health ${esc(m.health)} · Save ${esc(m.save)}${m.ward ? " · Ward " + esc(m.ward) : ""} · ${(m.rangedAttacks || []).length} ranged · ${(m.meleeAttacks || []).length} melee</div>
              ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
            </div>
          </div>
          <div class="btnrow">
            <button class="primary small" data-act="add">${icon("plus")} Toevoegen aan leger</button>
          </div>
        </div>`);
        card.querySelector('[data-act="add"]').addEventListener("click", () => {
          const copy = JSON.parse(JSON.stringify(m));
          copy.id = uid();
          copy.type = copy.type || "";
          copy.ward = copy.ward || "";
          copy.enhancements = [];
          delete copy.enhancementIds;
          delete copy.addedBy;
          army.models.push(copy);
          saveData();
          rerender();
        });
        body.appendChild(card);
      }
    })();
  }

  // ===================== Model editor =====================
  function blankModel() {
    return {
      id: uid(),
      name: "",
      type: "",
      move: "",
      fly: false,
      health: 1,
      control: 1,
      controlBonus: 0,
      save: "4+",
      ward: "",
      banishment: "",
      universal: false,
      enhancements: [],
      wizardLevel: 0,
      priestLevel: 0,
      champion: false,
      musician: false,
      standardBearer: false,
      rangedAttacks: [],
      meleeAttacks: [],
      abilities: [],
    };
  }

  function renderModelEditor(m) {
    const isNew = !army.models.some((x) => x.id === m.id);
    const header = el(`<div class="topbar">
      <span class="title">${isNew ? "Nieuw model" : "Model bewerken"}</span>
      <button class="small" id="btn-cancel">${icon("back")} Annuleren</button>
    </div>`);
    header.querySelector("#btn-cancel").addEventListener("click", () => { editing = null; rerender(true); });
    app.appendChild(header);

    const editor = buildModelEditor({ container: app, m, el, esc, onChange: saveData });

    // --- Opslaan ---
    const shareLine = el(`<div class="card"><div class="checkline">
      <input type="checkbox" id="m-share" />
      <span>Deel dit kaartje ook in de gedeelde database (zichtbaar voor alle accounts; universal manifestations gaan naar de universal database, de rest naar de ${esc(army.faction)}-database)</span>
    </div></div>`);
    app.appendChild(shareLine);
    const saveBtn = el(`<button class="primary bigbtn">${icon("check")} Model opslaan</button>`);
    saveBtn.addEventListener("click", () => {
      if (!editor.commit()) { alert("Geef het model een naam."); return; }
      if (isNew) army.models.push(m);
      saveData();
      if (shareLine.querySelector("#m-share").checked) {
        shareToDb(() => sharedb.shareModel(army.faction, m, state.user), `Kaartje "${m.name}"`, modelShareTarget(m));
      }
      editing = null;
      rerender(true);
    });
    app.appendChild(saveBtn);
  }

  // ===================== Lores =====================
  function renderLores() {
    // Effectieve levels: een enhancement kan een model wizard/priest maken,
    // dan moet je hier al de bijbehorende lores kunnen kiezen.
    const effLevel = (m, field) => parseInt(effectiveModel(army, m).model[field]) || 0;
    const hasWizard = army.models.some((m) => effLevel(m, "wizardLevel") > 0);
    const hasPriest = army.models.some((m) => effLevel(m, "priestLevel") > 0);

    const card = el(`<div class="card"><h2>Lores</h2><div data-content></div></div>`);
    app.appendChild(card);
    const content = card.querySelector("[data-content]");

    if (!hasWizard && !hasPriest) {
      content.appendChild(el(`<p class="empty">Geen models met wizard level of priest level 1 of hoger — je kunt geen lores kiezen.</p>`));
      return;
    }
    if (hasWizard) {
      renderLoreEditor(content, "spell");
      renderLoreEditor(content, "manifestation");
    }
    if (hasPriest) {
      renderLoreEditor(content, "prayer");
    }
  }

  function renderLoreEditor(parent, kindKey) {
    const def = loreKind(kindKey);
    const wrap = el(`<div class="card inner"><h3>${def.label}</h3><div data-body></div></div>`);
    parent.appendChild(wrap);
    const body = wrap.querySelector("[data-body]");

    const draw = () => {
      body.innerHTML = "";
      const lore = army[def.armyField];
      if (!lore) {
        const btn = el(`<button class="small">${icon("plus")} ${def.label} kiezen uit database</button>`);
        btn.addEventListener("click", () => showLorePicker(kindKey));
        body.appendChild(el(`<p class="empty">Nog geen ${def.label.toLowerCase()} gekozen (optioneel).</p>`));
        body.appendChild(btn);
        return;
      }
      const entryNames = (lore.entries || []).map((e) => e.name).filter(Boolean).join(" · ");
      const item = el(`<div class="card inner">
        <div class="card-header"><h3>${esc(lore.name || "(naamloos)")}</h3><span class="subtitle">${lore.universal ? '<span class="chip tag">Universal</span> ' : ""}${lore.points ? (parseInt(lore.points) || 0) + " pts" : ""}</span></div>
        ${entryNames ? `<div class="muted-list">${esc(entryNames)}</div>` : ""}
        <div class="btnrow">
          <button class="small" data-pers>${icon("edit")} Personaliseren</button>
          <button class="small" data-change>${icon("book")} Andere kiezen</button>
          <button class="small danger" data-del>${icon("trash")} ${def.label} verwijderen</button>
        </div>
      </div>`);
      item.querySelector("[data-pers]").addEventListener("click", () => personalizeLore(kindKey, lore));
      item.querySelector("[data-change]").addEventListener("click", () => showLorePicker(kindKey));
      item.querySelector("[data-del]").addEventListener("click", () => {
        if (!confirm(`${def.label} verwijderen?`)) return;
        army[def.armyField] = null;
        if (kindKey === "manifestation") army.models = army.models.filter((m) => !m.fromLore);
        saveData();
        draw();
      });
      body.appendChild(item);
    };
    draw();
  }

  // ===================== Faction / subfaction rules =====================
  function renderRulesSection(title, rules, isSubfaction) {
    const wrap = el(`<div class="card"><h2>${title}</h2><div data-list></div><button class="small" data-add>${icon("plus")} Eigen rule toevoegen</button></div>`);
    app.appendChild(wrap);
    const list = wrap.querySelector("[data-list]");

    const draw = () => {
      list.innerHTML = "";
      if (!rules.length) list.appendChild(el(`<p class="empty">Geen ${title.toLowerCase()}.</p>`));
      rules.forEach((r, i) => {
        const item = el(`<div class="card inner">
          <div class="card-header"><h3>${esc(r.name || "(naamloos)")}</h3>${r.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}</div>
          ${(r.phases || []).length ? `<div class="subtitle">Phases: ${r.phases.map((p) => esc(phaseLabel(p))).join(", ")}</div>` : ""}
          <div class="muted-list">${esc(r.description || "")}</div>
          <div class="btnrow"><button class="small" data-pers>${icon("edit")} Personaliseren</button><button class="small danger" data-del>${icon("trash")} Verwijderen</button></div>
        </div>`);
        item.querySelector("[data-pers]").addEventListener("click", () => personalizeRule(r));
        item.querySelector("[data-del]").addEventListener("click", () => { rules.splice(i, 1); saveData(); draw(); });
        list.appendChild(item);
      });
    };
    draw();
    wrap.querySelector("[data-add]").addEventListener("click", () => {
      const r = { name: "Nieuwe rule", phases: [], description: "" };
      rules.push(r);
      saveData();
      draw();
      personalizeRule(r);
    });
  }

  rerender();
}
