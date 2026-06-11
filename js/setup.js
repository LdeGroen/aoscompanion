import { AOS_FACTIONS, ENHANCEMENT_CATEGORIES, loreKind } from "./factions.js";
import { buildModelEditor, buildEnhancementEditor, buildRuleEditor, buildLoreEditor } from "./editors.js";
import * as sharedb from "./sharedb.js";
import { uid } from "./storage.js";

// Set-up mode: leger samenstellen, models invoeren, enhancements, lores en faction rules.
export function renderSetup(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  const army = state.data.armies.find((a) => a.id === state.armyId);
  if (!army) return navigate("home");

  // Migratie voor data van vóór deze features
  army.enhancements = army.enhancements || [];
  for (const m of army.models) {
    m.type = m.type || "";
    m.ward = m.ward || "";
    m.enhancementIds = m.enhancementIds || [];
  }

  // Kopieert de faction rules en alle enhancements van de gekozen faction uit
  // de gedeelde database in dit leger (vervangt wat er stond). Daarna zijn het
  // gewone leger-items die je lokaal kunt aanpassen.
  async function applyFactionDefaults() {
    try {
      const { db } = await sharedb.loadFactionDb(army.faction);
      army.factionRules = JSON.parse(JSON.stringify(db.factionRules));
      army.enhancements = db.enhancements.map((e) => {
        const copy = JSON.parse(JSON.stringify(e));
        copy.id = uid();
        return copy;
      });
      army.subfactionRules = [];
      // De oude enhancement-ids bestaan niet meer
      for (const m of army.models) m.enhancementIds = [];
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
  if (!army.dbDefaultsLoaded && !army.models.length && !army.factionRules.length
      && !army.subfactionRules.length && !army.enhancements.length) {
    army.dbDefaultsLoaded = true;
    applyFactionDefaults().then(() => { saveData(); rerender(); });
  }

  // sub-state binnen set-up
  let editing = null; // null | model object dat bewerkt wordt

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

  function rerender() {
    app.innerHTML = "";
    window.scrollTo(0, 0);
    if (editing) {
      renderModelEditor(editing);
    } else {
      renderArmyOverview();
    }
  }

  // ===================== Leger-overzicht =====================
  function renderArmyOverview() {
    const header = el(`<div class="topbar">
      <span class="title">Set-up mode</span>
      <div style="display:flex;gap:6px">
        <button class="small" id="btn-db">📚 Database</button>
        <button class="small" id="btn-back">← Mijn legers</button>
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
        <button class="primary" id="btn-new-model">+ Nieuw model</button>
        <button id="btn-from-lib">📚 Kaartje uit de database</button>
      </div>
    </div>`);
    app.appendChild(modelsCard);
    const list = modelsCard.querySelector("#models-list");
    if (!army.models.length) list.appendChild(el(`<p class="empty">Nog geen models toegevoegd.</p>`));
    for (const m of army.models) {
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
            <div class="muted-list">${m.rangedAttacks.length} ranged · ${m.meleeAttacks.length} melee · ${m.abilities.length} abilities${m.enhancementIds.length ? ` · ${m.enhancementIds.length} enhancement${m.enhancementIds.length === 1 ? "" : "s"}` : ""}</div>
          </div>
        </div>
        <div class="btnrow">
          <button class="small" data-act="edit">✎ Bewerken</button>
          <button class="small" data-act="copy">⧉ Dupliceren</button>
          <button class="small" data-act="share">📚 Deel in database</button>
          <button class="danger small" data-act="del">Verwijderen</button>
        </div>
      </div>`);
      card.querySelector('[data-act="edit"]').addEventListener("click", () => { editing = m; rerender(); });
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
      list.appendChild(card);
    }
    modelsCard.querySelector("#btn-new-model").addEventListener("click", () => {
      editing = blankModel();
      rerender();
    });
    modelsCard.querySelector("#btn-from-lib").addEventListener("click", () => renderLibraryPicker());

    // --- Enhancements ---
    renderEnhancementsSection();

    // --- Lores ---
    renderLores();

    // --- Faction & subfaction rules ---
    renderRulesSection("Faction rules", army.factionRules, false);
    renderRulesSection("Subfaction rules", army.subfactionRules, true);

    const done = el(`<button class="primary bigbtn">✔ Klaar — terug naar mijn legers</button>`);
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
      <button class="small" id="btn-back">← Terug</button>
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
        models = [
          ...db.models.map((m) => ({ m, isUniversal: false })),
          ...uni.models.map((m) => ({ m, isUniversal: true })),
        ];
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
            <button class="primary small" data-act="add">+ Toevoegen aan leger</button>
          </div>
        </div>`);
        card.querySelector('[data-act="add"]').addEventListener("click", () => {
          const copy = JSON.parse(JSON.stringify(m));
          copy.id = uid();
          copy.type = copy.type || "";
          copy.ward = copy.ward || "";
          copy.enhancementIds = [];
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
      enhancementIds: [],
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
      <button class="small" id="btn-cancel">← Annuleren</button>
    </div>`);
    header.querySelector("#btn-cancel").addEventListener("click", () => { editing = null; rerender(); });
    app.appendChild(header);

    const editor = buildModelEditor({ container: app, m, el, esc, army });

    // --- Opslaan ---
    const shareLine = el(`<div class="card"><div class="checkline">
      <input type="checkbox" id="m-share" />
      <span>Deel dit kaartje ook in de gedeelde database (zichtbaar voor alle accounts; universal manifestations gaan naar de universal database, de rest naar de ${esc(army.faction)}-database)</span>
    </div></div>`);
    app.appendChild(shareLine);
    const saveBtn = el(`<button class="primary bigbtn">✔ Model opslaan</button>`);
    saveBtn.addEventListener("click", () => {
      if (!editor.commit()) { alert("Geef het model een naam."); return; }
      if (isNew) army.models.push(m);
      saveData();
      if (shareLine.querySelector("#m-share").checked) {
        shareToDb(() => sharedb.shareModel(army.faction, m, state.user), `Kaartje "${m.name}"`, modelShareTarget(m));
      }
      editing = null;
      rerender();
    });
    app.appendChild(saveBtn);
  }

  // ===================== Enhancements =====================
  function blankEnhancement(category) {
    return {
      id: uid(),
      name: "",
      category,                 // artifact | heroicTrait | other
      forType: "",              // alleen bij category "other"
      description: "",
      phases: [],               // leeg = puur een stat improvement
      oncePerBattle: false,
      statMods: [],             // [{stat, value}]
    };
  }

  function renderEnhancementsSection() {
    const wrap = el(`<div class="card"><h2>Enhancements</h2>
      <p class="subtitle">Artifacts of Power en Heroic Traits kunnen alleen aan models met type "Hero" gegeven worden. Other Enhancements gelden voor één model-type naar keuze.</p>
      <div data-cats></div>
    </div>`);
    app.appendChild(wrap);
    const cats = wrap.querySelector("[data-cats]");

    const singular = { artifact: "Artifact of Power", heroicTrait: "Heroic Trait", other: "Other Enhancement" };
    for (const cat of ENHANCEMENT_CATEGORIES) {
      const section = el(`<div class="card inner"><h3>${cat.label}</h3><div data-list></div>
        <button class="small" data-add>+ ${singular[cat.key]} toevoegen</button>
      </div>`);
      cats.appendChild(section);
      const list = section.querySelector("[data-list]");

      const draw = () => {
        list.innerHTML = "";
        const items = army.enhancements.filter((e) => e.category === cat.key);
        if (!items.length) list.appendChild(el(`<p class="empty">Nog geen ${cat.label.toLowerCase()}.</p>`));
        for (const enh of items) {
          list.appendChild(buildEnhancementEditor({
            enh, el, esc,
            onChange: saveData,
            actions: [
              {
                label: "📚 Deel in database",
                onClick: () => shareToDb(() => sharedb.shareEnhancement(army.faction, enh, state.user), `Enhancement "${enh.name}"`),
              },
              {
                label: "Verwijder enhancement",
                danger: true,
                onClick: () => {
                  if (!confirm(`Enhancement "${enh.name || "(naamloos)"}" verwijderen?`)) return;
                  army.enhancements = army.enhancements.filter((e) => e.id !== enh.id);
                  for (const m of army.models) m.enhancementIds = (m.enhancementIds || []).filter((id) => id !== enh.id);
                  saveData();
                  draw();
                },
              },
            ],
          }));
        }
      };
      draw();
      section.querySelector("[data-add]").addEventListener("click", () => {
        army.enhancements.push(blankEnhancement(cat.key));
        saveData();
        draw();
      });
    }
  }

  // ===================== Lores =====================
  function renderLores() {
    const hasWizard = army.models.some((m) => m.wizardLevel > 0);
    const hasPriest = army.models.some((m) => m.priestLevel > 0);

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
        const btn = el(`<button class="small">+ ${def.label} kiezen</button>`);
        btn.addEventListener("click", () => {
          army[def.armyField] = {
            name: "",
            entries: [1, 2, 3].map(() => ({ name: "", value: "", description: "" })),
          };
          saveData();
          draw();
        });
        body.appendChild(el(`<p class="empty">Nog geen ${def.label.toLowerCase()} gekozen (optioneel). Je kunt er ook een importeren via 📚 Database.</p>`));
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
            label: "📚 Deel in database",
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
            label: `✕ ${def.label} verwijderen`,
            danger: true,
            onClick: () => {
              if (confirm(`${def.label} verwijderen?`)) { army[def.armyField] = null; saveData(); draw(); }
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
    const wrap = el(`<div class="card"><h2>${title}</h2><div data-list></div><button class="small" data-add>+ Rule toevoegen</button></div>`);
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
              label: "📚 Deel in database",
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
