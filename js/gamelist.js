import { icon } from "./icons.js";

// Momentopname van de legerlijst zoals die in één game gespeeld werd. Een leger
// blijft dezelfde naam houden terwijl de lijst zich ontwikkelt, dus zonder zo'n
// snapshot is achteraf niet meer te zien wat je toen precies speelde. Vandaar dat
// elk archief-record er sinds september 2026 eentje meedraagt (`rec.list`).
//
// Alles hier is puur: bouwen, vergelijken en één stukje weergave dat het archief
// en de statistieken allebei gebruiken.

const FREE_TYPES = new Set(["Manifestation", "Faction terrain"]);
const enhPoints = (m) => (m.enhancements || []).reduce((s, e) => s + (parseInt(e.points) || 0), 0);
const unitPoints = (m) =>
  (m.type === "Manifestation" || m.inRoR) ? 0 : (parseInt(m.points) || 0) * (m.reinforced ? 2 : 1) + enhPoints(m);

// Eén regel per unit, met alles wat een lijst van een andere versie onderscheidt.
function unitEntry(m) {
  return {
    name: m.name || "",
    type: m.type || "",
    points: unitPoints(m),
    reinforced: !!m.reinforced,
    general: !!m.isGeneral,
    inRoR: !!m.inRoR,
    enhancements: (m.enhancements || []).map((e) => e.name).filter(Boolean).sort(),
  };
}

export function buildListSnapshot(army) {
  if (!army) return null;
  const units = (army.models || []).map(unitEntry).sort((a, b) => a.name.localeCompare(b.name));
  const ror = (army.regiments || [])
    .filter((r) => r.ror)
    .map((r) => ({ name: r.ror.name || "", points: parseInt(r.ror.points) || 0 }));
  const lore = (l) => (l && l.name ? l.name : "");
  const points =
    units.reduce((s, u) => s + u.points, 0) +
    ror.reduce((s, r) => s + r.points, 0) +
    (parseInt(army.subfactionPoints) || 0) +
    ["spellLore", "manifestationLore", "prayerLore"].reduce((s, k) => s + (parseInt(army[k]?.points) || 0), 0);

  const snap = {
    army: army.name || "",
    faction: army.faction || "",
    subfaction: army.subfaction || "",
    points,
    units,
    ror,
    lores: {
      spell: lore(army.spellLore),
      manifestation: lore(army.manifestationLore),
      prayer: lore(army.prayerLore),
    },
  };
  snap.fingerprint = fingerprint(snap);
  return snap;
}

// Twee lijsten zijn "dezelfde versie" als deze tekst gelijk is. Bewust op inhoud
// en niet op een datum: twee potjes op dezelfde avond met dezelfde lijst horen bij
// elkaar, ook al ligt er een week tussen.
export function fingerprint(snap) {
  if (!snap) return "";
  const units = (snap.units || [])
    .map((u) => [u.name, u.points, u.reinforced ? "R" : "", u.general ? "G" : "", (u.enhancements || []).join("+")].join("~"))
    .sort()
    .join("|");
  const ror = (snap.ror || []).map((r) => r.name).sort().join("|");
  const l = snap.lores || {};
  return [snap.subfaction, units, ror, l.spell, l.manifestation, l.prayer].join("#");
}

