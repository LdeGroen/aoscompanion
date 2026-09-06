import { effectiveModel } from "./enhancements.js";
import { filterWeapons } from "./weaponoptions.js";
import { openModal } from "./modelview.js";
import { weaponDamage, avgDice, num } from "./damagemath.js";
import { icon } from "./icons.js";

// Gemiddelde-schadecalculator: koppel één van je eigen units aan één unit van je
// tegenstander en zie hoeveel schade er gemiddeld doorheen komt. Save en ward
// komen uit het gekozen doelwit, dus die hoef je niet op te zoeken.
//
// Het rekenwerk zit in damagemath.js; hier staat alleen de bediening. Keuzes
// blijven binnen een potje bewaard (`game.dmgCalc`), zodat je na het sluiten van
// de popup niet alles opnieuw hoeft te zetten.

const STEPPERS = [
  ["hitBonus", "to hit", -2, 3],
  ["woundBonus", "to wound", -2, 3],
  ["rendBonus", "rend", 0, 3],
  ["damageBonus", "damage", 0, 4],
  ["attacksBonus", "attacks", 0, 6],
];

const REROLLS = [["none", "geen"], ["ones", "1-en"], ["fails", "alles"]];
const CRITS = [
  ["none", "geen"],
  ["hits2", "2 hits"],
  ["autowound", "auto-wound"],
  ["mortal", "mortal"],
];

const fmt = (n, dec = 2) => (Number.isFinite(n) ? n.toFixed(dec).replace(".", ",") : "–");

function defaults() {
  return {
    attackerId: "",
    targetName: "",
    manualSave: "4+",
    manualWard: "",
    scope: "both",        // ranged | melee | both
    off: {},              // wapennaam -> uitgezet (true) — standaard staat alles aan
    counts: {},           // wapennaam -> aantal modellen
    hitBonus: 0, woundBonus: 0, rendBonus: 0, damageBonus: 0, attacksBonus: 0,
    rerollHits: "none", rerollWounds: "none", crit: "none",
    saveMod: 0, rerollSaves: "none", noSave: false, wardOverride: "",
  };
}

