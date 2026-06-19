import { phaseLabel, enhancementCategoryLabel } from "./factions.js";
import { effectiveModel, modLabel } from "./enhancements.js";
import { icon } from "./icons.js";

// Gedeelde model-popup: companion mode én de database tonen hetzelfde overzicht
// van alle informatie over één model. In companion worden de enhancements van
// het leger live verwerkt (✦); in de database staan de kaartjes los, dus dan
// is er niets om te verwerken en zie je de ruwe stats.

export function weaponTable(weapons, el, esc, toHitTransform) {
  const wrap = el(`<div></div>`);
  const hasRange = weapons.some((w) => w.range);
  const table = el(`<table class="weapons">
    <tr><th>Wapen</th>${hasRange ? "<th>Range</th>" : ""}<th>Atk</th><th>Hit</th><th>Wnd</th><th>Rend</th><th>Dmg</th></tr>
  </table>`);
  for (const w of weapons) {
    const hit = toHitTransform ? toHitTransform(w.toHit) : w.toHit;
    table.appendChild(el(`<tr>
      <td class="name">${esc(w.name)}</td>
      ${hasRange ? `<td>${esc(w.range || "")}"</td>` : ""}
      <td>${esc(w.attacks)}</td>
      <td>${esc(hit)}</td>
      <td>${esc(w.toWound)}</td>
      <td>${esc(w.rend)}</td>
      <td>${esc(w.damage)}</td>
    </tr>`));
  }
  wrap.appendChild(table);
  for (const w of weapons) {
    for (const b of (w.bonuses || []).filter(Boolean)) {
      wrap.appendChild(el(`<div class="weapon-bonus">✦ ${esc(w.name)}: ${esc(b)}</div>`));
    }
  }
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

  const stat = (label, value, mark) =>
    `<span class="stat"><span class="v">${esc(value)}${mark ? "✦" : ""}</span><span class="k">${label}</span></span>`;
  const ward = M.ward && M.ward !== "-" ? M.ward : "";

  const wrap = el(`<div>
    <h2>${esc(m.name)}</h2>
    ${(tags.length || isParagon) ? `<div class="chips">${isParagon ? `<span class="chip paragon">${icon("star")} Paragon</span>` : ""}${tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="stats">
      ${stat("move", M.move + '"', e.changed.has("move"))}
      ${stat("health", M.health, e.changed.has("health"))}
      ${stat("control", (parseInt(M.control) || 0) + (parseInt(m.controlBonus) || 0), e.changed.has("control"))}
      ${stat("save", M.save, e.changed.has("save"))}
      ${ward ? stat("ward", ward, e.changed.has("ward")) : ""}
      ${m.banishment ? stat("banish", m.banishment, false) : ""}
    </div>
    <div data-body></div>
  </div>`);
  const body = wrap.querySelector("[data-body]");

  if ((M.rangedAttacks || []).length) {
    body.appendChild(el(`<h3>Ranged attacks</h3>`));
    body.appendChild(weaponTable(M.rangedAttacks, el, esc));
  }
  if ((M.meleeAttacks || []).length) {
    body.appendChild(el(`<h3>Melee attacks</h3>`));
    body.appendChild(weaponTable(M.meleeAttacks, el, esc));
  }
  if ((m.abilities || []).length) {
    body.appendChild(el(`<h3>Abilities</h3>`));
    for (const ab of m.abilities) {
      body.appendChild(el(`<div class="ability">
        <span class="aname">${esc(ab.name)}</span>
        ${ab.oncePerBattle ? '<span class="chip tag">Once per battle</span>' : ""}
        <div class="subtitle">${(ab.phases || []).map((p) => esc(phaseLabel(p))).join(" · ")}</div>
        <div class="adesc">${esc(ab.description)}</div>
      </div>`));
    }
  }
  if (e.enhancements.length) {
    body.appendChild(el(`<h3>Enhancements</h3>`));
    for (const enh of e.enhancements) {
      const mods = (enh.statMods || []).map(modLabel).join(", ");
      body.appendChild(el(`<div class="ability enhancement">
        <span class="aname">${esc(enh.name)}</span> <span class="asrc">— ${esc(enhancementCategoryLabel(enh.category))}</span>
        ${mods ? `<div class="subtitle">Stats: ${esc(mods)}</div>` : ""}
        <div class="adesc">${esc(enh.description)}</div>
      </div>`));
    }
  }
  if (e.notes.length) {
    body.appendChild(el(`<div class="weapon-bonus">✦ = incl. enhancement (verwerkt in de getoonde stats)</div>`));
  }
  return wrap;
}
