import { AOS_FACTIONS, PHASE_OPTIONS, SAVES, TO_HIT_WOUND, MODEL_TYPES, WARDS, ENHANCEMENT_CATEGORIES, STAT_MODS, enhancementCategoryLabel, phaseLabel } from "./factions.js";
import { enhancementFits, modLabel } from "./enhancements.js";
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

  // sub-state binnen set-up
  let editing = null; // null | model object dat bewerkt wordt

  // Delen in de gedeelde faction-database (voor alle accounts zichtbaar)
  async function shareToDb(fn, label) {
    try {
      await fn();
      alert(`${label} gedeeld in de ${army.faction}-database.`);
    } catch (e) {
      alert("Delen in de database mislukt: " + e.message);
    }
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
    facSel.addEventListener("change", () => { army.faction = facSel.value; army.subfaction = ""; fillSubs(); saveData(); });
    subSel.addEventListener("change", () => { army.subfaction = subSel.value; saveData(); });

    // --- Models ---
    const modelsCard = el(`<div class="card"><h2>Models</h2><div id="models-list"></div>
      <div class="btnrow">
        <button class="primary" id="btn-new-model">+ Nieuw model</button>
        <button id="btn-from-lib">📇 Uit opgeslagen kaartjes</button>
      </div>
    </div>`);
    app.appendChild(modelsCard);
    const list = modelsCard.querySelector("#models-list");
    if (!army.models.length) list.appendChild(el(`<p class="empty">Nog geen models toegevoegd.</p>`));
    for (const m of army.models) {
      const tags = [];
      if (m.type) tags.push(m.type);
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
            <div class="subtitle">Move ${esc(m.move)} · Health ${esc(m.health)} · Control ${esc(m.control)}${m.controlBonus ? "+" + esc(m.controlBonus) : ""} · Save ${esc(m.save)}${m.ward && m.ward !== "-" ? " · Ward " + esc(m.ward) : ""}</div>
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
        shareToDb(() => sharedb.shareModel(army.faction, m), `Kaartje "${m.name}"`));
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

  // ===================== Kaartjes-bibliotheek =====================
  function renderLibraryPicker() {
    app.innerHTML = "";
    const header = el(`<div class="topbar">
      <span class="title">Opgeslagen kaartjes</span>
      <button class="small" id="btn-back">← Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", rerender);
    app.appendChild(header);

    const lib = state.data.modelLibrary;
    if (!lib.length) app.appendChild(el(`<p class="empty">Nog geen opgeslagen kaartjes. Kaartjes worden automatisch opgeslagen als je een model bewaart.</p>`));
    for (const m of lib) {
      const card = el(`<div class="card">
        <div class="card-header">
          <div>
            <h3>${esc(m.name)}</h3>
            <div class="subtitle">Move ${esc(m.move)} · Health ${esc(m.health)} · Save ${esc(m.save)} · ${m.rangedAttacks.length} ranged · ${m.meleeAttacks.length} melee</div>
          </div>
        </div>
        <div class="btnrow">
          <button class="primary small" data-act="add">+ Toevoegen aan leger</button>
          <button class="danger small" data-act="del">Kaartje verwijderen</button>
        </div>
      </div>`);
      card.querySelector('[data-act="add"]').addEventListener("click", () => {
        const copy = JSON.parse(JSON.stringify(m));
        copy.id = uid();
        copy.type = copy.type || "";
        copy.ward = copy.ward || "";
        copy.enhancementIds = [];
        army.models.push(copy);
        saveData();
        rerender();
      });
      card.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (confirm(`Kaartje "${m.name}" verwijderen uit de bibliotheek?`)) {
          state.data.modelLibrary = state.data.modelLibrary.filter((x) => x.id !== m.id);
          saveData();
          renderLibraryPicker();
        }
      });
      app.appendChild(card);
    }
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

    const form = el(`<div class="card">
      <label>Naam van het model / de unit</label>
      <input type="text" id="m-name" value="${esc(m.name)}" placeholder="bijv. Liberators met Grandhammers" />
      <label>Type</label>
      <select id="m-type">
        <option value="">— kies type —</option>
        ${MODEL_TYPES.map((t) => `<option ${t === m.type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <div class="row tight">
        <div>
          <label>Movement (")</label>
          <input type="text" id="m-move" value="${esc(m.move)}" placeholder='bijv. 6, D6, 2D6+2' />
        </div>
        <div>
          <label>Health</label>
          <input type="number" id="m-health" min="1" value="${esc(m.health)}" />
        </div>
        <div>
          <label>Control</label>
          <input type="number" id="m-control" min="0" value="${esc(m.control)}" />
        </div>
        <div>
          <label>Bonus control</label>
          <input type="number" id="m-controlbonus" min="0" value="${esc(m.controlBonus)}" />
        </div>
      </div>
      <div class="row tight">
        <div>
          <label>Armour save</label>
          <select id="m-save">${SAVES.map((s) => `<option ${s === m.save ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div>
          <label>Ward save</label>
          <select id="m-ward">${WARDS.map((w) => `<option value="${w === "-" ? "" : w}" ${w === (m.ward || "-") ? "selected" : ""}>${w === "-" ? "— geen —" : w}</option>`).join("")}</select>
        </div>
        <div>
          <label>Wizard level</label>
          <input type="number" id="m-wizard" min="0" value="${esc(m.wizardLevel)}" />
        </div>
        <div>
          <label>Priest level</label>
          <input type="number" id="m-priest" min="0" value="${esc(m.priestLevel)}" />
        </div>
      </div>
      <div class="checkline"><input type="checkbox" id="m-fly" ${m.fly ? "checked" : ""} /><span>Fly</span></div>
      <div class="checkline"><input type="checkbox" id="m-champ" ${m.champion ? "checked" : ""} /><span>In unit met Champion</span></div>
      <div class="checkline"><input type="checkbox" id="m-mus" ${m.musician ? "checked" : ""} /><span>In unit met Musician</span></div>
      <div class="checkline"><input type="checkbox" id="m-std" ${m.standardBearer ? "checked" : ""} /><span>In unit met Standard Bearer</span></div>
    </div>`);
    app.appendChild(form);

    // --- Weapons ---
    const weaponsWrap = el(`<div></div>`);
    app.appendChild(weaponsWrap);
    renderWeaponSection(weaponsWrap, m, "rangedAttacks", "Ranged attacks");
    renderWeaponSection(weaponsWrap, m, "meleeAttacks", "Melee attacks");

    // --- Abilities ---
    const abWrap = el(`<div class="card"><h2>Abilities</h2><div id="ab-list"></div><button class="small" id="ab-add">+ Ability toevoegen</button></div>`);
    app.appendChild(abWrap);
    const abList = abWrap.querySelector("#ab-list");
    const drawAbilities = () => {
      abList.innerHTML = "";
      if (!m.abilities.length) abList.appendChild(el(`<p class="empty">Geen abilities.</p>`));
      m.abilities.forEach((ab, i) => {
        const card = el(`<div class="card inner">
          <label>Naam ability</label>
          <input type="text" data-f="name" value="${esc(ab.name)}" />
          <label>Phases (eigen beurt en enemy beurt zijn apart — klik alle phases aan waarin de ability geldt)</label>
          <div class="chips" data-chips></div>
          <label>Wat doet de ability?</label>
          <textarea data-f="description">${esc(ab.description)}</textarea>
          <div class="checkline"><input type="checkbox" data-f="once" ${ab.oncePerBattle ? "checked" : ""} /><span>Once per battle</span></div>
          <div class="btnrow"><button class="danger small">Verwijder ability</button></div>
        </div>`);
        card.querySelector('[data-f="name"]').addEventListener("input", (e) => { ab.name = e.target.value; });
        card.querySelector('[data-f="description"]').addEventListener("input", (e) => { ab.description = e.target.value; });
        card.querySelector('[data-f="once"]').addEventListener("change", (e) => { ab.oncePerBattle = e.target.checked; });
        const chips = card.querySelector("[data-chips]");
        for (const opt of PHASE_OPTIONS) {
          const chip = el(`<span class="chip ${ab.phases.includes(opt.key) ? "active" : ""}">${opt.label}</span>`);
          chip.addEventListener("click", () => {
            if (ab.phases.includes(opt.key)) ab.phases = ab.phases.filter((p) => p !== opt.key);
            else ab.phases.push(opt.key);
            chip.classList.toggle("active");
          });
          chips.appendChild(chip);
        }
        card.querySelector("button.danger").addEventListener("click", () => { m.abilities.splice(i, 1); drawAbilities(); });
        abList.appendChild(card);
      });
    };
    drawAbilities();
    abWrap.querySelector("#ab-add").addEventListener("click", () => {
      m.abilities.push({ name: "", phases: [], description: "" });
      drawAbilities();
    });

    // --- Enhancements toekennen ---
    // Welke enhancements mogen, hangt af van het type dat nu in de editor gekozen is.
    const enhPick = el(`<div class="card"><h2>Enhancements</h2><div data-body></div></div>`);
    app.appendChild(enhPick);
    const enhBody = enhPick.querySelector("[data-body]");
    const drawEnhPicker = () => {
      enhBody.innerHTML = "";
      const type = form.querySelector("#m-type").value;
      if (!army.enhancements.length) {
        enhBody.appendChild(el(`<p class="empty">Nog geen enhancements aangemaakt — dat doe je in het leger-overzicht onder "Enhancements".</p>`));
        return;
      }
      const fits = army.enhancements.filter((e) => enhancementFits(e, { type }));
      // Niet-passende maar wel aangevinkte enhancements (bijv. na type-wissel) blijven zichtbaar
      const stale = army.enhancements.filter((e) => !fits.includes(e) && m.enhancementIds.includes(e.id));
      if (!fits.length && !stale.length) {
        enhBody.appendChild(el(`<p class="empty">${type ? `Geen enhancements beschikbaar voor het type "${esc(type)}". Artifacts of Power en Heroic Traits zijn alleen voor Heroes.` : "Kies eerst een type voor dit model."}</p>`));
        return;
      }
      for (const e of [...fits, ...stale]) {
        const isStale = stale.includes(e);
        const mods = (e.statMods || []).map(modLabel).join(", ");
        const line = el(`<div class="checkline" style="align-items:flex-start">
          <input type="checkbox" ${m.enhancementIds.includes(e.id) ? "checked" : ""} />
          <span><strong>${esc(e.name)}</strong> <span class="subtitle">— ${esc(enhancementCategoryLabel(e.category))}${e.category === "other" && e.forType ? " (" + esc(e.forType) + ")" : ""}${mods ? " · " + esc(mods) : ""}</span>${isStale ? ' <span class="chip tag dim">past niet bij type</span>' : ""}</span>
        </div>`);
        line.querySelector("input").addEventListener("change", (ev) => {
          if (ev.target.checked) m.enhancementIds.push(e.id);
          else m.enhancementIds = m.enhancementIds.filter((id) => id !== e.id);
          drawEnhPicker();
        });
        enhBody.appendChild(line);
      }
    };
    drawEnhPicker();
    form.querySelector("#m-type").addEventListener("change", drawEnhPicker);

    // --- Opslaan ---
    const shareLine = el(`<div class="card"><div class="checkline">
      <input type="checkbox" id="m-share" />
      <span>Deel dit kaartje ook in de ${esc(army.faction)}-database (zichtbaar voor alle accounts)</span>
    </div></div>`);
    app.appendChild(shareLine);
    const saveBtn = el(`<button class="primary bigbtn">✔ Model opslaan</button>`);
    saveBtn.addEventListener("click", () => {
      m.name = form.querySelector("#m-name").value.trim();
      m.type = form.querySelector("#m-type").value;
      m.ward = form.querySelector("#m-ward").value;
      m.move = form.querySelector("#m-move").value.trim();
      m.health = parseInt(form.querySelector("#m-health").value) || 1;
      m.control = parseInt(form.querySelector("#m-control").value) || 0;
      m.controlBonus = parseInt(form.querySelector("#m-controlbonus").value) || 0;
      m.save = form.querySelector("#m-save").value;
      m.wizardLevel = parseInt(form.querySelector("#m-wizard").value) || 0;
      m.priestLevel = parseInt(form.querySelector("#m-priest").value) || 0;
      m.fly = form.querySelector("#m-fly").checked;
      m.champion = form.querySelector("#m-champ").checked;
      m.musician = form.querySelector("#m-mus").checked;
      m.standardBearer = form.querySelector("#m-std").checked;
      if (!m.name) { alert("Geef het model een naam."); return; }
      if (isNew) army.models.push(m);
      // Kaartje opslaan/verversen in de bibliotheek (op naam).
      // Enhancements horen bij dit leger, dus die gaan niet mee het kaartje in.
      const card = JSON.parse(JSON.stringify(m));
      card.id = uid();
      card.enhancementIds = [];
      state.data.modelLibrary = state.data.modelLibrary.filter((x) => x.name.toLowerCase() !== m.name.toLowerCase());
      state.data.modelLibrary.push(card);
      saveData();
      if (shareLine.querySelector("#m-share").checked) {
        shareToDb(() => sharedb.shareModel(army.faction, m), `Kaartje "${m.name}"`);
      }
      editing = null;
      rerender();
    });
    app.appendChild(saveBtn);
  }

  function renderWeaponSection(parent, m, key, title) {
    const wrap = el(`<div class="card"><h2>${title}</h2><div data-list></div><button class="small" data-add>+ ${title === "Ranged attacks" ? "Ranged attack" : "Melee attack"} toevoegen</button></div>`);
    parent.appendChild(wrap);
    const list = wrap.querySelector("[data-list]");

    const draw = () => {
      list.innerHTML = "";
      if (!m[key].length) list.appendChild(el(`<p class="empty">Geen ${title.toLowerCase()}.</p>`));
      m[key].forEach((w, i) => {
        const card = el(`<div class="card inner">
          <label>Naam wapen</label>
          <input type="text" data-f="name" value="${esc(w.name)}" placeholder="bijv. Warhammer" />
          <div class="row tight">
            ${key === "rangedAttacks" ? `<div><label>Range (")</label><input type="text" data-f="range" value="${esc(w.range ?? "")}" placeholder='bijv. 12' /></div>` : ""}
            <div><label>Attacks</label><input type="number" data-f="attacks" min="0" value="${esc(w.attacks)}" /></div>
            <div><label>To hit</label><select data-f="toHit">${TO_HIT_WOUND.map((s) => `<option ${s === w.toHit ? "selected" : ""}>${s}</option>`).join("")}</select></div>
            <div><label>To wound</label><select data-f="toWound">${TO_HIT_WOUND.map((s) => `<option ${s === w.toWound ? "selected" : ""}>${s}</option>`).join("")}</select></div>
            <div><label>Rend</label><input type="number" data-f="rend" min="0" value="${esc(w.rend)}" /></div>
            <div><label>Damage</label><input type="text" data-f="damage" value="${esc(w.damage)}" placeholder="1, D3, D6+1" /></div>
          </div>
          <label>Conditionele bonussen (bijv. "+1 damage on the charge")</label>
          <div data-bonuses></div>
          <button class="small" data-bonus-add>+ Bonus</button>
          <div class="btnrow"><button class="danger small" data-del>Verwijder wapen</button></div>
        </div>`);
        for (const f of ["name", "range", "attacks", "toHit", "toWound", "rend", "damage"]) {
          const input = card.querySelector(`[data-f="${f}"]`);
          if (!input) continue;
          input.addEventListener("input", (e) => { w[f] = e.target.value; });
          input.addEventListener("change", (e) => { w[f] = e.target.value; });
        }
        const bonusWrap = card.querySelector("[data-bonuses]");
        const drawBonuses = () => {
          bonusWrap.innerHTML = "";
          w.bonuses.forEach((b, bi) => {
            const row = el(`<div style="display:flex;gap:6px;margin:4px 0">
              <input type="text" value="${esc(b)}" placeholder="bijv. anti-charge +1 rend" />
              <button class="danger small">✕</button>
            </div>`);
            row.querySelector("input").addEventListener("input", (e) => { w.bonuses[bi] = e.target.value; });
            row.querySelector("button").addEventListener("click", () => { w.bonuses.splice(bi, 1); drawBonuses(); });
            bonusWrap.appendChild(row);
          });
        };
        drawBonuses();
        card.querySelector("[data-bonus-add]").addEventListener("click", () => { w.bonuses.push(""); drawBonuses(); });
        card.querySelector("[data-del]").addEventListener("click", () => { m[key].splice(i, 1); draw(); });
        list.appendChild(card);
      });
    };
    draw();
    wrap.querySelector("[data-add]").addEventListener("click", () => {
      m[key].push({ name: "", range: "", attacks: 1, toHit: "4+", toWound: "4+", rend: 0, damage: "1", bonuses: [] });
      draw();
    });
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
      renderLoreEditor(content, "spellLore", "Spell lore", "Casting value", "spell");
      renderLoreEditor(content, "manifestationLore", "Manifestation lore", "Casting value", "manifestation");
    }
    if (hasPriest) {
      renderLoreEditor(content, "prayerLore", "Prayer lore", "Chanting value", "prayer");
    }
  }

  function renderLoreEditor(parent, key, title, valueLabel, itemNoun) {
    const wrap = el(`<div class="card inner"><h3>${title}</h3><div data-body></div></div>`);
    parent.appendChild(wrap);
    const body = wrap.querySelector("[data-body]");

    const draw = () => {
      body.innerHTML = "";
      const lore = army[key];
      if (!lore) {
        const btn = el(`<button class="small">+ ${title} kiezen</button>`);
        btn.addEventListener("click", () => {
          army[key] = {
            name: "",
            entries: [1, 2, 3].map(() => ({ name: "", value: "", description: "" })),
          };
          saveData();
          draw();
        });
        body.appendChild(el(`<p class="empty">Nog geen ${title.toLowerCase()} gekozen (optioneel).</p>`));
        body.appendChild(btn);
        return;
      }
      const nameInput = el(`<div><label>Naam van de lore</label><input type="text" value="${esc(lore.name)}" /></div>`);
      nameInput.querySelector("input").addEventListener("input", (e) => { lore.name = e.target.value; saveData(); });
      body.appendChild(nameInput);
      lore.entries.forEach((entry, i) => {
        const eCard = el(`<div style="border-top:1px dashed var(--border);margin-top:10px;padding-top:6px">
          <div class="row">
            <div style="flex:2"><label>${title.split(" ")[0] === "Prayer" ? "Prayer" : itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1)} ${i + 1} — naam</label><input type="text" data-f="name" value="${esc(entry.name)}" /></div>
            <div><label>${valueLabel}</label><input type="text" data-f="value" value="${esc(entry.value)}" placeholder="bijv. 7" /></div>
          </div>
          <label>Beschrijving</label>
          <textarea data-f="description">${esc(entry.description)}</textarea>
        </div>`);
        for (const f of ["name", "value", "description"]) {
          eCard.querySelector(`[data-f="${f}"]`).addEventListener("input", (e) => { entry[f] = e.target.value; saveData(); });
        }
        body.appendChild(eCard);
      });
      const delBtn = el(`<div class="btnrow"><button class="danger small">✕ ${title} verwijderen</button></div>`);
      delBtn.querySelector("button").addEventListener("click", () => {
        if (confirm(`${title} verwijderen?`)) { army[key] = null; saveData(); draw(); }
      });
      body.appendChild(delBtn);
    };
    draw();
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
          list.appendChild(enhancementEditor(enh, draw));
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

  function enhancementEditor(enh, redrawList) {
    const card = el(`<div style="border-top:1px dashed var(--border);margin-top:10px;padding-top:6px">
      <label>Naam</label>
      <input type="text" data-f="name" value="${esc(enh.name)}" />
      ${enh.category === "other" ? `
        <label>Voor model-type</label>
        <select data-f="forType">
          <option value="">— kies type —</option>
          ${MODEL_TYPES.map((t) => `<option ${t === enh.forType ? "selected" : ""}>${t}</option>`).join("")}
        </select>` : ""}
      <label>Beschrijving</label>
      <textarea data-f="description">${esc(enh.description)}</textarea>
      <label>Stat improvements (optioneel)</label>
      <div data-mods></div>
      <button class="small" data-mod-add>+ Stat improvement</button>
      <label>Phases waarin de ability getoond wordt (optioneel — laat leeg als de enhancement alleen stats verbetert)</label>
      <div class="chips" data-chips></div>
      <div class="checkline"><input type="checkbox" data-f="once" ${enh.oncePerBattle ? "checked" : ""} /><span>Once per battle</span></div>
      <div class="btnrow">
        <button class="small" data-share>📚 Deel in database</button>
        <button class="danger small" data-del>Verwijder enhancement</button>
      </div>
    </div>`);
    card.querySelector("[data-share]").addEventListener("click", () =>
      shareToDb(() => sharedb.shareEnhancement(army.faction, enh), `Enhancement "${enh.name}"`));

    card.querySelector('[data-f="name"]').addEventListener("input", (e) => { enh.name = e.target.value; saveData(); });
    card.querySelector('[data-f="description"]').addEventListener("input", (e) => { enh.description = e.target.value; saveData(); });
    card.querySelector('[data-f="once"]').addEventListener("change", (e) => { enh.oncePerBattle = e.target.checked; saveData(); });
    const forTypeSel = card.querySelector('[data-f="forType"]');
    if (forTypeSel) forTypeSel.addEventListener("change", () => { enh.forType = forTypeSel.value; saveData(); });

    // Stat improvements
    const modsWrap = card.querySelector("[data-mods]");
    const drawMods = () => {
      modsWrap.innerHTML = "";
      (enh.statMods || []).forEach((mod, i) => {
        const def = STAT_MODS.find((s) => s.key === mod.stat) || STAT_MODS[0];
        const row = el(`<div style="display:flex;gap:6px;margin:4px 0;align-items:center">
          <select data-stat style="flex:2">${STAT_MODS.map((s) => `<option value="${s.key}" ${s.key === mod.stat ? "selected" : ""}>${s.label}</option>`).join("")}</select>
          ${def.kind === "ward"
            ? `<select data-val style="flex:1">${WARDS.filter((w) => w !== "-").map((w) => `<option ${w === mod.value ? "selected" : ""}>${w}</option>`).join("")}</select>`
            : `<span style="color:var(--text-dim)">+</span><input type="number" data-val min="1" value="${esc(mod.value)}" style="flex:1;min-width:55px" />`}
          <button class="danger small">✕</button>
        </div>`);
        row.querySelector("[data-stat]").addEventListener("change", (e) => {
          mod.stat = e.target.value;
          const newDef = STAT_MODS.find((s) => s.key === mod.stat);
          mod.value = newDef.kind === "ward" ? "6+" : 1;
          saveData();
          drawMods();
        });
        row.querySelector("[data-val]").addEventListener("change", (e) => { mod.value = e.target.value; saveData(); });
        row.querySelector("button.danger").addEventListener("click", () => { enh.statMods.splice(i, 1); saveData(); drawMods(); });
        modsWrap.appendChild(row);
      });
    };
    drawMods();
    card.querySelector("[data-mod-add]").addEventListener("click", () => {
      enh.statMods = enh.statMods || [];
      enh.statMods.push({ stat: "save", value: 1 });
      saveData();
      drawMods();
    });

    // Phases
    const chips = card.querySelector("[data-chips]");
    for (const opt of PHASE_OPTIONS) {
      const chip = el(`<span class="chip ${enh.phases.includes(opt.key) ? "active" : ""}">${opt.label}</span>`);
      chip.addEventListener("click", () => {
        if (enh.phases.includes(opt.key)) enh.phases = enh.phases.filter((p) => p !== opt.key);
        else enh.phases.push(opt.key);
        chip.classList.toggle("active");
        saveData();
      });
      chips.appendChild(chip);
    }

    card.querySelector("[data-del]").addEventListener("click", () => {
      if (!confirm(`Enhancement "${enh.name || "(naamloos)"}" verwijderen?`)) return;
      army.enhancements = army.enhancements.filter((e) => e.id !== enh.id);
      for (const m of army.models) m.enhancementIds = (m.enhancementIds || []).filter((id) => id !== enh.id);
      saveData();
      redrawList();
    });
    return card;
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
        const card = el(`<div class="card inner">
          <label>Naam rule</label>
          <input type="text" data-f="name" value="${esc(r.name)}" />
          <label>Phases (meerdere mogelijk)</label>
          <div class="chips" data-chips></div>
          <label>Beschrijving</label>
          <textarea data-f="description">${esc(r.description)}</textarea>
          <div class="checkline"><input type="checkbox" data-f="once" ${r.oncePerBattle ? "checked" : ""} /><span>Once per battle</span></div>
          <div class="btnrow">
            <button class="small" data-share>📚 Deel in database</button>
            <button class="danger small">Verwijder rule</button>
          </div>
        </div>`);
        card.querySelector("[data-share]").addEventListener("click", () => {
          if (isSubfaction && !army.subfaction) { alert("Kies eerst een subfaction voor dit leger."); return; }
          shareToDb(() => sharedb.shareRule(army.faction, isSubfaction ? army.subfaction : null, r), `Rule "${r.name}"`);
        });
        card.querySelector('[data-f="name"]').addEventListener("input", (e) => { r.name = e.target.value; saveData(); });
        card.querySelector('[data-f="description"]').addEventListener("input", (e) => { r.description = e.target.value; saveData(); });
        card.querySelector('[data-f="once"]').addEventListener("change", (e) => { r.oncePerBattle = e.target.checked; saveData(); });
        const chips = card.querySelector("[data-chips]");
        for (const opt of PHASE_OPTIONS) {
          const chip = el(`<span class="chip ${r.phases.includes(opt.key) ? "active" : ""}">${opt.label}</span>`);
          chip.addEventListener("click", () => {
            if (r.phases.includes(opt.key)) r.phases = r.phases.filter((p) => p !== opt.key);
            else r.phases.push(opt.key);
            chip.classList.toggle("active");
            saveData();
          });
          chips.appendChild(chip);
        }
        card.querySelector("button.danger").addEventListener("click", () => { rules.splice(i, 1); saveData(); draw(); });
        list.appendChild(card);
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
