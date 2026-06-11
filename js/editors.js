import { PHASE_OPTIONS, SAVES, TO_HIT_WOUND, MODEL_TYPES, WARDS, STAT_MODS, enhancementCategoryLabel } from "./factions.js";
import { enhancementFits, modLabel } from "./enhancements.js";

// Herbruikbare editors voor models, enhancements en rules.
// Gebruikt door set-up mode én het database-scherm (bewerken van gedeelde entries).
//
// Conventie: weapons/abilities/mods schrijven live in het object; de losse
// invoervelden van het model-formulier worden pas bij commit() uitgelezen.
// onChange wordt na iedere wijziging aangeroepen (set-up geeft saveData door,
// het database-scherm niets — daar sla je pas op bij de opslaan-knop).

// ---------- Model ----------
export function buildModelEditor({ container, m, el, esc, army = null, onChange = () => {} }) {
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
  container.appendChild(form);

  // --- Weapons ---
  buildWeaponSection({ container, m, key: "rangedAttacks", title: "Ranged attacks", el, esc, onChange });
  buildWeaponSection({ container, m, key: "meleeAttacks", title: "Melee attacks", el, esc, onChange });

  // --- Abilities ---
  const abWrap = el(`<div class="card"><h2>Abilities</h2><div id="ab-list"></div><button class="small" id="ab-add">+ Ability toevoegen</button></div>`);
  container.appendChild(abWrap);
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
      card.querySelector('[data-f="name"]').addEventListener("input", (e) => { ab.name = e.target.value; onChange(); });
      card.querySelector('[data-f="description"]').addEventListener("input", (e) => { ab.description = e.target.value; onChange(); });
      card.querySelector('[data-f="once"]').addEventListener("change", (e) => { ab.oncePerBattle = e.target.checked; onChange(); });
      buildPhaseChips(card.querySelector("[data-chips]"), ab, el, onChange);
      card.querySelector("button.danger").addEventListener("click", () => { m.abilities.splice(i, 1); onChange(); drawAbilities(); });
      abList.appendChild(card);
    });
  };
  drawAbilities();
  abWrap.querySelector("#ab-add").addEventListener("click", () => {
    m.abilities.push({ name: "", phases: [], description: "" });
    drawAbilities();
  });

  // --- Enhancements toekennen (alleen in leger-context) ---
  if (army) {
    const enhPick = el(`<div class="card"><h2>Enhancements</h2><div data-body></div></div>`);
    container.appendChild(enhPick);
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
  }

  // Leest de formuliervelden in het model; false als de naam ontbreekt.
  function commit() {
    const name = form.querySelector("#m-name").value.trim();
    if (!name) return false;
    m.name = name;
    m.type = form.querySelector("#m-type").value;
    m.move = form.querySelector("#m-move").value.trim();
    m.health = parseInt(form.querySelector("#m-health").value) || 1;
    m.control = parseInt(form.querySelector("#m-control").value) || 0;
    m.controlBonus = parseInt(form.querySelector("#m-controlbonus").value) || 0;
    m.save = form.querySelector("#m-save").value;
    m.ward = form.querySelector("#m-ward").value;
    m.wizardLevel = parseInt(form.querySelector("#m-wizard").value) || 0;
    m.priestLevel = parseInt(form.querySelector("#m-priest").value) || 0;
    m.fly = form.querySelector("#m-fly").checked;
    m.champion = form.querySelector("#m-champ").checked;
    m.musician = form.querySelector("#m-mus").checked;
    m.standardBearer = form.querySelector("#m-std").checked;
    return true;
  }

  return { commit };
}

function buildWeaponSection({ container, m, key, title, el, esc, onChange }) {
  const wrap = el(`<div class="card"><h2>${title}</h2><div data-list></div><button class="small" data-add>+ ${title === "Ranged attacks" ? "Ranged attack" : "Melee attack"} toevoegen</button></div>`);
  container.appendChild(wrap);
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
        input.addEventListener("input", (e) => { w[f] = e.target.value; onChange(); });
        input.addEventListener("change", (e) => { w[f] = e.target.value; onChange(); });
      }
      const bonusWrap = card.querySelector("[data-bonuses]");
      const drawBonuses = () => {
        bonusWrap.innerHTML = "";
        w.bonuses.forEach((b, bi) => {
          const row = el(`<div style="display:flex;gap:6px;margin:4px 0">
            <input type="text" value="${esc(b)}" placeholder="bijv. anti-charge +1 rend" />
            <button class="danger small">✕</button>
          </div>`);
          row.querySelector("input").addEventListener("input", (e) => { w.bonuses[bi] = e.target.value; onChange(); });
          row.querySelector("button").addEventListener("click", () => { w.bonuses.splice(bi, 1); onChange(); drawBonuses(); });
          bonusWrap.appendChild(row);
        });
      };
      drawBonuses();
      card.querySelector("[data-bonus-add]").addEventListener("click", () => { w.bonuses.push(""); drawBonuses(); });
      card.querySelector("[data-del]").addEventListener("click", () => { m[key].splice(i, 1); onChange(); draw(); });
      list.appendChild(card);
    });
  };
  draw();
  wrap.querySelector("[data-add]").addEventListener("click", () => {
    m[key].push({ name: "", range: "", attacks: 1, toHit: "4+", toWound: "4+", rend: 0, damage: "1", bonuses: [] });
    draw();
  });
}

