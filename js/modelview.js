import { enhancementCategoryLabel } from "./factions.js";
import { abilityBodyHtml } from "./abilityview.js";
import { effectiveModel, modLabel } from "./enhancements.js";
import { filterWeapons } from "./weaponoptions.js";
import { icon } from "./icons.js";

// Gedeelde model-popup: companion mode én de database tonen hetzelfde overzicht
// van alle informatie over één model. In companion worden de enhancements van
// het leger live verwerkt (✦); in de database staan de kaartjes los, dus dan
// is er niets om te verwerken en zie je de ruwe stats.

// Weapon abilities (Crit (2 Hits), Anti-Infantry (+1 Rend), Charge (+1 Damage)…)
// zijn net zo belangrijk als de getallen ernaast, dus staan ze als chip ín de rij
// in plaats van als voetnoot onder de tabel. Eén veld kan er meerdere bevatten
// ("Charge (+1 Damage), Companion"); we splitsen op komma's buiten de haakjes.
export function weaponAbilities(bonuses) {
  const out = [];
  for (const raw of bonuses || []) {
    for (const part of String(raw || "").split(/,\s*(?![^()]*\))/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

// Kleur per soort: crits rood (die doen het werk), anti-X violet (voorwaardelijk),
// charge oranje en shoot amber — dezelfde kleuren als de fases elders in de app.
export function weaponAbilityClass(text) {
  const t = String(text || "").toLowerCase();
  if (t.startsWith("crit")) return "wa-crit";
  if (t.startsWith("anti")) return "wa-anti";
  if (t.startsWith("charge")) return "wa-charge";
  if (t.includes("shoot in combat")) return "wa-shoot";
  if (t.startsWith("companion")) return "wa-companion";
  return "wa-other";
}

function weaponAbilityChips(w, esc) {
  const list = weaponAbilities(w.bonuses);
  if (!list.length) return "";
  return `<div class="wa-chips">${list
    .map((b) => `<span class="wa ${weaponAbilityClass(b)}">${esc(b)}</span>`)
    .join("")}</div>`;
}

export function weaponTable(weapons, el, esc, toHitTransform, kind = "") {
  const wrap = el(`<div class="weapons-wrap"></div>`);
  const hasRange = weapons.some((w) => w.range);
  const table = el(`<table class="weapons ${kind}">
    <tr><th>Wapen</th>${hasRange ? "<th>Range</th>" : ""}<th>Atk</th><th>Hit</th><th>Wnd</th><th>Rend</th><th>Dmg</th></tr>
  </table>`);
  for (const w of weapons) {
    const hit = toHitTransform ? toHitTransform(w.toHit) : w.toHit;
    const wname = (w.count ? `${w.count}× ` : "") + w.name;
    table.appendChild(el(`<tr>
      <td class="name">${esc(wname)}${weaponAbilityChips(w, esc)}</td>
      ${hasRange ? `<td>${esc(w.range || "")}"</td>` : ""}
      <td>${esc(w.attacks)}</td>
      <td>${esc(hit)}</td>
      <td>${esc(w.toWound)}</td>
      <td>${esc(w.rend)}</td>
      <td class="dmg">${esc(w.damage)}</td>
    </tr>`));
  }
  wrap.appendChild(table);
  return wrap;
}

export function openModal(contentEl, el) {
  const overlay = el(`<div class="modal-overlay"><div class="modal">
    <button class="small modal-close">✕</button>
    <div data-content></div>
  </div></div>`);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".modal-close").addEventListener("click", () => overlay.remove());
  overlay.querySelector("[data-content]").appendChild(contentEl);
  document.body.appendChild(overlay);
  return overlay;
}

// Bouwt de popup-inhoud (zonder de modal-wrapper) voor één model.
// opts.army: leger waaruit enhancements verwerkt worden (optioneel — zonder
//   army gewoon de ruwe stats, zoals in de database).
// opts.extraTag: extra statuslabel, bijv. "Uit de battle" / "Niet gesummend".
export function buildModelPopupContent(m, { el, esc, army = null, extraTag = "" } = {}) {
  const e = effectiveModel(army || { enhancements: [] }, m);
  const M = e.model;

  const tags = [];
  if (m.type) tags.push(m.type);
  if (m.type === "Manifestation" && m.universal) tags.push("Universal");
  if (m.fly) tags.push("Fly");
  if (m.wizardLevel > 0) tags.push(`Wizard (${m.wizardLevel})`);
  if (m.priestLevel > 0) tags.push(`Priest (${m.priestLevel})`);
  if (m.champion) tags.push("Champion");
  if (m.musician) tags.push("Musician");
  if (m.standardBearer) tags.push("Standard Bearer");
  if (extraTag) tags.push(extraTag);
  const isParagon = (m.keywords || []).some((k) => String(k).toLowerCase() === "paragon");

  const stat = (label, value, mark, extra = "") =>
    `<span class="stat ws ${extra}"><span class="v">${esc(value)}${mark ? "✦" : ""}</span><span class="k">${label}</span></span>`;
  const ward = M.ward && M.ward !== "-" ? M.ward : "";

  const wrap = el(`<div>
    <div class="ws-head">
      <h2>${esc(m.name)}</h2>
      ${(tags.length || isParagon || m.legends) ? `<div class="chips">${m.legends ? '<span class="chip legends">Legends</span>' : ""}${isParagon ? `<span class="chip paragon">${icon("star")} Paragon</span>` : ""}${tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    <div class="stats">
      ${stat("move", M.move + '"', e.changed.has("move"))}
      ${stat("health", M.health, e.changed.has("health"), "health")}
      ${stat("control", (parseInt(M.control) || 0) + (parseInt(m.controlBonus) || 0), e.changed.has("control"))}
      ${stat("save", M.save, e.changed.has("save"), "save")}
      ${ward ? stat("ward", ward, e.changed.has("ward"), "ward") : ""}
      ${m.banishment ? stat("banish", m.banishment, false) : ""}
    </div>
    <div data-body></div>
  </div>`);
  const body = wrap.querySelector("[data-body]");

  const ranged = filterWeapons(M.rangedAttacks || [], m);
  const melee = filterWeapons(M.meleeAttacks || [], m);
  if (ranged.length) {
    body.appendChild(el(`<div class="ws-section ranged">${icon("zap", 16)} Ranged attacks</div>`));
    body.appendChild(weaponTable(ranged, el, esc, null, "ranged"));
  }
  if (melee.length) {
    body.appendChild(el(`<div class="ws-section melee">${icon("sword", 16)} Melee attacks</div>`));
    body.appendChild(weaponTable(melee, el, esc, null, "melee"));
  }
  if ((m.abilities || []).length) {
    body.appendChild(el(`<div class="ws-section abilities">${icon("star", 16)} Abilities</div>`));
    for (const ab of m.abilities) {
      body.appendChild(el(`<div class="ability">
        <span class="aname">${esc(ab.name)}</span>
        ${ab.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}
        ${ab.isSpell ? `<span class="chip tag">Spell${ab.castingValue ? " " + esc(String(ab.castingValue)) : ""}</span>` : ""}
        ${abilityBodyHtml(ab, esc)}
      </div>`));
    }
  }
  if (e.enhancements.length) {
    body.appendChild(el(`<div class="ws-section enh">${icon("star", 16)} Enhancements</div>`));
    for (const enh of e.enhancements) {
      const mods = (enh.statMods || []).map(modLabel).join(", ");
      body.appendChild(el(`<div class="ability enhancement">
        <span class="aname">${esc(enh.name)}</span> <span class="asrc">— ${esc(enhancementCategoryLabel(enh.category))}</span>
        ${mods ? `<div class="subtitle">Stats: ${esc(mods)}</div>` : ""}
        ${abilityBodyHtml(enh, esc)}
      </div>`));
    }
  }
  // De keywords van de unit zelf onderaan — daar zoek je op bij regels als
  // "pick a friendly Skyfarer unit".
  if ((m.keywords || []).length) {
    body.appendChild(el(`<div class="ws-keywords">
      <div class="chips">${m.keywords.map((k) => `<span class="chip kw">${esc(k)}</span>`).join("")}</div>
    </div>`));
  }
  if (e.notes.length) {
    body.appendChild(el(`<div class="weapon-bonus">✦ = incl. enhancement (verwerkt in de getoonde stats)</div>`));
  }
  return wrap;
}