// Wat is er veranderd tussen twee lijstversies? Units met dezelfde naam worden
// vergeleken op punten, reinforced, general en enhancements.
export function diffLists(oldSnap, newSnap) {
  const out = { added: [], removed: [], changed: [], meta: [] };
  if (!oldSnap || !newSnap) return out;
  const byName = (list) => new Map((list || []).map((u) => [u.name, u]));
  const a = byName(oldSnap.units), b = byName(newSnap.units);

  for (const [name, u] of b) if (!a.has(name)) out.added.push(u);
  for (const [name, u] of a) if (!b.has(name)) out.removed.push(u);
  for (const [name, u] of b) {
    const prev = a.get(name);
    if (!prev) continue;
    const notes = [];
    if (prev.reinforced !== u.reinforced) notes.push(u.reinforced ? "reinforced" : "niet meer reinforced");
    if (prev.general !== u.general) notes.push(u.general ? "nu general" : "niet meer general");
    const gone = prev.enhancements.filter((e) => !u.enhancements.includes(e));
    const got = u.enhancements.filter((e) => !prev.enhancements.includes(e));
    for (const e of got) notes.push(`+ ${e}`);
    for (const e of gone) notes.push(`− ${e}`);
    if (notes.length) out.changed.push({ name, notes });
  }

  if (oldSnap.subfaction !== newSnap.subfaction) {
    out.meta.push(`Subfaction: ${oldSnap.subfaction || "geen"} → ${newSnap.subfaction || "geen"}`);
  }
  for (const [key, label] of [["spell", "Spell lore"], ["manifestation", "Manifestation lore"], ["prayer", "Prayer lore"]]) {
    const o = oldSnap.lores?.[key] || "", n = newSnap.lores?.[key] || "";
    if (o !== n) out.meta.push(`${label}: ${o || "geen"} → ${n || "geen"}`);
  }
  const oRor = (oldSnap.ror || []).map((r) => r.name).join(", ");
  const nRor = (newSnap.ror || []).map((r) => r.name).join(", ");
  if (oRor !== nRor) out.meta.push(`Regiment of Renown: ${oRor || "geen"} → ${nRor || "geen"}`);
  if (oldSnap.points !== newSnap.points) out.meta.push(`Punten: ${oldSnap.points} → ${newSnap.points}`);
  return out;
}

export const hasChanges = (d) => !!(d && (d.added.length || d.removed.length || d.changed.length || d.meta.length));

// ---------- weergave (gedeeld door archief en statistieken) ----------
export function listBlock(snap, { el, esc }) {
  const wrap = el(`<div class="listsnap"></div>`);
  if (!snap) {
    wrap.appendChild(el(`<p class="empty">Bij deze game is de lijst nog niet vastgelegd (van vóór die feature).</p>`));
    return wrap;
  }
  wrap.appendChild(el(`<p class="subtitle">${esc(snap.faction)}${snap.subfaction ? " — " + esc(snap.subfaction) : ""} · ${snap.points} punten</p>`));
  const paid = (snap.units || []).filter((u) => !FREE_TYPES.has(u.type));
  const free = (snap.units || []).filter((u) => FREE_TYPES.has(u.type));
  const row = (u) => el(`<div class="listsnap-row">
    <span>${u.general ? icon("star") + " " : ""}${esc(u.name)}${u.reinforced ? ' <span class="chip tag">reinforced</span>' : ""}${u.inRoR ? ' <span class="chip tag">RoR</span>' : ""}
      ${(u.enhancements || []).length ? `<div class="subtitle">${esc(u.enhancements.join(", "))}</div>` : ""}</span>
    <span class="listsnap-pts">${u.points || ""}</span>
  </div>`);
  for (const u of paid) wrap.appendChild(row(u));
  for (const r of snap.ror || []) {
    wrap.appendChild(el(`<div class="listsnap-row"><span>${icon("star")} ${esc(r.name)} <span class="chip tag">RoR</span></span><span class="listsnap-pts">${r.points}</span></div>`));
  }
  for (const u of free) wrap.appendChild(row(u));
  const l = snap.lores || {};
  const lores = [["Spell lore", l.spell], ["Manifestation lore", l.manifestation], ["Prayer lore", l.prayer]].filter(([, v]) => v);
  if (lores.length) {
    wrap.appendChild(el(`<p class="subtitle">${lores.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ")}</p>`));
  }
  return wrap;
}

export function diffBlock(diff, { el, esc }) {
  const wrap = el(`<div class="listsnap"></div>`);
  if (!hasChanges(diff)) {
    wrap.appendChild(el(`<p class="subtitle">Zelfde lijst als de vorige game met dit leger.</p>`));
    return wrap;
  }
  const line = (cls, text) => wrap.appendChild(el(`<div class="listsnap-diff ${cls}">${text}</div>`));
  for (const u of diff.added) line("plus", `+ ${esc(u.name)}${u.points ? ` <span class="subtitle">${u.points} pts</span>` : ""}`);
  for (const u of diff.removed) line("minus", `− ${esc(u.name)}${u.points ? ` <span class="subtitle">${u.points} pts</span>` : ""}`);
  for (const c of diff.changed) line("change", `${esc(c.name)}: ${esc(c.notes.join(", "))}`);
  for (const m of diff.meta) line("change", esc(m));
  return wrap;
}