// ---------- Enhancement ----------
// actions: [{label, danger?, onClick}] — set-up geeft deel/verwijder-knoppen mee,
// het database-scherm opslaan/annuleren.
export function buildEnhancementEditor({ enh, el, esc, onChange = () => {}, actions = [] }) {
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
    <div class="btnrow" data-actions></div>
  </div>`);

  card.querySelector('[data-f="name"]').addEventListener("input", (e) => { enh.name = e.target.value; onChange(); });
  card.querySelector('[data-f="description"]').addEventListener("input", (e) => { enh.description = e.target.value; onChange(); });
  card.querySelector('[data-f="once"]').addEventListener("change", (e) => { enh.oncePerBattle = e.target.checked; onChange(); });
  const forTypeSel = card.querySelector('[data-f="forType"]');
  if (forTypeSel) forTypeSel.addEventListener("change", () => { enh.forType = forTypeSel.value; onChange(); });

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
        onChange();
        drawMods();
      });
      row.querySelector("[data-val]").addEventListener("change", (e) => { mod.value = e.target.value; onChange(); });
      row.querySelector("button.danger").addEventListener("click", () => { enh.statMods.splice(i, 1); onChange(); drawMods(); });
      modsWrap.appendChild(row);
    });
  };
  drawMods();
  card.querySelector("[data-mod-add]").addEventListener("click", () => {
    enh.statMods = enh.statMods || [];
    enh.statMods.push({ stat: "save", value: 1 });
    onChange();
    drawMods();
  });

  buildPhaseChips(card.querySelector("[data-chips]"), enh, el, onChange);
  buildActions(card.querySelector("[data-actions]"), actions, el);
  return card;
}

// ---------- Rule (faction/subfaction) ----------
export function buildRuleEditor({ rule, el, esc, onChange = () => {}, actions = [] }) {
  const card = el(`<div class="card inner">
    <label>Naam rule</label>
    <input type="text" data-f="name" value="${esc(rule.name)}" />
    <label>Phases (meerdere mogelijk)</label>
    <div class="chips" data-chips></div>
    <label>Beschrijving</label>
    <textarea data-f="description">${esc(rule.description)}</textarea>
    <div class="checkline"><input type="checkbox" data-f="once" ${rule.oncePerBattle ? "checked" : ""} /><span>Once per battle</span></div>
    <div class="btnrow" data-actions></div>
  </div>`);
  card.querySelector('[data-f="name"]').addEventListener("input", (e) => { rule.name = e.target.value; onChange(); });
  card.querySelector('[data-f="description"]').addEventListener("input", (e) => { rule.description = e.target.value; onChange(); });
  card.querySelector('[data-f="once"]').addEventListener("change", (e) => { rule.oncePerBattle = e.target.checked; onChange(); });
  buildPhaseChips(card.querySelector("[data-chips]"), rule, el, onChange);
  buildActions(card.querySelector("[data-actions]"), actions, el);
  return card;
}

// ---------- Gedeelde bouwstenen ----------
function buildPhaseChips(target, obj, el, onChange) {
  for (const opt of PHASE_OPTIONS) {
    const chip = el(`<span class="chip ${obj.phases.includes(opt.key) ? "active" : ""}">${opt.label}</span>`);
    chip.addEventListener("click", () => {
      if (obj.phases.includes(opt.key)) obj.phases = obj.phases.filter((p) => p !== opt.key);
      else obj.phases.push(opt.key);
      chip.classList.toggle("active");
      onChange();
    });
    target.appendChild(chip);
  }
}

function buildActions(target, actions, el) {
  for (const a of actions) {
    const btn = el(`<button class="small ${a.danger ? "danger" : ""} ${a.primary ? "primary" : ""}">${a.label}</button>`);
    btn.addEventListener("click", a.onClick);
    target.appendChild(btn);
  }
}
