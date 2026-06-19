import { AOS_FACTIONS, ENHANCEMENT_CATEGORIES, LORE_KINDS, MODEL_TYPES, groupByType, phaseLabel } from "./factions.js";
import { modLabel } from "./enhancements.js";
import { buildModelEditor, buildEnhancementEditor, buildRuleEditor, buildLoreEditor } from "./editors.js";
import * as sharedb from "./sharedb.js";
import { uid } from "./storage.js";
import { icon } from "./icons.js";
import { openModal, buildModelPopupContent } from "./modelview.js";
import { buildBattleplanAbilityEditor, buildTacticEditor } from "./editors.js";
import { loadGamedata, saveGamedata, scoringOptionsFor } from "./battleplans.js";

// De gedeelde database: per faction alle gedeelde kaartjes, enhancements en
// rules, toegankelijk voor alle accounts. Open je hem vanuit set-up, dan kun
// je items direct in je leger importeren. Bewerken en verwijderen kan alleen
// wie het item deelde, of de superadmin.
export function renderDatabase(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.armyId ? state.data.armies.find((a) => a.id === state.armyId) : null;
  const backTarget = state.dbReturn || (army ? "setup" : "home");
  const user = state.user;

  let faction = state.dbFaction || (army ? army.faction : Object.keys(AOS_FACTIONS)[0]);
  let db = null;
  let uni = null; // universal manifestation lores (aparte gedeelde blob)
  let gd = null;  // gamedata: battleplans + battle tactics (aparte gedeelde blob)
  let ror = null; // Regiments of Renown (aparte gedeelde blob "regimentsofrenown")
  let dbEditors = []; // namen die de database mogen bewerken (blob "dbeditors")
  let dbEdit = false; // mag de huidige gebruiker de database wijzigen?
  let search = ""; // zoekterm
  let searchScope = "faction"; // "faction" = alleen huidige faction, "all" = alle facties
  let allData = null; // cache van alle faction-blobs voor zoeken in "all"
  let aorList = null; // Armies of Renown (gedeelde blob "armiesofrenown")
  let aor = state.dbAoR || null; // gekozen Army of Renown (naam) binnen de faction, of null = standaard
  const expanded = new Set(); // welke facties uitgeklapt zijn in de keuzelijst
  let pickerOpen = false; // de (lange) factionlijst is standaard ingeklapt; klap dicht na een keuze
  const normRoR = (raw) => (raw && Array.isArray(raw.list)) ? raw : { list: [] };
  const normAoR = (raw) => (raw && Array.isArray(raw.list)) ? raw : { list: [] };
  const aorsFor = (f) => (aorList || []).filter((a) => a.faction === f);
  const currentAoR = () => (aorList || []).find((a) => a.faction === faction && a.name === aor) || null;
  // Pseudo-faction onderaan de keuzelijst: alle RoR bij elkaar (game-breed).
  const ROR_VIEW = "★ Regiments of Renown";
  let offline = false;
  let loadError = null;
  // Bewerken gebeurt op een kopie; pas bij opslaan vervangt die het origineel.
  let editing = null; // null | { kind: "model"|"enhancement"|"rule"|"lore", target, copy, list, isUniversal }
  const collapsedTypes = new Set(["Universal manifestations"]); // ingeklapte type-groepen; universal manifestations standaard dicht

  async function load() {
    db = null;
    loadError = null;
    editing = null;
    offline = false;
    draw(true);
    if (faction === ROR_VIEW) {
      db = { rorView: true }; // geen echte faction-blob nodig
    } else {
      try {
        const result = await sharedb.loadFactionDb(faction);
        db = result.db;
        offline = result.offline;
      } catch (e) {
        loadError = e.message;
      }
    }
    try {
      uni = (await sharedb.loadUniversalDb()).db;
    } catch {
      uni = { lores: [], models: [] };
    }
    try {
      gd = (await loadGamedata()).db;
    } catch {
      gd = null;
    }
    try {
      ror = (await sharedb.loadSharedBlob("regimentsofrenown", normRoR)).db;
    } catch {
      ror = { list: [] };
    }
    try {
      aorList = (await sharedb.loadSharedBlob("armiesofrenown", normAoR)).db.list;
    } catch {
      aorList = [];
    }
    try {
      const ed = (await sharedb.loadSharedBlob("dbeditors", (raw) => (raw && Array.isArray(raw.editors)) ? raw : { editors: [] })).db;
      dbEditors = ed.editors;
    } catch {
      dbEditors = [];
    }
    dbEdit = !!user && (user.isAdmin || dbEditors.includes(user.name));
    draw();
  }

  async function persistRoR() {
    try {
      await sharedb.saveSharedBlob("regimentsofrenown", ror);
    } catch (e) {
      alert("Opslaan in de database mislukt: " + e.message);
    }
    draw();
  }

  async function persistGamedata() {
    try {
      await saveGamedata(gd);
    } catch (e) {
      alert("Opslaan in de database mislukt: " + e.message);
    }
    draw();
  }

  async function persist() {
    try {
      await sharedb.saveFactionDb(faction, db);
    } catch (e) {
      alert("Opslaan in de database mislukt: " + e.message);
    }
    draw();
  }

  async function persistUniversal() {
    try {
      await sharedb.saveUniversalDb(uni);
    } catch (e) {
      alert("Opslaan in de database mislukt: " + e.message);
    }
    draw();
  }

  const ownerLabel = (item) => item.addedBy ? `gedeeld door ${esc(item.addedBy)}` : "gedeeld vóór de eigenaars-feature";
  // De database is alleen door beheerders (superadmin + aangewezen db-editors) te wijzigen.
  const canEdit = () => dbEdit;

  function startEdit(kind, target, list, isUniversal = false, saver = null) {
    editing = { kind, target, list, isUniversal, saver, copy: JSON.parse(JSON.stringify(target)) };
    // De model-editor is een eigen scherm (naar boven); inline editors blijven op hun plek
    draw(kind === "model");
  }

  function finishEdit() {
    const i = editing.list.indexOf(editing.target);
    if (i >= 0) editing.list[i] = editing.copy;
    const { isUniversal: wasUniversal, saver } = editing;
    editing = null;
    if (saver) saver();
    else if (wasUniversal) persistUniversal();
    else persist();
  }

  // scrollTop: alleen bij laden/faction-wissel/model-editor naar boven;
  // bij aanvinken of inline bewerken blijft de scrollpositie staan.
  function draw(scrollTop = false) {
    const y = window.scrollY;
    drawInner();
    window.scrollTo(0, scrollTop ? 0 : y);
  }

  function drawInner() {
    app.innerHTML = "";

    if (editing?.kind === "model") return drawModelEdit();

    const header = el(`<div class="topbar">
      <span class="title">${icon("book", 18)} Database</span>
      <button class="small" id="btn-back">${icon("back")} Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => {
      saveData();
      navigate(backTarget, army ? { armyId: army.id } : {});
    });
    app.appendChild(header);

    // Faction-keuze als uitklapbare lijst: klik op een faction = standaard versie;
    // klik op de chevron = de Armies of Renown van die faction tonen.
    // Huidige keuze als label op de inklap-knop
    const currentLabel = faction === ROR_VIEW ? ROR_VIEW : (esc(faction) + (aor ? ` <span class="subtitle">— ${esc(aor)}</span>` : ""));
    const facCard = el(`<div class="card">
      <label>Faction</label>
      <button class="faction-toggle ${pickerOpen ? "open" : ""}" data-toggle>${icon("chevron")} <span>${currentLabel}</span></button>
      <div class="faction-picker" data-list></div>
      ${army ? `<p class="subtitle">Importeren gaat naar je leger "${esc(army.name || "(naamloos)")}".</p>` : `<p class="subtitle">Open de database vanuit set-up om items direct in een leger te importeren.</p>`}
    </div>`);
    const facList = facCard.querySelector("[data-list]");
    facCard.querySelector("[data-toggle]").addEventListener("click", () => { pickerOpen = !pickerOpen; draw(); });
    // Na een keuze klapt de lijst weer dicht
    const selectFaction = (f, aorName) => {
      const sameFaction = f === faction;
      faction = f; aor = aorName || null;
      state.dbFaction = faction; state.dbAoR = aor;
      pickerOpen = false;
      if (sameFaction && db) { draw(true); } else { load(); }
    };
    if (pickerOpen) {
      for (const f of Object.keys(AOS_FACTIONS)) {
        const aors = aorsFor(f);
        const isOpen = expanded.has(f);
        const active = f === faction && faction !== ROR_VIEW;
        const row = el(`<div class="faction-row">
          <button class="faction-name ${active && !aor ? "primary" : ""}" data-pick>${esc(f)}</button>
          ${aors.length ? `<button class="faction-exp ${isOpen ? "open" : ""}" data-exp title="Armies of Renown">${icon("chevron")}<span class="count">${aors.length}</span></button>` : ""}
        </div>`);
        row.querySelector("[data-pick]").addEventListener("click", () => selectFaction(f, null));
        const expBtn = row.querySelector("[data-exp]");
        if (expBtn) expBtn.addEventListener("click", () => { if (expanded.has(f)) expanded.delete(f); else expanded.add(f); draw(); });
        facList.appendChild(row);
        if (isOpen) {
          const kids = el(`<div class="faction-children"></div>`);
          const stdBtn = el(`<button class="faction-child ${active && !aor ? "primary" : ""}" data-std>${icon("shield")} Standaard ${esc(f)}</button>`);
          stdBtn.addEventListener("click", () => selectFaction(f, null));
          kids.appendChild(stdBtn);
          for (const a of aors) {
            const aBtn = el(`<button class="faction-child ${active && aor === a.name ? "primary" : ""}" data-aor>${icon("star")} ${esc(a.name)}</button>`);
            aBtn.addEventListener("click", () => selectFaction(f, a.name));
            kids.appendChild(aBtn);
          }
          facList.appendChild(kids);
        }
      }
      const rorRow = el(`<div class="faction-row"><button class="faction-name ${faction === ROR_VIEW ? "primary" : ""}" data-ror>${icon("star")} ${esc(ROR_VIEW)}</button></div>`);
      rorRow.querySelector("[data-ror]").addEventListener("click", () => { faction = ROR_VIEW; aor = null; state.dbFaction = faction; state.dbAoR = null; pickerOpen = false; load(); });
      facList.appendChild(rorRow);
    }
    app.appendChild(facCard);

    // Zoeken (in deze faction of in alle facties)
    const searchCard = el(`<div class="card">
      <label>Zoeken</label>
      <input type="text" id="db-search" placeholder="naam van warscroll, enhancement, rule, lore of RoR…" value="${esc(search)}" />
      <div class="btnrow" style="margin-top:6px">
        <button class="small ${searchScope === "faction" ? "primary" : ""}" data-scope="faction">Alleen ${esc(faction === ROR_VIEW ? "RoR" : faction)}</button>
        <button class="small ${searchScope === "all" ? "primary" : ""}" data-scope="all">Alle facties</button>
      </div>
    </div>`);
    const searchInput = searchCard.querySelector("#db-search");
    searchInput.addEventListener("input", (e) => { search = e.target.value; draw(); setTimeout(() => { const s = document.querySelector("#db-search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 0); });
    searchCard.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { searchScope = b.dataset.scope; if (searchScope === "all" && !allData) loadAllData(); draw(); }));
    app.appendChild(searchCard);

    if (loadError) {
      app.appendChild(el(`<p class="empty" style="color:var(--red)">Database laden mislukt: ${esc(loadError)}</p>`));
      return;
    }
    if (!db) {
      app.appendChild(el(`<p class="empty">Database laden…</p>`));
      return;
    }
    if (offline) {
      app.appendChild(el(`<div class="reminder">⚠ Offline — je ziet de lokaal gecachete versie van deze database.</div>`));
    }
    if (!dbEdit) {
      app.appendChild(el(`<p class="subtitle">Je kunt de database bekijken en items naar je leger halen. Alleen beheerders kunnen items toevoegen of wijzigen.</p>`));
    }

    if (search.trim()) { drawSearchResults(); return; }

    // Alle Regiments of Renown bij elkaar (eigen keuze onderaan de factionlijst)
    if (faction === ROR_VIEW) { drawRoR(); return; }

    // Army of Renown gekozen → toon de AoR-eigen rules/enhancements/lores/units
    if (aor) { drawAoRView(); return; }

    drawModels();
    drawEnhancements();
    drawLores();
    drawRules("Faction rules", db.factionRules);
    for (const [sub, data] of Object.entries(db.subfactions)) {
      if (data.rules?.length) drawRules(`Subfaction rules — ${sub}`, data.rules);
    }
    drawBattleplans();
    drawTactics();
  }

  // ---------- Zoeken ----------
  async function loadAllData() {
    const factions = Object.keys(AOS_FACTIONS);
    const map = {};
    await Promise.all(factions.map(async (f) => { try { map[f] = (await sharedb.loadFactionDb(f)).db; } catch { map[f] = null; } }));
    allData = map;
    draw();
  }

  function drawSearchResults() {
    const q = search.trim().toLowerCase();
    const hit = (s) => String(s || "").toLowerCase().includes(q);
    // welke faction-blobs doorzoeken
    const sources = []; // { faction, db }
    if (searchScope === "all") {
      if (!allData) { app.appendChild(el(`<p class="empty">Alle facties laden…</p>`)); return; }
      for (const f of Object.keys(allData)) if (allData[f]) sources.push({ faction: f, db: allData[f] });
    } else {
      if (faction !== ROR_VIEW && db && !db.rorView) sources.push({ faction, db });
    }
    const arr = (x) => (Array.isArray(x) ? x : []);
    // Naam van de eerste ability (of lore-entry) die de zoekterm bevat, anders null.
    const abHit = (abilities) => { const a = arr(abilities).find((x) => hit(x.name) || hit(x.description)); return a ? a.name : null; };
    const entryHit = (entries) => { const e = arr(entries).find((x) => hit(x.name) || hit(x.description)); return e ? e.name : null; };
    const results = [];
    const pushModel = (f, kind, m) => {
      if (hit(m.name)) { results.push({ faction: f, kind, name: m.name, otype: "model", obj: m }); return; }
      const via = abHit(m.abilities); if (via) results.push({ faction: f, kind, name: m.name, via, otype: "model", obj: m });
    };
    const pushLore = (f, l) => {
      if (hit(l.name)) { results.push({ faction: f, kind: "Lore", name: l.name, otype: "lore", obj: l }); return; }
      const via = entryHit(l.entries); if (via) results.push({ faction: f, kind: "Lore", name: l.name, via, otype: "lore", obj: l });
    };
    for (const { faction: f, db: fdb } of sources) {
      for (const m of arr(fdb.models)) pushModel(f, m.type || "Model", m);
      for (const e of arr(fdb.enhancements)) if (hit(e.name) || hit(e.description)) results.push({ faction: f, kind: "Enhancement", name: e.name, otype: "ability", obj: e });
      for (const l of arr(fdb.lores)) pushLore(f, l);
      for (const r of arr(fdb.factionRules)) if (hit(r.name) || hit(r.description)) results.push({ faction: f, kind: "Faction rule", name: r.name, otype: "ability", obj: r });
      for (const [sub, data] of Object.entries(fdb.subfactions || {})) for (const r of arr(data && data.rules)) if (hit(r.name) || hit(r.description)) results.push({ faction: f, kind: `Subfaction rule (${sub})`, name: r.name, otype: "ability", obj: r });
    }
    // universal manifestations + lores (bij elke faction zichtbaar) en RoR
    if (searchScope === "all" || faction !== ROR_VIEW) {
      for (const m of arr(uni?.models)) pushModel("Universal", "Manifestation", m);
      for (const l of arr(uni?.lores)) pushLore("Universal", l);
    }
    for (const r of arr(ror?.list)) {
      const inScope = searchScope === "all" || faction === ROR_VIEW;
      if (!inScope) continue;
      if (hit(r.name) || arr(r.units).some((u) => hit(u.name))) results.push({ faction: "RoR", kind: "Regiment of Renown", name: r.name, otype: "ror", obj: r });
      else { const via = abHit(r.abilities) || arr(r.units).map((u) => abHit(u.model?.abilities)).find(Boolean); if (via) results.push({ faction: "RoR", kind: "Regiment of Renown", name: r.name, via, otype: "ror", obj: r }); }
    }
    const card = el(`<div class="card"><h2>Zoekresultaten voor "${esc(search.trim())}"</h2><div data-list></div></div>`);
    app.appendChild(card);
    const list = card.querySelector("[data-list]");
    if (!results.length) { list.appendChild(el(`<p class="empty">Niets gevonden${searchScope === "faction" ? ` in ${esc(faction)}. Kies "Alle facties" om breder te zoeken.` : "."}</p>`)); return; }
    results.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    for (const r of results) {
      const row = el(`<div class="card-header clickable" style="padding:8px 0;border-bottom:1px dashed var(--border)">
        <span><strong>${esc(r.name)}</strong> <span class="subtitle">${esc(r.kind)}${r.via ? ` · ability: ${esc(r.via)}` : ""}</span></span>
        <span class="subtitle">${esc(r.faction)}</span>
      </div>`);
      // Klik opent het kaartje zelf (popup); niet meer naar de faction-database springen.
      row.addEventListener("click", () => openSearchResult(r));
      list.appendChild(row);
    }
  }

  // Klik op een zoekresultaat → open het kaartje zelf in een popup.
  function openSearchResult(r) {
    if (r.otype === "model") { openModal(buildModelPopupContent(r.obj, { el, esc }), el); return; }
    const o = r.obj || {};
    const wrap = el(`<div><h2>${esc(r.name)}</h2><div class="subtitle">${esc(r.kind)} · ${esc(r.faction)}</div><div data-body style="margin-top:8px"></div></div>`);
    const body = wrap.querySelector("[data-body]");
    if (r.otype === "ability") {
      if ((o.phases || []).length) body.appendChild(el(`<div class="subtitle">Phases: ${o.phases.map((p) => esc(phaseLabel(p))).join(", ")}${o.oncePerBattle ? " · once per battle" : ""}</div>`));
      body.appendChild(el(`<div class="muted-list">${esc(o.description || "")}</div>`));
    } else if (r.otype === "lore") {
      for (const e of (o.entries || [])) body.appendChild(el(`<div class="card inner"><div class="card-header"><h3>${esc(e.name)}</h3>${e.value ? `<span class="chip tag">${esc(e.value)}</span>` : ""}</div>${e.description ? `<div class="muted-list">${esc(e.description)}</div>` : ""}</div>`));
    } else if (r.otype === "ror") {
      if ((o.units || []).length) body.appendChild(el(`<div class="subtitle">Units: ${(o.units || []).map((u) => esc(u.name)).join(", ")}${o.points ? ` · ${o.points} pts` : ""}</div>`));
      for (const ab of (o.abilities || [])) body.appendChild(el(`<div class="card inner"><div class="card-header"><h3>${esc(ab.name)}</h3></div><div class="muted-list">${esc(ab.description || "")}</div></div>`));
    }
    openModal(wrap, el);
  }

  // ---------- Army of Renown (read-only weergave) ----------
  const normUnit = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");
  function drawAoRView() {
    const a = currentAoR();
    if (!a) { app.appendChild(el(`<p class="empty">Deze Army of Renown is niet (meer) beschikbaar.</p>`)); return; }

    const head = el(`<div class="card">
      <div class="card-header"><h2>${icon("star")} ${esc(a.name)}</h2><span class="chip tag">${esc(a.faction)}</span></div>
      <p class="subtitle">Army of Renown — andere faction rules, enhancements, lores en een beperkte unit-keuze. Kies hem in de set-up om er een leger mee te bouwen.</p>
      <button class="small" data-std>${icon("back")} Terug naar standaard ${esc(a.faction)}</button>
    </div>`);
    head.querySelector("[data-std]").addEventListener("click", () => { aor = null; state.dbAoR = null; draw(true); });
    app.appendChild(head);

    // Faction rules (battle traits)
    const rulesCard = el(`<div class="card"><h2>Faction rules</h2><div data-list></div></div>`);
    const rl = rulesCard.querySelector("[data-list]");
    if (!a.rules?.length) rl.appendChild(el(`<p class="empty">Geen aparte faction rules.</p>`));
    for (const r of a.rules || []) rl.appendChild(el(`<div class="card inner">
      <div class="card-header"><h3>${esc(r.name)}</h3>${r.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}</div>
      ${(r.phases || []).length ? `<div class="subtitle">Phases: ${r.phases.map((p) => esc(phaseLabel(p))).join(", ")}</div>` : ""}
      <div class="muted-list">${esc(r.description)}</div>
    </div>`));
    app.appendChild(rulesCard);

    // Enhancements per categorie
    for (const cat of ENHANCEMENT_CATEGORIES) {
      const items = (a.enhancements || []).filter((e) => e.category === cat.key);
      if (!items.length) continue;
      const card = el(`<div class="card"><h2>${esc(cat.label)}</h2><div data-list></div></div>`);
      const list = card.querySelector("[data-list]");
      for (const enh of items) list.appendChild(el(`<div class="card inner">
        <div class="card-header"><h3>${esc(enh.name)}</h3></div>
        ${(enh.phases || []).length ? `<div class="subtitle">Phases: ${enh.phases.map((p) => esc(phaseLabel(p))).join(", ")}${enh.oncePerBattle ? " · once per battle" : ""}</div>` : ""}
        <div class="muted-list">${esc(enh.description)}</div>
      </div>`));
      app.appendChild(card);
    }

    // Lores
    if ((a.lores || []).length) {
      const card = el(`<div class="card"><h2>Lores</h2><div data-list></div></div>`);
      const list = card.querySelector("[data-list]");
      for (const kindDef of LORE_KINDS) {
        for (const lore of (a.lores || []).filter((l) => l.kind === kindDef.key)) {
          const entryNames = (lore.entries || []).map((e) => e.name).filter(Boolean).join(" · ");
          list.appendChild(el(`<div class="card inner">
            <div class="card-header"><h3>${esc(lore.name)}</h3><span class="chip tag">${esc(kindDef.label)}</span></div>
            ${entryNames ? `<div class="muted-list">${esc(entryNames)}</div>` : ""}
          </div>`));
        }
      }
      app.appendChild(card);
    }

    // Toegestane units (uit de faction-database, gefilterd op de AoR-lijst)
    const card = el(`<div class="card"><h2>Toegestane units</h2><div data-list></div></div>`);
    const list = card.querySelector("[data-list]");
    const wanted = (a.units || []).map(normUnit).filter(Boolean);
    if (!wanted.length) {
      list.appendChild(el(`<p class="empty">Geen specifieke unit-beperking bekend; alle ${esc(a.faction)}-units zijn toegestaan.</p>`));
    } else {
      const models = (db?.models || []).filter((m) => wanted.includes(normUnit(m.name)));
      const found = new Set(models.map((m) => normUnit(m.name)));
      for (const m of models.sort((x, y) => x.name.localeCompare(y.name))) {
        const row = el(`<div class="card-header clickable" style="padding:8px 0;border-bottom:1px dashed var(--border)"><span><strong>${esc(m.name)}</strong> <span class="subtitle">${esc(m.type || "")}</span></span><span class="subtitle">${m.points != null ? m.points + " pts" : ""}</span></div>`);
        row.addEventListener("click", () => openModal(buildModelPopupContent(m, { el, esc }), el));
        list.appendChild(row);
      }
      // Units die in de AoR staan maar (nog) niet in de faction-database matchen
      const missing = (a.units || []).filter((n) => !found.has(normUnit(n)));
      for (const n of missing) list.appendChild(el(`<div class="card-header" style="padding:8px 0;border-bottom:1px dashed var(--border)"><span><strong>${esc(n)}</strong></span><span class="subtitle">niet in database</span></div>`));
    }
    app.appendChild(card);
  }

  // ---------- Battleplans (game-breed, niet faction-gebonden) ----------
  function drawBattleplans() {
    const card = el(`<div class="card"><h2>Battleplans</h2>
      <p class="subtitle">Gelden voor alle factions. Voeg per battleplan de abilities toe die in companion mode moeten verschijnen; het score-schema zit er al in.</p>
      <div data-list></div></div>`);
    app.appendChild(card);
    const list = card.querySelector("[data-list]");
    if (!gd) {
      list.appendChild(el(`<p class="empty">Battleplans niet beschikbaar (offline zonder cache?).</p>`));
      return;
    }
    for (const b of gd.battleplans) {
      if (editing?.target === b) {
        list.appendChild(buildBattleplanEditor(editing.copy));
        continue;
      }
      const opts = scoringOptionsFor(b, 1).length ? scoringOptionsFor(b, 1) : scoringOptionsFor(b, 2);
      const item = el(`<div class="card inner">
        <div class="card-header"><h3>${esc(b.name)}</h3>
          ${b.scoring?.endBonus ? '<span class="chip tag">Eindbonus</span>' : ""}
          ${b.scoring?.liferoot ? '<span class="chip tag">Liferoot points</span>' : ""}
        </div>
        <div class="subtitle">Score per beurt: ${opts.map((o) => `${esc(o.label)} (${o.points})`).join(" · ")}</div>
        <div class="muted-list">${b.abilities.length ? b.abilities.map((a) => esc(a.name || "(naamloos)")).join(" · ") : "Nog geen abilities"}</div>
        <div class="btnrow">
          ${dbEdit ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>` : ""}
        </div>
      </div>`);
      const editBtn = item.querySelector('[data-act="edit"]');
      if (editBtn) editBtn.addEventListener("click", () => startEdit("battleplan", b, gd.battleplans, false, persistGamedata));
      list.appendChild(item);
    }
  }

  function buildBattleplanEditor(bp) {
    const wrap = el(`<div class="card inner">
      <label>Naam battleplan</label>
      <input type="text" data-f="name" value="${esc(bp.name)}" />
      <label>Abilities (verschijnen in companion mode als dit battleplan gekozen is)</label>
      <div data-abs></div>
      <button class="small" data-add>${icon("plus")} Ability toevoegen</button>
      <div class="btnrow" data-actions></div>
    </div>`);
    wrap.querySelector('[data-f="name"]').addEventListener("input", (e) => { bp.name = e.target.value; });
    const absWrap = wrap.querySelector("[data-abs]");
    const drawAbs = () => {
      absWrap.innerHTML = "";
      if (!bp.abilities.length) absWrap.appendChild(el(`<p class="empty">Nog geen abilities.</p>`));
      bp.abilities.forEach((ab, i) => {
        absWrap.appendChild(buildBattleplanAbilityEditor({
          ab, el, esc,
          actions: [{ label: `${icon("trash")} Verwijder ability`, danger: true, onClick: () => { bp.abilities.splice(i, 1); drawAbs(); } }],
        }));
      });
    };
    drawAbs();
    wrap.querySelector("[data-add]").addEventListener("click", () => {
      bp.abilities.push({ name: "", description: "", phases: [], oncePerBattle: false, underdogOnly: false, rounds: [] });
      drawAbs();
    });
    const actions = wrap.querySelector("[data-actions]");
    const saveBtn = el(`<button class="small primary">${icon("check")} Opslaan in de database</button>`);
    saveBtn.addEventListener("click", () => finishEdit());
    const cancelBtn = el(`<button class="small">Annuleren</button>`);
    cancelBtn.addEventListener("click", () => { editing = null; draw(); });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    return wrap;
  }

  // ---------- Battle tactics (game-breed) ----------
  function drawTactics() {
    const card = el(`<div class="card"><h2>Battle tactics</h2>
      <p class="subtitle">Je kiest er 3 per game; iedere tactic heeft 3 opvolgende stappen (5 punten per gescoorde stap, max 1 stap per eigen beurt).</p>
      <div data-list></div></div>`);
    app.appendChild(card);
    const list = card.querySelector("[data-list]");
    if (!gd) {
      list.appendChild(el(`<p class="empty">Battle tactics niet beschikbaar (offline zonder cache?).</p>`));
      return;
    }
    for (const t of gd.tactics) {
      if (editing?.target === t) {
        const wrap = el(`<div class="card inner"></div>`);
        wrap.appendChild(buildTacticEditor({ tactic: editing.copy, el, esc, actions: editActions() }));
        list.appendChild(wrap);
        continue;
      }
      const item = el(`<div class="card inner">
        <div class="card-header"><h3>${esc(t.name)}</h3></div>
        <div class="muted-list">${(t.steps || []).map((s, i) => `${i + 1}. ${esc(s.name || "(naamloos)")}${s.description ? " — " + esc(s.description) : ""}`).join("\n")}</div>
        <div class="btnrow">
          ${dbEdit ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>` : ""}
        </div>
      </div>`);
      const editBtn = item.querySelector('[data-act="edit"]');
      if (editBtn) editBtn.addEventListener("click", () => startEdit("tactic", t, gd.tactics, false, persistGamedata));
      list.appendChild(item);
    }
  }

  // ---------- Regiments of Renown (game-breed) ----------
  function drawRoR() {
    const card = el(`<div class="card"><h2>${icon("star")} Regiments of Renown</h2>
      <p class="subtitle">Vaste warbands, kiesbaar in meerdere facties. Klik in de list-builder op de RoR om de regel(s) te zien.</p>
      <div data-list></div>
      ${dbEdit ? `<button class="small" data-add>${icon("plus")} Regiment of Renown toevoegen</button>` : ""}</div>`);
    app.appendChild(card);
    const list = card.querySelector("[data-list]");
    if (!ror) {
      list.appendChild(el(`<p class="empty">Regiments of Renown niet beschikbaar (offline zonder cache?).</p>`));
    } else {
      if (!ror.list.length) list.appendChild(el(`<p class="empty">Nog geen Regiments of Renown.</p>`));
      for (const rr of ror.list) {
        if (editing?.target === rr) { list.appendChild(buildRoREditor(editing.copy, rr)); continue; }
        const item = el(`<div class="card inner">
          <div class="card-header"><h3>${esc(rr.name || "(naamloos)")}</h3><span class="subtitle">${parseInt(rr.points) || 0} pts</span></div>
          <div class="subtitle">Facties: ${(rr.allowedArmies || []).map(esc).join(", ") || "—"}</div>
          <div class="subtitle">Units: ${(rr.units || []).map((u) => `${u.count > 1 ? u.count + "× " : ""}${esc(u.name)}`).join(", ") || "—"}</div>
          ${(rr.abilities || []).length ? `<div class="muted-list">${rr.abilities.map((a) => `<strong>${esc(a.name || "(naamloos)")}</strong>${a.description ? "\n" + esc(a.description) : ""}`).join("\n\n")}</div>` : `<div class="subtitle">Nog geen regels.</div>`}
          <div class="subtitle">${ownerLabel(rr)}</div>
          <div class="btnrow">
            ${canEdit(rr) ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>
            <button class="danger small" data-act="del">${icon("trash")} Verwijderen</button>` : ""}
          </div>
        </div>`);
        const eb = item.querySelector('[data-act="edit"]');
        if (eb) eb.addEventListener("click", () => startEdit("ror", rr, ror.list, false, persistRoR));
        const delb = item.querySelector('[data-act="del"]');
        if (delb) delb.addEventListener("click", async () => {
          if (!confirm(`"${rr.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
          const i = ror.list.indexOf(rr); if (i >= 0) ror.list.splice(i, 1);
          await persistRoR();
        });
        list.appendChild(item);
      }
    }
    const addBtn = card.querySelector("[data-add]");
    if (addBtn) addBtn.addEventListener("click", () => {
      if (!ror) return;
      const blank = { name: "", points: 0, allowedArmies: [], units: [], abilities: [], addedBy: user?.name || "" };
      ror.list.push(blank);
      startEdit("ror", blank, ror.list, false, persistRoR);
    });
  }

  function buildRoREditor(rr, original) {
    const wrap = el(`<div class="card inner">
      <label>Naam</label>
      <input type="text" data-f="name" value="${esc(rr.name)}" />
      <label>Punten</label>
      <input type="number" data-f="points" min="0" value="${esc(rr.points || 0)}" />
      <label>Toegestane facties</label>
      <div class="chips" data-armies>${Object.keys(AOS_FACTIONS).map((f) => `<label class="chip"><input type="checkbox" value="${esc(f)}" ${(rr.allowedArmies || []).includes(f) ? "checked" : ""}/> ${esc(f)}</label>`).join("")}</div>
      <label>Units (naam + aantal)</label>
      <div data-units></div>
      <button class="small" data-add-unit>${icon("plus")} Unit toevoegen</button>
      <label>Regels (RoR-eigen abilities)</label>
      <div data-abs></div>
      <button class="small" data-add-ab>${icon("plus")} Regel toevoegen</button>
      <div class="btnrow" data-actions></div>
    </div>`);
    wrap.querySelector('[data-f="name"]').addEventListener("input", (e) => { rr.name = e.target.value; });
    wrap.querySelector('[data-f="points"]').addEventListener("input", (e) => { rr.points = parseInt(e.target.value) || 0; });
    wrap.querySelector("[data-armies]").addEventListener("change", () => { rr.allowedArmies = [...wrap.querySelectorAll("[data-armies] input:checked")].map((c) => c.value); });

    rr.units = rr.units || [];
    const uWrap = wrap.querySelector("[data-units]");
    const drawU = () => {
      uWrap.innerHTML = "";
      if (!rr.units.length) uWrap.appendChild(el(`<p class="empty">Geen units.</p>`));
      rr.units.forEach((u, i) => {
        const row = el(`<div class="card inner" style="margin:4px 0">
          <div class="card-header"><div><strong>${esc(u.name || "(kies een warscroll)")}</strong>${u.model ? "" : ' <span class="chip tag">geen warscroll gekoppeld</span>'}</div>
            <span style="display:flex;gap:6px;align-items:center"><label class="subtitle">aantal</label><input type="number" data-uc min="1" value="${esc(u.count || 1)}" style="width:60px"/></span></div>
          <div class="btnrow"><button class="small" data-pick>${icon("edit")} Warscroll kiezen</button><button class="danger small" data-del>${icon("trash")} Verwijderen</button></div>
        </div>`);
        row.querySelector("[data-uc]").addEventListener("change", (e) => { u.count = parseInt(e.target.value) || 1; });
        row.querySelector("[data-pick]").addEventListener("click", () => pickWarscroll((picked) => { u.name = picked.name; u.model = picked.model; drawU(); }));
        row.querySelector("[data-del]").addEventListener("click", () => { rr.units.splice(i, 1); drawU(); });
        uWrap.appendChild(row);
      });
    };
    drawU();
    wrap.querySelector("[data-add-unit]").addEventListener("click", () => pickWarscroll((picked) => { rr.units.push({ name: picked.name, count: 1, model: picked.model }); drawU(); }));

    rr.abilities = rr.abilities || [];
    const aWrap = wrap.querySelector("[data-abs]");
    const drawA = () => {
      aWrap.innerHTML = "";
      if (!rr.abilities.length) aWrap.appendChild(el(`<p class="empty">Geen regels.</p>`));
      rr.abilities.forEach((a, i) => {
        const row = el(`<div class="card inner" style="margin:4px 0"><input type="text" data-an value="${esc(a.name)}" placeholder="naam van de regel"/><textarea data-ad placeholder="beschrijving (Timing/Declare/Effect…)">${esc(a.description || "")}</textarea><div class="btnrow"><button class="danger small">${icon("trash")} Verwijderen</button></div></div>`);
        row.querySelector("[data-an]").addEventListener("input", (e) => { a.name = e.target.value; });
        row.querySelector("[data-ad]").addEventListener("input", (e) => { a.description = e.target.value; });
        row.querySelector("button.danger").addEventListener("click", () => { rr.abilities.splice(i, 1); drawA(); });
        aWrap.appendChild(row);
      });
    };
    drawA();
    wrap.querySelector("[data-add-ab]").addEventListener("click", () => { rr.abilities.push({ name: "", description: "" }); drawA(); });

    const actions = wrap.querySelector("[data-actions]");
    const saveBtn = el(`<button class="small primary">${icon("check")} Opslaan in de database</button>`);
    saveBtn.addEventListener("click", () => { if (!rr.name.trim()) { alert("Geef de Regiment of Renown een naam."); return; } finishEdit(); });
    const cancelBtn = el(`<button class="small">Annuleren</button>`);
    cancelBtn.addEventListener("click", () => {
      if (original && !original.name) { const i = ror.list.indexOf(original); if (i >= 0) ror.list.splice(i, 1); } // verse, lege toevoeging weer weghalen
      editing = null; draw();
    });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    return wrap;
  }

  // Kies een warscroll uit de database (faction naar keuze) voor een RoR-unit.
  // Zet zowel de naam als het volledige warscroll-model, zodat de unit met stats
  // in een leger belandt.
  function pickWarscroll(onPick) {
    let pf = (army ? army.faction : null) || (faction !== ROR_VIEW ? faction : Object.keys(AOS_FACTIONS)[0]);
    const wrap = el(`<div><h2>Warscroll kiezen</h2>
      <label>Faction</label>
      <select data-pf>${Object.keys(AOS_FACTIONS).map((f) => `<option ${f === pf ? "selected" : ""}>${esc(f)}</option>`).join("")}</select>
      <div data-body></div></div>`);
    const body = wrap.querySelector("[data-body]");
    const overlay = openModal(wrap, el);
    const list = async () => {
      body.innerHTML = ""; body.appendChild(el(`<p class="empty">Laden…</p>`));
      let models = [];
      try {
        const fdb = (await sharedb.loadFactionDb(pf)).db;
        const udb = (await sharedb.loadUniversalDb()).db;
        models = [...(fdb.models || []), ...(udb.models || [])];
      } catch (e) {
        body.innerHTML = ""; body.appendChild(el(`<p class="empty" style="color:var(--red)">Niet beschikbaar: ${esc(e.message)}</p>`)); return;
      }
      body.innerHTML = "";
      if (!models.length) { body.appendChild(el(`<p class="empty">Geen warscrolls in de ${esc(pf)}-database.</p>`)); return; }
      for (const m of models) {
        const row = el(`<div class="card-header clickable" style="padding:8px 0;border-bottom:1px dashed var(--border)"><strong>${esc(m.name)}</strong><span class="subtitle">${m.points != null ? m.points + " pts" : ""}</span></div>`);
        row.addEventListener("click", () => { onPick({ name: m.name, model: importCopy(m) }); overlay.remove(); });
        body.appendChild(row);
      }
    };
    wrap.querySelector("[data-pf]").addEventListener("change", (e) => { pf = e.target.value; list(); });
    list();
  }

  // ---------- Models (kaartjes) ----------
  function drawModels() {
    const card = el(`<div class="card"><h2>Models</h2><div data-list></div></div>`);
    app.appendChild(card);
    const mAdd = addButton("Model toevoegen", () => { const m = blankModel(); db.models.push(m); startEdit("model", m, db.models); });
    if (mAdd) card.appendChild(mAdd);
    const list = card.querySelector("[data-list]");

    // Faction-kaartjes + universal manifestations (bij iedere faction zichtbaar)
    const items = [
      ...db.models.map((m) => ({ m, list: db.models, isUniversal: false })),
      ...(uni?.models || []).map((m) => ({ m, list: uni.models, isUniversal: true })),
    ];
    if (!items.length) {
      list.appendChild(el(`<p class="empty">Nog geen kaartjes in de ${esc(faction)}-database. Deel een kaartje via set-up (knop "Deel in database").</p>`));
      return;
    }
    // Gegroepeerd per type; manifestations gesplitst in Faction vs Universal
    const labelOf = ({ m, isUniversal }) =>
      m.type === "Manifestation" ? (isUniversal ? "Universal manifestations" : "Faction manifestations") : (m.type || "Zonder type");
    const order = [];
    for (const t of MODEL_TYPES) { if (t === "Manifestation") order.push("Faction manifestations", "Universal manifestations"); else order.push(t); }
    order.push("Zonder type");
    const grouped = new Map();
    for (const it of items) { const l = labelOf(it); if (!grouped.has(l)) grouped.set(l, []); grouped.get(l).push(it); }
    const ordered = order.filter((l) => grouped.has(l)).map((l) => [l, grouped.get(l)]);
    for (const [typeLabel, groupItems] of ordered) {
      const group = el(`<details class="type-group" ${collapsedTypes.has(typeLabel) ? "" : "open"}>
        <summary>${esc(typeLabel)} <span class="count">(${groupItems.length})</span></summary>
        <div data-items></div>
      </details>`);
      group.addEventListener("toggle", () => {
        if (group.open) collapsedTypes.delete(typeLabel);
        else collapsedTypes.add(typeLabel);
      });
      const itemsWrap = group.querySelector("[data-items]");
      list.appendChild(group);
      for (const { m, list: srcList, isUniversal } of groupItems) {
      const isParagon = (m.keywords || []).some((k) => String(k).toLowerCase() === "paragon");
      const tags = [m.type, isUniversal ? "Universal" : "", m.fly ? "Fly" : "", m.wizardLevel > 0 ? `Wizard (${m.wizardLevel})` : "", m.priestLevel > 0 ? `Priest (${m.priestLevel})` : ""].filter(Boolean);
      const item = el(`<div class="card inner">
        <div class="card-header">
          <div>
            <h3>${esc(m.name)}</h3>
            <div class="subtitle">Move ${esc(m.move)} · Health ${esc(m.health)} · Control ${esc(m.control)} · Save ${esc(m.save)}${m.ward ? " · Ward " + esc(m.ward) : ""}${m.banishment ? " · Banish " + esc(m.banishment) : ""}</div>
            ${(tags.length || isParagon) ? `<div class="chips">${isParagon ? `<span class="chip paragon">${icon("star")} Paragon</span>` : ""}${tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
            <div class="muted-list">${(m.rangedAttacks || []).length} ranged · ${(m.meleeAttacks || []).length} melee · ${(m.abilities || []).length} abilities · ${ownerLabel(m)}</div>
          </div>
        </div>
        <div class="btnrow">
          ${army && m.type !== "Manifestation" ? `<button class="primary small" data-act="army">${icon("plus")} Naar dit leger</button>` : ""}
          ${canEdit(m) ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>
          <button class="danger small" data-act="del">${icon("trash")} Verwijderen</button>` : ""}
        </div>
        ${m.type === "Manifestation" ? `<div class="subtitle">Manifestaties komen automatisch in je leger via hun lore.</div>` : ""}
      </div>`);
      // Klik op het kaartje (maar niet op een knop) opent de volledige popup
      item.classList.add("clickable");
      item.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        openModal(buildModelPopupContent(m, { el, esc }), el);
      });
      const armyBtn = item.querySelector('[data-act="army"]');
      if (armyBtn) armyBtn.addEventListener("click", () => {
        army.models.push(importCopy(m));
        saveData();
        alert(`"${m.name}" is toegevoegd aan je leger.`);
      });
      const editBtn = item.querySelector('[data-act="edit"]');
      if (editBtn) editBtn.addEventListener("click", () => startEdit("model", m, srcList, isUniversal));
      const delBtn = item.querySelector('[data-act="del"]');
      if (delBtn) delBtn.addEventListener("click", async () => {
        if (!confirm(`"${m.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
        const idx = srcList.indexOf(m);
        if (idx >= 0) srcList.splice(idx, 1);
        if (isUniversal) await persistUniversal();
        else await persist();
      });
      itemsWrap.appendChild(item);
      }
    }
  }

  function drawModelEdit() {
    const m = editing.copy;
    const header = el(`<div class="topbar">
      <span class="title">Database-kaartje bewerken</span>
      <button class="small" id="btn-cancel">${icon("back")} Annuleren</button>
    </div>`);
    header.querySelector("#btn-cancel").addEventListener("click", () => cancelEdit());
    app.appendChild(header);

    const editor = buildModelEditor({ container: app, m, el, esc }); // geen army → geen enhancement-sectie
    const saveBtn = el(`<button class="primary bigbtn">${icon("check")} Opslaan in de database</button>`);
    saveBtn.addEventListener("click", () => {
      if (!editor.commit()) { alert("Geef het model een naam."); return; }
      finishEdit();
    });
    app.appendChild(saveBtn);
  }

  function importCopy(m) {
    const copy = JSON.parse(JSON.stringify(m));
    copy.id = uid();
    copy.type = copy.type || "";
    copy.ward = copy.ward || "";
    copy.enhancements = [];
    delete copy.enhancementIds;
    delete copy.addedBy;
    return copy;
  }

  // Manifestaties komen lore-gedreven in het leger: bij het kiezen van een
  // manifestation-lore worden de bijbehorende warscrolls automatisch toegevoegd
  // (en eerdere lore-manifestaties verwijderd). Namen uit de lore-entries
  // ("Summon X" → "X") worden tegen de database-warscrolls gematcht.
  const normManif = (s) => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
  function syncArmyManifestations(lore) {
    army.models = (army.models || []).filter((m) => !m.fromLore);
    if (!lore || lore.kind !== "manifestation") return;
    const pool = [...(uni?.models || []), ...db.models].filter((m) => m.type === "Manifestation");
    const wanted = (lore.entries || []).map((e) => e.name.replace(/^summon\s+/i, "").trim());
    let added = 0;
    for (const name of wanted) {
      const src = pool.find((m) => normManif(m.name) === normManif(name));
      if (!src) continue;
      const mc = importCopy(src);
      mc.fromLore = true;
      army.models.push(mc);
      added++;
    }
    return added;
  }

  // ---------- Enhancements ----------
  function drawEnhancements() {
    for (const cat of ENHANCEMENT_CATEGORIES) {
      const items = db.enhancements.filter((e) => e.category === cat.key);
      const card = el(`<div class="card"><h2>${cat.label}</h2><div data-list></div></div>`);
      app.appendChild(card);
      const eAdd = addButton(`${cat.label} toevoegen`, () => { const e = blankEnhancement(cat.key); db.enhancements.push(e); startEdit("enhancement", e, db.enhancements); });
      if (eAdd) card.appendChild(eAdd);
      const list = card.querySelector("[data-list]");
      if (!items.length) {
        list.appendChild(el(`<p class="empty">Nog geen ${cat.label.toLowerCase()} in deze database.</p>`));
        continue;
      }
      for (const enh of items) {
        if (editing?.target === enh) {
          const wrap = el(`<div class="card inner"></div>`);
          wrap.appendChild(buildEnhancementEditor({
            enh: editing.copy, el, esc,
            actions: editActions(),
          }));
          list.appendChild(wrap);
          continue;
        }
        const mods = (enh.statMods || []).map(modLabel).join(", ");
        const item = el(`<div class="card inner">
          <div class="card-header"><h3>${esc(enh.name)}</h3>${enh.category === "other" && (enh.forTypes?.length || enh.forType) ? `<span class="chip tag">${esc((enh.forTypes?.length ? enh.forTypes : [enh.forType]).join(", "))}</span>` : ""}</div>
          ${mods ? `<div class="subtitle">Stats: ${esc(mods)}</div>` : ""}
          ${(enh.phases || []).length ? `<div class="subtitle">Phases: ${enh.phases.map((p) => esc(phaseLabel(p))).join(", ")}${enh.oncePerBattle ? " · once per battle" : ""}</div>` : ""}
          <div class="muted-list">${esc(enh.description)}</div>
          <div class="subtitle">${ownerLabel(enh)}</div>
          <div class="btnrow">
            ${canEdit(enh) ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>
            <button class="danger small" data-act="del">${icon("trash")} Verwijderen</button>` : ""}
          </div>
          ${army ? `<div class="subtitle">Enhancements voeg je toe aan een model in de set-up (model bewerken → Enhancements).</div>` : ""}
        </div>`);
        const editBtn = item.querySelector('[data-act="edit"]');
        if (editBtn) editBtn.addEventListener("click", () => startEdit("enhancement", enh, db.enhancements));
        const delBtn = item.querySelector('[data-act="del"]');
        if (delBtn) delBtn.addEventListener("click", async () => {
          if (!confirm(`"${enh.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
          db.enhancements = db.enhancements.filter((x) => x !== enh);
          await persist();
        });
        list.appendChild(item);
      }
    }
  }

  // ---------- Lores ----------
  function drawLores() {
    const card = el(`<div class="card"><h2>Lores</h2><div data-list></div></div>`);
    app.appendChild(card);
    for (const k of LORE_KINDS) {
      const lAdd = addButton(`${k.label} toevoegen`, () => { const lore = blankLore(k.key); db.lores.push(lore); startEdit("lore", lore, db.lores); });
      if (lAdd) { lAdd.style.marginRight = "6px"; card.appendChild(lAdd); }
    }
    const list = card.querySelector("[data-list]");

    // Faction lores + universal manifestation lores (voor iedere faction kiesbaar)
    const items = [
      ...db.lores.map((l) => ({ lore: l, list: db.lores, isUniversal: false })),
      ...(uni?.lores || []).map((l) => ({ lore: l, list: uni.lores, isUniversal: true })),
    ];
    if (!items.length) {
      list.appendChild(el(`<p class="empty">Nog geen lores in deze database. Deel een lore via set-up (knop "Deel in database" bij de lore).</p>`));
      return;
    }
    for (const kindDef of LORE_KINDS) {
      for (const { lore, list: srcList, isUniversal } of items.filter((x) => x.lore.kind === kindDef.key)) {
        if (editing?.target === lore) {
          const wrap = el(`<div class="card inner"></div>`);
          wrap.appendChild(buildLoreEditor({
            lore: editing.copy, kind: kindDef.key, el, esc,
            manifestationOptions: (uni?.models || []).filter((x) => x.type === "Manifestation").map((x) => x.name),
            actions: editActions(),
          }));
          list.appendChild(wrap);
          continue;
        }
        const entryNames = (lore.entries || []).map((e) => e.name).filter(Boolean).join(" · ");
        const item = el(`<div class="card inner">
          <div class="card-header"><h3>${esc(lore.name)}</h3>
            <span class="chip tag">${esc(kindDef.label)}${isUniversal ? " · Universal" : ""}</span>
          </div>
          ${entryNames ? `<div class="muted-list">${esc(entryNames)}</div>` : ""}
          <div class="subtitle">${ownerLabel(lore)}</div>
          <div class="btnrow">
            ${army ? `<button class="primary small" data-act="army">${icon("plus")} Naar dit leger</button>` : ""}
            ${canEdit(lore) ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>
            <button class="danger small" data-act="del">${icon("trash")} Verwijderen</button>` : ""}
          </div>
        </div>`);
        const armyBtn = item.querySelector('[data-act="army"]');
        if (armyBtn) armyBtn.addEventListener("click", () => {
          const field = kindDef.armyField;
          if (army[field] && !confirm(`Je leger heeft al een ${kindDef.label.toLowerCase()} ("${army[field].name || "naamloos"}"). Vervangen door "${lore.name}"?`)) return;
          const copy = JSON.parse(JSON.stringify(lore));
          delete copy.addedBy;
          delete copy.id;
          copy.kind = lore.kind; // kind bewaren voor de manifestatie-sync
          if (isUniversal) copy.universal = true;
          army[field] = copy;
          let msg = `"${lore.name}" is nu de ${kindDef.label.toLowerCase()} van je leger.`;
          if (lore.kind === "manifestation") {
            const n = syncArmyManifestations(copy);
            msg += n ? ` ${n} manifestatie${n === 1 ? "" : "s"} toegevoegd aan je leger.` : "";
          }
          delete copy.kind; // army-veld verwacht geen kind verder
          saveData();
          alert(msg);
        });
        const editBtn = item.querySelector('[data-act="edit"]');
        if (editBtn) editBtn.addEventListener("click", () => startEdit("lore", lore, srcList, isUniversal));
        const delBtn = item.querySelector('[data-act="del"]');
        if (delBtn) delBtn.addEventListener("click", async () => {
          if (!confirm(`"${lore.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
          const idx = srcList.indexOf(lore);
          if (idx >= 0) srcList.splice(idx, 1);
          if (isUniversal) await persistUniversal();
          else await persist();
        });
        list.appendChild(item);
      }
    }
  }

  // ---------- Faction / subfaction rules ----------
  function drawRules(title, rules) {
    const card = el(`<div class="card"><h2>${esc(title)}</h2><div data-list></div></div>`);
    app.appendChild(card);
    const rAdd = addButton("Rule toevoegen", () => { const r = blankRule(); rules.push(r); startEdit("rule", r, rules); });
    if (rAdd) card.appendChild(rAdd);
    const list = card.querySelector("[data-list]");
    if (!rules.length) {
      list.appendChild(el(`<p class="empty">Nog geen rules in deze database.</p>`));
      return;
    }
    for (const r of rules) {
      if (editing?.target === r) {
        list.appendChild(buildRuleEditor({
          rule: editing.copy, el, esc,
          actions: editActions(),
        }));
        continue;
      }
      const item = el(`<div class="card inner">
        <div class="card-header"><h3>${esc(r.name)}</h3>${r.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}</div>
        ${(r.phases || []).length ? `<div class="subtitle">Phases: ${r.phases.map((p) => esc(phaseLabel(p))).join(", ")}</div>` : ""}
        <div class="muted-list">${esc(r.description)}</div>
        <div class="subtitle">${ownerLabel(r)}</div>
        <div class="btnrow">
          ${army ? `<button class="primary small" data-act="army">${icon("plus")} Naar dit leger</button>` : ""}
          ${canEdit(r) ? `<button class="small" data-act="edit">${icon("edit")} Bewerken</button>
          <button class="danger small" data-act="del">${icon("trash")} Verwijderen</button>` : ""}
        </div>
      </div>`);
      const armyBtn = item.querySelector('[data-act="army"]');
      if (armyBtn) armyBtn.addEventListener("click", () => {
        const copy = JSON.parse(JSON.stringify(r));
        delete copy.addedBy;
        const isSubfaction = title.startsWith("Subfaction");
        const target = isSubfaction ? army.subfactionRules : army.factionRules;
        const i = target.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase());
        if (i >= 0) target[i] = copy;
        else target.push(copy);
        saveData();
        alert(`"${r.name}" is toegevoegd aan je leger.`);
      });
      const editBtn = item.querySelector('[data-act="edit"]');
      if (editBtn) editBtn.addEventListener("click", () => startEdit("rule", r, rules));
      const delBtn = item.querySelector('[data-act="del"]');
      if (delBtn) delBtn.addEventListener("click", async () => {
        if (!confirm(`"${r.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
        const idx = rules.indexOf(r);
        if (idx >= 0) rules.splice(idx, 1);
        await persist();
      });
      list.appendChild(item);
    }
  }

  // Annuleren: een vers toegevoegde (nog naamloze) entry weer uit de lijst halen.
  function cancelEdit() {
    if (editing?.target && editing.list && !editing.target.name) {
      const i = editing.list.indexOf(editing.target);
      if (i >= 0) editing.list.splice(i, 1);
    }
    editing = null;
    draw();
  }

  function editActions() {
    return [
      { label: `${icon("check")} Opslaan in de database`, primary: true, onClick: () => finishEdit() },
      { label: "Annuleren", onClick: () => cancelEdit() },
    ];
  }

  // Lege sjablonen voor nieuwe database-entries (admin voegt ze toe).
  function blankModel() {
    return { id: uid(), name: "", type: "", move: "", health: 1, control: 1, controlBonus: 0, save: "", ward: "", fly: false, champion: false, musician: false, standardBearer: false, wizardLevel: 0, priestLevel: 0, rangedAttacks: [], meleeAttacks: [], abilities: [], banishment: "", universal: false, points: null, reinforceable: false, unique: false, keywords: [], regimentOptions: [], enhancements: [], addedBy: user?.name || "" };
  }
  function blankEnhancement(category) {
    return { name: "", category, forTypes: [], description: "", statMods: [], phases: [], oncePerBattle: false, points: 0, addedBy: user?.name || "" };
  }
  function blankRule() {
    return { name: "", phases: [], description: "", oncePerBattle: false, addedBy: user?.name || "" };
  }
  function blankLore(kind) {
    return { name: "", kind, universal: false, entries: [{ name: "", value: "", description: "" }, { name: "", value: "", description: "" }, { name: "", value: "", description: "" }], addedBy: user?.name || "" };
  }
  // Knop "+ Toevoegen" (alleen voor db-editors); voegt een blanco entry toe en opent de editor.
  function addButton(label, onAdd) {
    if (!dbEdit) return null;
    const btn = el(`<button class="small" style="margin-top:6px">${icon("plus")} ${esc(label)}</button>`);
    btn.addEventListener("click", onAdd);
    return btn;
  }

  load();
}
