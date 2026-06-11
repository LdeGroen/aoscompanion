import { AOS_FACTIONS, ENHANCEMENT_CATEGORIES, enhancementCategoryLabel, phaseLabel } from "./factions.js";
import { modLabel } from "./enhancements.js";
import * as sharedb from "./sharedb.js";
import { uid } from "./storage.js";

// De gedeelde database: per faction alle gedeelde kaartjes, enhancements en
// rules, toegankelijk voor alle accounts. Open je hem vanuit set-up, dan kun
// je items direct in je leger importeren.
export function renderDatabase(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.armyId ? state.data.armies.find((a) => a.id === state.armyId) : null;
  const backTarget = state.dbReturn || (army ? "setup" : "home");

  let faction = state.dbFaction || (army ? army.faction : Object.keys(AOS_FACTIONS)[0]);
  let db = null;
  let offline = false;
  let loadError = null;

  async function load() {
    db = null;
    loadError = null;
    draw();
    try {
      const result = await sharedb.loadFactionDb(faction);
      db = result.db;
      offline = result.offline;
    } catch (e) {
      loadError = e.message;
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

  function draw() {
    app.innerHTML = "";
    window.scrollTo(0, 0);

    const header = el(`<div class="topbar">
      <span class="title">📚 Database</span>
      <button class="small" id="btn-back">← Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => {
      saveData();
      navigate(backTarget, army ? { armyId: army.id } : {});
    });
    app.appendChild(header);

    const facCard = el(`<div class="card">
      <label>Faction</label>
      <select id="db-faction">${Object.keys(AOS_FACTIONS).map((f) => `<option ${f === faction ? "selected" : ""}>${esc(f)}</option>`).join("")}</select>
      ${army ? `<p class="subtitle">Importeren gaat naar je leger "${esc(army.name || "(naamloos)")}".</p>` : `<p class="subtitle">Open de database vanuit set-up om items direct in een leger te importeren. Kaartjes kun je hier altijd naar je bibliotheek kopiëren.</p>`}
    </div>`);
    facCard.querySelector("#db-faction").addEventListener("change", (e) => {
      faction = e.target.value;
      state.dbFaction = faction;
      load();
    });
    app.appendChild(facCard);

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

    drawModels();
    drawEnhancements();
    drawRules("Faction rules", db.factionRules, null);
    for (const [sub, data] of Object.entries(db.subfactions)) {
      if (data.rules?.length) drawRules(`Subfaction rules — ${sub}`, data.rules, sub);
    }
  }

  // ---------- Models (kaartjes) ----------
  function drawModels() {
    const card = el(`<div class="card"><h2>Models</h2><div data-list></div></div>`);
    app.appendChild(card);
    const list = card.querySelector("[data-list]");
    if (!db.models.length) {
      list.appendChild(el(`<p class="empty">Nog geen kaartjes in de ${esc(faction)}-database. Deel een kaartje via set-up (knop "Deel in database").</p>`));
      return;
    }
    for (const m of db.models) {
      const tags = [m.type, m.fly ? "Fly" : "", m.wizardLevel > 0 ? `Wizard (${m.wizardLevel})` : "", m.priestLevel > 0 ? `Priest (${m.priestLevel})` : ""].filter(Boolean);
      const item = el(`<div class="card inner">
        <div class="card-header">
          <div>
            <h3>${esc(m.name)}</h3>
            <div class="subtitle">Move ${esc(m.move)} · Health ${esc(m.health)} · Control ${esc(m.control)} · Save ${esc(m.save)}${m.ward ? " · Ward " + esc(m.ward) : ""}</div>
            ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
            <div class="muted-list">${(m.rangedAttacks || []).length} ranged · ${(m.meleeAttacks || []).length} melee · ${(m.abilities || []).length} abilities</div>
          </div>
        </div>
        <div class="btnrow">
          <button class="small" data-act="lib">📇 Naar mijn bibliotheek</button>
          ${army ? `<button class="primary small" data-act="army">+ Naar dit leger</button>` : ""}
          <button class="danger small" data-act="del">Verwijderen</button>
        </div>
      </div>`);
      item.querySelector('[data-act="lib"]').addEventListener("click", () => {
        const copy = importCopy(m);
        state.data.modelLibrary = state.data.modelLibrary.filter((x) => x.name.toLowerCase() !== m.name.toLowerCase());
        state.data.modelLibrary.push(copy);
        saveData();
        alert(`"${m.name}" staat nu in je bibliotheek.`);
      });
      const armyBtn = item.querySelector('[data-act="army"]');
      if (armyBtn) armyBtn.addEventListener("click", () => {
        army.models.push(importCopy(m));
        saveData();
        alert(`"${m.name}" is toegevoegd aan je leger.`);
      });
      item.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (!confirm(`"${m.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
        db.models = db.models.filter((x) => x !== m);
        await persist();
      });
      list.appendChild(item);
    }
  }

  function importCopy(m) {
    const copy = JSON.parse(JSON.stringify(m));
    copy.id = uid();
    copy.type = copy.type || "";
    copy.ward = copy.ward || "";
    copy.enhancementIds = [];
    return copy;
  }

  // ---------- Enhancements ----------
  function drawEnhancements() {
    for (const cat of ENHANCEMENT_CATEGORIES) {
      const items = db.enhancements.filter((e) => e.category === cat.key);
      const card = el(`<div class="card"><h2>${cat.label}</h2><div data-list></div></div>`);
      app.appendChild(card);
      const list = card.querySelector("[data-list]");
      if (!items.length) {
        list.appendChild(el(`<p class="empty">Nog geen ${cat.label.toLowerCase()} in deze database.</p>`));
        continue;
      }
      for (const enh of items) {
        const mods = (enh.statMods || []).map(modLabel).join(", ");
        const item = el(`<div class="card inner">
          <div class="card-header"><h3>${esc(enh.name)}</h3>${enh.category === "other" && enh.forType ? `<span class="chip tag">${esc(enh.forType)}</span>` : ""}</div>
          ${mods ? `<div class="subtitle">Stats: ${esc(mods)}</div>` : ""}
          ${(enh.phases || []).length ? `<div class="subtitle">Phases: ${enh.phases.map((p) => esc(phaseLabel(p))).join(", ")}${enh.oncePerBattle ? " · once per battle" : ""}</div>` : ""}
          <div class="muted-list">${esc(enh.description)}</div>
          <div class="btnrow">
            ${army ? `<button class="primary small" data-act="army">+ Naar dit leger</button>` : ""}
            <button class="danger small" data-act="del">Verwijderen</button>
          </div>
        </div>`);
        const armyBtn = item.querySelector('[data-act="army"]');
        if (armyBtn) armyBtn.addEventListener("click", () => {
          const copy = JSON.parse(JSON.stringify(enh));
          copy.id = uid();
          army.enhancements = (army.enhancements || []).filter((x) => x.name.toLowerCase() !== enh.name.toLowerCase() || x.category !== enh.category);
          army.enhancements.push(copy);
          saveData();
          alert(`"${enh.name}" is toegevoegd aan je leger.`);
        });
        item.querySelector('[data-act="del"]').addEventListener("click", async () => {
          if (!confirm(`"${enh.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
          db.enhancements = db.enhancements.filter((x) => x !== enh);
          await persist();
        });
        list.appendChild(item);
      }
    }
  }

  // ---------- Faction / subfaction rules ----------
  function drawRules(title, rules, subfaction) {
    const card = el(`<div class="card"><h2>${esc(title)}</h2><div data-list></div></div>`);
    app.appendChild(card);
    const list = card.querySelector("[data-list]");
    if (!rules.length) {
      list.appendChild(el(`<p class="empty">Nog geen rules in deze database.</p>`));
      return;
    }
    for (const r of rules) {
      const item = el(`<div class="card inner">
        <div class="card-header"><h3>${esc(r.name)}</h3>${r.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}</div>
        ${(r.phases || []).length ? `<div class="subtitle">Phases: ${r.phases.map((p) => esc(phaseLabel(p))).join(", ")}</div>` : ""}
        <div class="muted-list">${esc(r.description)}</div>
        <div class="btnrow">
          ${army ? `<button class="primary small" data-act="army">+ Naar dit leger</button>` : ""}
          <button class="danger small" data-act="del">Verwijderen</button>
        </div>
      </div>`);
      const armyBtn = item.querySelector('[data-act="army"]');
      if (armyBtn) armyBtn.addEventListener("click", () => {
        const copy = JSON.parse(JSON.stringify(r));
        const target = subfaction ? army.subfactionRules : army.factionRules;
        const i = target.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase());
        if (i >= 0) target[i] = copy;
        else target.push(copy);
        saveData();
        alert(`"${r.name}" is toegevoegd aan je leger.`);
      });
      item.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (!confirm(`"${r.name}" uit de gedeelde database verwijderen? Dit geldt voor alle accounts.`)) return;
        const arr = subfaction ? db.subfactions[subfaction].rules : db.factionRules;
        const idx = arr.indexOf(r);
        if (idx >= 0) arr.splice(idx, 1);
        await persist();
      });
      list.appendChild(item);
    }
  }

  load();
}