export function openDamageCalculator({ army, game, el, esc, saveData }) {
  game.dmgCalc = { ...defaults(), ...(game.dmgCalc || {}) };
  const s = game.dmgCalc;

  const myModels = (army.models || []).filter((m) => m.type !== "Manifestation" || true);
  const enemies = (game.opponent?.models || []);

  if (!myModels.length) {
    openModal(el(`<div><h2>Gemiddelde schade</h2><p class="empty">Dit leger heeft nog geen units.</p></div>`), el);
    return;
  }
  if (!s.attackerId || !myModels.some((m) => m.id === s.attackerId)) s.attackerId = myModels[0].id;
  if (s.targetName && !enemies.some((m) => m.name === s.targetName)) s.targetName = "";

  const wrap = el(`<div class="dmg">
    <h2>${icon("dice", 20)} Gemiddelde schade</h2>
    <p class="subtitle">Kies je unit en het doelwit; save en ward komen uit dat doelwit.</p>

    <label>Jouw unit</label>
    <select data-attacker></select>

    <label>Doelwit</label>
    <select data-target></select>
    <div data-manual style="display:none">
      <div class="dmg-row">
        <span><label>Save</label><select data-save></select></span>
        <span><label>Ward</label><select data-ward></select></span>
      </div>
    </div>
    <div class="chips" data-targetinfo></div>

    <label>Wat telt mee</label>
    <div class="chips" data-scope></div>
    <div data-weapons></div>

    <details class="type-group" data-buffs>
      <summary>Buffs op je unit <span class="count" data-buffcount></span></summary>
      <div data-buffbody></div>
    </details>

    <details class="type-group" data-def>
      <summary>Aanpassingen bij het doelwit <span class="count" data-defcount></span></summary>
      <div data-defbody></div>
    </details>

    <div data-result></div>
  </div>`);

  // ---------- keuzelijsten ----------
  const attackerSel = wrap.querySelector("[data-attacker]");
  for (const m of myModels) {
    attackerSel.appendChild(el(`<option value="${esc(m.id)}"${m.id === s.attackerId ? " selected" : ""}>${esc(m.name)}</option>`));
  }
  const targetSel = wrap.querySelector("[data-target]");
  targetSel.appendChild(el(`<option value=""${s.targetName ? "" : " selected"}>— zelf save/ward invullen —</option>`));
  for (const m of enemies) {
    targetSel.appendChild(el(`<option value="${esc(m.name)}"${m.name === s.targetName ? " selected" : ""}>${esc(m.name)}</option>`));
  }
  const saveSel = wrap.querySelector("[data-save]");
  for (const v of ["2+", "3+", "4+", "5+", "6+", ""]) {
    saveSel.appendChild(el(`<option value="${v}"${v === s.manualSave ? " selected" : ""}>${v || "geen save"}</option>`));
  }
  const wardSel = wrap.querySelector("[data-ward]");
  for (const v of ["", "4+", "5+", "6+"]) {
    wardSel.appendChild(el(`<option value="${v}"${v === s.manualWard ? " selected" : ""}>${v || "geen ward"}</option>`));
  }

  const attacker = () => myModels.find((m) => m.id === s.attackerId) || myModels[0];
  const targetModel = () => enemies.find((m) => m.name === s.targetName) || null;
  const target = () => {
    const t = targetModel();
    return t ? { save: t.save, ward: t.ward, health: t.health, name: t.name }
             : { save: s.manualSave, ward: s.manualWard, health: 0, name: "doelwit" };
  };

  // Wapens van de gekozen unit, met enhancements verwerkt en weapon-options gefilterd.
  function weapons() {
    const m = attacker();
    const M = effectiveModel(army, m).model;
    const ranged = filterWeapons(M.rangedAttacks || [], m).map((w) => ({ ...w, kind: "ranged" }));
    const melee = filterWeapons(M.meleeAttacks || [], m).map((w) => ({ ...w, kind: "melee" }));
    const all = s.scope === "ranged" ? ranged : s.scope === "melee" ? melee : [...ranged, ...melee];
    return all;
  }
  const isOn = (w) => !s.off[w.kind + "|" + w.name];
  const countOf = (w) => Math.max(1, Number(s.counts[w.kind + "|" + w.name]) || 1);

  const persist = () => { try { saveData && saveData(); } catch { /* niet kritiek */ } };

  // ---------- bouwstenen ----------
  function stepper(key, label, min, max, onChange) {
    const box = el(`<span class="dmg-step">
      <button class="small" data-m>−</button>
      <span class="v" data-v>${s[key] > 0 ? "+" : ""}${s[key]}</span>
      <span class="k">${esc(label)}</span>
      <button class="small" data-p>+</button>
    </span>`);
    const paint = () => { box.querySelector("[data-v]").textContent = (s[key] > 0 ? "+" : "") + s[key]; };
    box.querySelector("[data-m]").addEventListener("click", () => { s[key] = Math.max(min, s[key] - 1); paint(); onChange(); });
    box.querySelector("[data-p]").addEventListener("click", () => { s[key] = Math.min(max, s[key] + 1); paint(); onChange(); });
    return box;
  }

  function picker(key, label, options, onChange) {
    const box = el(`<span class="dmg-pick"><span class="k">${esc(label)}</span><span class="chips" data-opts></span></span>`);
    const opts = box.querySelector("[data-opts]");
    for (const [value, text] of options) {
      const chip = el(`<button class="chip${s[key] === value ? " active" : ""}">${esc(text)}</button>`);
      chip.addEventListener("click", () => {
        s[key] = value;
        opts.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        onChange();
      });
      opts.appendChild(chip);
    }
    return box;
  }

  // ---------- tekenen ----------
  const scopeBox = wrap.querySelector("[data-scope]");
  for (const [key, label] of [["ranged", "Shooting"], ["melee", "Combat"], ["both", "Allebei"]]) {
    const chip = el(`<button class="chip${s.scope === key ? " active" : ""}">${esc(label)}</button>`);
    chip.addEventListener("click", () => {
      s.scope = key;
      scopeBox.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      drawWeapons();
      recalc();
    });
    scopeBox.appendChild(chip);
  }

  const weaponBox = wrap.querySelector("[data-weapons]");
  function drawWeapons() {
    weaponBox.innerHTML = "";
    const list = weapons();
    if (!list.length) {
      weaponBox.appendChild(el(`<p class="empty">Deze unit heeft geen ${s.scope === "ranged" ? "ranged attacks" : s.scope === "melee" ? "melee attacks" : "wapens"}.</p>`));
      return;
    }
    for (const w of list) {
      const key = w.kind + "|" + w.name;
      const row = el(`<div class="dmg-weapon">
        <label class="dmg-check">
          <input type="checkbox"${isOn(w) ? " checked" : ""} />
          <span>
            <strong>${esc(w.name)}</strong>
            <span class="chip tag">${w.kind === "ranged" ? "shooting" : "combat"}</span>
            <div class="subtitle">${esc(w.attacks)} attacks · ${esc(w.toHit)} hit · ${esc(w.toWound)} wound · rend ${esc(String(w.rend ?? 0))} · ${esc(w.damage)} damage</div>
          </span>
        </label>
        <span class="dmg-count">×<input type="number" min="1" max="60" value="${countOf(w)}" /> modellen</span>
      </div>`);
      row.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
        if (e.currentTarget.checked) delete s.off[key]; else s.off[key] = true;
        recalc();
      });
      row.querySelector('input[type="number"]').addEventListener("input", (e) => {
        s.counts[key] = Math.max(1, Number(e.currentTarget.value) || 1);
        recalc();
      });
      weaponBox.appendChild(row);
    }
  }

  const buffBody = wrap.querySelector("[data-buffbody]");
  const stepRow = el(`<div class="dmg-steps"></div>`);
  for (const [key, label, min, max] of STEPPERS) stepRow.appendChild(stepper(key, label, min, max, () => recalc()));
  buffBody.appendChild(stepRow);
  buffBody.appendChild(picker("rerollHits", "Hits herwerpen", REROLLS, () => recalc()));
  buffBody.appendChild(picker("rerollWounds", "Wounds herwerpen", REROLLS, () => recalc()));
  buffBody.appendChild(picker("crit", "Critical hits (ongewijzigde 6)", CRITS, () => recalc()));
  buffBody.appendChild(el(`<p class="subtitle">Crit (2 hits) geeft per 6 een extra hit; crit (mortal) slaat wound én save over, alleen een ward houdt die schade nog tegen.</p>`));

  const defBody = wrap.querySelector("[data-defbody]");
  const defSteps = el(`<div class="dmg-steps"></div>`);
  defSteps.appendChild(stepper("saveMod", "save van het doelwit", -2, 2, () => recalc()));
  defBody.appendChild(defSteps);
  defBody.appendChild(picker("rerollSaves", "Doelwit herwerpt saves", REROLLS, () => recalc()));
  const wardBox = el(`<span class="dmg-pick"><span class="k">Ward overschrijven</span><span class="chips" data-w></span></span>`);
  for (const [value, text] of [["", "uit het kaartje"], ["6+", "6+"], ["5+", "5+"], ["4+", "4+"]]) {
    const chip = el(`<button class="chip${s.wardOverride === value ? " active" : ""}">${esc(text)}</button>`);
    chip.addEventListener("click", () => {
      s.wardOverride = value;
      wardBox.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      recalc();
    });
    wardBox.querySelector("[data-w]").appendChild(chip);
  }
  defBody.appendChild(wardBox);
  const noSave = el(`<label class="dmg-check"><input type="checkbox"${s.noSave ? " checked" : ""} /><span>Doelwit mag geen save gooien</span></label>`);
  noSave.querySelector("input").addEventListener("change", (e) => { s.noSave = e.currentTarget.checked; recalc(); });
  defBody.appendChild(noSave);

  const manualBox = wrap.querySelector("[data-manual]");
  const infoBox = wrap.querySelector("[data-targetinfo]");
  const resultBox = wrap.querySelector("[data-result]");

  function drawTargetInfo() {
    const t = target();
    manualBox.style.display = targetModel() ? "none" : "";
    infoBox.innerHTML = "";
    if (targetModel()) {
      infoBox.appendChild(el(`<span class="chip tag">Save ${esc(t.save || "geen")}</span>`));
      infoBox.appendChild(el(`<span class="chip tag">Ward ${esc(t.ward || "geen")}</span>`));
      if (t.health) infoBox.appendChild(el(`<span class="chip tag">Health ${esc(String(t.health))}</span>`));
    }
  }

  // Aantal actieve buffs in de samenvatting van de uitklap, zodat je ziet dat er
  // iets aanstaat als het paneel dicht is.
  function paintCounts() {
    const buffs = STEPPERS.filter(([k]) => s[k] !== 0).length
      + (s.rerollHits !== "none" ? 1 : 0) + (s.rerollWounds !== "none" ? 1 : 0) + (s.crit !== "none" ? 1 : 0);
    const defs = (s.saveMod !== 0 ? 1 : 0) + (s.rerollSaves !== "none" ? 1 : 0) + (s.noSave ? 1 : 0) + (s.wardOverride ? 1 : 0);
    wrap.querySelector("[data-buffcount]").textContent = buffs ? `(${buffs} aan)` : "";
    wrap.querySelector("[data-defcount]").textContent = defs ? `(${defs} aan)` : "";
  }

  function recalc() {
    drawTargetInfo();
    paintCounts();
    persist();

    const t = target();
    const list = weapons().filter(isOn);
    const rows = list.map((w) => ({
      w,
      r: weaponDamage(w, t, {
        models: countOf(w),
        attacksBonus: s.attacksBonus,
        hitBonus: s.hitBonus,
        woundBonus: s.woundBonus,
        rendBonus: s.rendBonus,
        damageBonus: s.damageBonus,
        rerollHits: s.rerollHits,
        rerollWounds: s.rerollWounds,
        crit: s.crit,
        saveMod: s.saveMod,
        rerollSaves: s.rerollSaves,
        noSave: s.noSave,
        wardOverride: s.wardOverride,
      }),
    }));
    const total = rows.reduce((a, x) => a + (x.r.unknown ? 0 : x.r.damage), 0);
    const unknown = rows.filter((x) => x.r.unknown);
    const health = num(t.health);
    const kills = health > 0 ? total / health : 0;

    resultBox.innerHTML = "";
    if (!rows.length) {
      resultBox.appendChild(el(`<p class="empty">Vink minstens één wapen aan.</p>`));
      return;
    }
    resultBox.appendChild(el(`<div class="dmg-total">
      <span class="v">${fmt(total, 1)}</span>
      <span class="k">gemiddelde schade op ${esc(t.name)}</span>
      ${health > 0 ? `<span class="sub">≈ ${fmt(kills, 1)} model${kills >= 2 ? "len" : ""} (health ${health})</span>` : ""}
    </div>`));

    const table = el(`<table class="statgrid">
      <thead><tr><th>Wapen</th><th class="num">Attacks</th><th class="num">Hits</th><th class="num">Wounds</th><th class="num">Door de save</th><th class="num">Schade</th></tr></thead>
      <tbody></tbody>
    </table>`);
    const tb = table.querySelector("tbody");
    for (const { w, r } of rows) {
      if (r.unknown) {
        tb.appendChild(el(`<tr><td>${esc(w.name)}</td><td class="num" colspan="5">staat als tekst op het kaartje — niet te berekenen</td></tr>`));
        continue;
      }
      tb.appendChild(el(`<tr>
        <td>${esc(w.name)}${countOf(w) > 1 ? ` <span class="subtitle">×${countOf(w)}</span>` : ""}</td>
        <td class="num">${fmt(r.attacks, 1)}</td>
        <td class="num">${fmt(r.hits)}</td>
        <td class="num">${fmt(r.wounds)}</td>
        <td class="num">${fmt(r.unsaved)}</td>
        <td class="num"><strong>${fmt(r.damage)}</strong></td>
      </tr>`));
    }
    resultBox.appendChild(table);
    if (unknown.length) {
      resultBox.appendChild(el(`<p class="subtitle">${unknown.length} wapen(s) hebben een damage- of wound-waarde die naar een ability verwijst; die tellen niet mee.</p>`));
    }
    const mortal = rows.reduce((a, x) => a + (x.r.mortalDamage || 0), 0);
    if (mortal > 0.001) {
      resultBox.appendChild(el(`<p class="subtitle">Waarvan ${fmt(mortal)} uit critical hits (mortal damage).</p>`));
    }
  }

  attackerSel.addEventListener("change", (e) => { s.attackerId = e.currentTarget.value; drawWeapons(); recalc(); });
  targetSel.addEventListener("change", (e) => { s.targetName = e.currentTarget.value; recalc(); });
  saveSel.addEventListener("change", (e) => { s.manualSave = e.currentTarget.value; recalc(); });
  wardSel.addEventListener("change", (e) => { s.manualWard = e.currentTarget.value; recalc(); });

  drawWeapons();
  recalc();
  openModal(wrap, el);
}
