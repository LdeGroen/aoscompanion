import { AOS_FACTIONS, groupByType, loreKind } from "./factions.js";
import { buildModelEditor, buildRuleEditor, buildLoreEditor } from "./editors.js";
import { effectiveModel, migrateModelEnhancements } from "./enhancements.js";
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

  // Faction-enhancements uit de database, voor de picker in de model-editor.
  // Async geladen; bij binnenkomst opnieuw renderen.
  let factionEnhancements = null;
  async function loadFactionEnhancements() {
    try {
      const { db } = await sharedb.loadFactionDb(army.faction);
      factionEnhancements = db.enhancements || [];
    } catch {
      factionEnhancements = [];
    }
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
      army.subfactionRules = JSON.parse(JSON.stringify(db.subfactions[army.subfaction]?.rules || []));
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

  // ===================== Leger-overzicht =====================
  function renderArmyOverview() {
    const header = el(`<div class="topbar">
      <span class="title">Set-up mode</span>
      <div style="display:flex;gap:6px">
        <button class="small" id="btn-db">${icon("book")} Database</button>
        <button class="small" id="btn-back">${icon("back")} Mijn legers</button>
      </div>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => { saveData(); navigate("home"); });
    header.querySelector("#btn-db").addEventListener("click", () => { saveData(); navigate("database", { armyId: army.id, dbReturn: "setup" }); });
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
      <p class="subtitle">Bij het kiezen van een army of subfaction worden de rules en enhancements uit de gedeelde database automatisch in dit leger gezet — daarna kun je ze hier aanpassen.</p>
    </div>`);
    app.appendChild(base);

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
      await applyFactionDefaults();
      saveData();
      rerender();
    });
    subSel.addEventListener("change", async () => {
      army.subfaction = subSel.value;
      if (army.subfaction) await applySubfactionDefaults();
      else army.subfactionRules = [];
      saveData();
      rerender();
    });

    // --- Models ---
    const modelsCard = el(`<div class="card"><h2>Models</h2><div id="models-list"></div>
      <div class="btnrow">
        <button class="primary" id="btn-new-model">${icon("plus")} Nieuw model</button>
        <button id="btn-from-lib">${icon("import")} Kaartje uit de database</button>
      </div>
    </div>`);
    app.appendChild(modelsCard);
    const list = modelsCard.querySelector("#models-list");
    if (!army.models.length) list.appendChild(el(`<p class="empty">Nog geen models toegevoegd.</p>`));
    // Gegroepeerd per type, per groep uit- en inklapbaar
    for (const [typeLabel, models] of groupByType(army.models)) {
      const group = el(`<details class="type-group" ${collapsedTypes.has(typeLabel) ? "" : "open"}>
        <summary>${esc(typeLabel)} <span class="count">(${models.length})</span></summary>
        <div data-items></div>
      </details>`);
      group.addEventListener("toggle", () => {
        if (group.open) collapsedTypes.delete(typeLabel);
        else collapsedTypes.add(typeLabel);
      });
      const itemsWrap = group.querySelector("[data-items]");
      list.appendChild(group);
      for (const m of models) {
      const tags = [];
      if (m.type) tags.push(m.type);
      if (m.type === "Manifestation" && m.universal) tags.push("Universal");
      if (m.fly) tags.push("Fly");
      if (m.wizardLevel > 0) tags.push(`Wizard (${m.wizardLevel})`);
      if (m.priestLevel > 0) tags.push(`Priest (${m.priestLevel})`);
      if (m.champion) tags.push("Champion");
      if (m.musician) tags.push("Musician");
      if (m.standardBearer) tags.push("Standard Bearer");
      const card = el(`<div class="card inner">
        <div class="card-header">
          <div>
            <h3>${esc(m.name) || "(naamloos)"}</h3>
            <div class="subtitle">Move ${esc(m.move)} · Health ${esc(m.health)} · Control ${esc(m.control)}${m.controlBonus ? "+" + esc(m.controlBonus) : ""} · Save ${esc(m.save)}${m.ward && m.ward !== "-" ? " · Ward " + esc(m.ward) : ""}${m.banishment ? " · Banish " + esc(m.banishment) : ""}</div>
            ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
            <div class="muted-list">${m.rangedAttacks.length} ranged · ${m.meleeAttacks.length} melee · ${m.abilities.length} abilities${(m.enhancements || []).length ? ` · ${m.enhancements.length} enhancement${m.enhancements.length === 1 ? "" : "s"}` : ""}</div>
          </div>
        </div>
        <div class="btnrow">
          <button class="small" data-act="edit">${icon("edit")} Bewerken</button>
          <button class="small" data-act="copy">${icon("copy")} Dupliceren</button>
          <button class="small" data-act="share">${icon("share")} Deel in database</button>
          <button class="danger small" data-act="del">${icon("trash")} Verwijderen</button>
        </div>
      </div>`);
      card.querySelector('[data-act="edit"]').addEventListener("click", () => { editing = m; rerender(true); });
      card.querySelector('[data-act="share"]').addEventListener("click", () =>
        shareToDb(() => sharedb.shareModel(army.faction, m, state.user), `Kaartje "${m.name}"`, modelShareTarget(m)));
      card.querySelector('[data-act="copy"]').addEventListener("click", () => {
        const copy = JSON.parse(JSON.stringify(m));
        copy.id = uid();
        copy.name = m.name + " (kopie)";
        army.models.push(copy);
        saveData();
        rerender();
      });
      card.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (confirm(`Model "${m.name}" verwijderen uit dit leger?`)) {
          army.models = army.models.filter((x) => x.id !== m.id);
          saveData();
          rerender();
        }
      });
      itemsWrap.appendChild(card);
      }
    }
    modelsCard.querySelector("#btn-new-model").addEventListener("click", () => {
      editing = blankModel();
      rerender(true);
    });
    modelsCard.querySelector("#btn-from-lib").addEventListener("click", () => renderLibraryPicker());

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

    // Enhancement-pool uit de database; bij binnenkomst opnieuw renderen
    const editor = buildModelEditor({ container: app, m, el, esc, army, onChange: saveData, enhancementPool: factionEnhancements || [] });
    if (factionEnhancements === null) loadFactionEnhancements().then(() => { if (editing === m) rerender(); });

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
        const btn = el(`<button class="small">${icon("plus")} ${def.label} kiezen</button>`);
        btn.addEventListener("click", () => {
          army[def.armyField] = {
            name: "",
            entries: [1, 2, 3].map(() => ({ name: "", value: "", description: "" })),
          };
          saveData();
          draw();
        });
        body.appendChild(el(`<p class="empty">Nog geen ${def.label.toLowerCase()} gekozen (optioneel). Je kunt er ook een importeren via de Database.</p>`));
        body.appendChild(btn);
        return;
      }
      const build = (names) => body.appendChild(buildLoreEditor({
        lore, kind: kindKey, el, esc,
        onChange: saveData,
        universalChoice: true,
        manifestationOptions: names,
        onRedraw: draw,
        actions: [
          {
            label: `${icon("share")} Deel in database`,
            onClick: async () => {
              if (!lore.name.trim()) { alert("Geef de lore eerst een naam."); return; }
              const target = kindKey === "manifestation" && lore.universal ? "universal database" : `${army.faction}-database`;
              try {
                await sharedb.shareLore(army.faction, kindKey, lore, state.user);
                alert(`${def.label} "${lore.name}" gedeeld in de ${target}.`);
              } catch (e) {
                alert("Delen in de database mislukt: " + e.message);
              }
            },
          },
          {
            label: `${icon("trash")} ${def.label} verwijderen`,
            danger: true,
            onClick: () => {
              if (!confirm(`${def.label} verwijderen?`)) return;
              army[def.armyField] = null;
              // bij een manifestation lore ook de lore-gedreven manifestaties weghalen
              if (kindKey === "manifestation") army.models = army.models.filter((m) => !m.fromLore);
              saveData();
              draw();
            },
          },
        ],
      }));
      // De spell-picker van een universal manifestation lore heeft de namen
      // van de universal manifestation-models nodig (async uit de database).
      if (kindKey === "manifestation") getUniversalManifestNames().then(build);
      else build(null);
    };
    draw();
  }

  // ===================== Faction / subfaction rules =====================
  function renderRulesSection(title, rules, isSubfaction) {
    const wrap = el(`<div class="card"><h2>${title}</h2><div data-list></div><button class="small" data-add>${icon("plus")} Rule toevoegen</button></div>`);
    app.appendChild(wrap);
    const list = wrap.querySelector("[data-list]");

    const draw = () => {
      list.innerHTML = "";
      if (!rules.length) list.appendChild(el(`<p class="empty">Geen ${title.toLowerCase()}.</p>`));
      rules.forEach((r, i) => {
        list.appendChild(buildRuleEditor({
          rule: r, el, esc,
          onChange: saveData,
          actions: [
            {
              label: `${icon("share")} Deel in database`,
              onClick: () => {
                if (isSubfaction && !army.subfaction) { alert("Kies eerst een subfaction voor dit leger."); return; }
                shareToDb(() => sharedb.shareRule(army.faction, isSubfaction ? army.subfaction : null, r, state.user), `Rule "${r.name}"`);
              },
            },
            {
              label: "Verwijder rule",
              danger: true,
              onClick: () => { rules.splice(i, 1); saveData(); draw(); },
            },
          ],
        }));
      });
    };
    draw();
    wrap.querySelector("[data-add]").addEventListener("click", () => {
      rules.push({ name: "", phases: [], description: "" });
      saveData();
      draw();
    });
  }

  rerender();
}
