import { icon } from "./icons.js";
import { loadoutSummary } from "./weaponoptions.js";

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
    loadout: loadoutSummary(m) || "",
    enhancements: (m.enhancements || []).map((e) => e.name).filter(Boolean).sort(),
  };
}

// De lijst opgedeeld zoals je hem exporteert: General's Regiment eerst, dan de
// overige regiments, Auxiliary Units, Regiments of Renown en Faction Terrain.
// Zo lees je in het archief precies wat er op tafel stond.
function buildGroups(army) {
  const models = army.models || [];
  const groups = [];
  const generalRid = (models.find((m) => m.isGeneral) || {}).regimentId;
  const regs = (army.regiments || [])
    .filter((r) => !r.ror)
    .sort((a, b) => (a.id === generalRid ? -1 : 0) - (b.id === generalRid ? -1 : 0));

  let regNo = 0;
  for (const reg of regs) {
    const inReg = models.filter((m) => m.regimentId === reg.id);
    if (!inReg.length) continue;
    const ordered = [...inReg.filter((m) => m.isLeader), ...inReg.filter((m) => !m.isLeader)];
    groups.push({
      title: reg.id === generalRid ? "General's Regiment" : `Regiment ${++regNo}`,
      units: ordered.map(unitEntry),
    });
  }

  const aux = models.filter((m) => !m.regimentId && !m.isLeader && !FREE_TYPES.has(m.type) && !m.fromTerrain);
  if (aux.length) groups.push({ title: "Auxiliary Units", units: aux.map(unitEntry) });

  for (const reg of (army.regiments || []).filter((r) => r.ror)) {
    groups.push({
      title: "Regiment of Renown",
      ror: { name: reg.ror.name || "", points: parseInt(reg.ror.points) || 0 },
      units: models.filter((m) => m.regimentId === reg.id).map(unitEntry),
    });
  }

  const terrain = models.filter((m) => m.type === "Faction terrain");
  if (terrain.length) groups.push({ title: "Faction Terrain", units: terrain.map(unitEntry) });

  const manifest = models.filter((m) => m.type === "Manifestation");
  if (manifest.length) groups.push({ title: "Manifestations", units: manifest.map(unitEntry) });

  return groups;
}

// Aantal drops, net als in de export: elk regiment (incl. RoR) plus elke losse
// auxiliary unit.
function dropCount(army) {
  const models = army.models || [];
  const aux = models.filter((m) => !m.regimentId && !m.isLeader && !FREE_TYPES.has(m.type) && !m.fromTerrain).length;
  return (army.regiments || []).length + aux;
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
    formation: army.aor || army.subfaction || "",
    drops: dropCount(army),
    points,
    groups: buildGroups(army),
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
    .map((u) => [u.name, u.points, u.reinforced ? "R" : "", u.general ? "G" : "", (u.enhancements || []).join("+"), u.loadout || ""].join("~"))
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
    if ((prev.loadout || "") !== (u.loadout || "")) notes.push(`wapens: ${prev.loadout || "standaard"} → ${u.loadout || "standaard"}`);
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
// Zelfde indeling als "Lijst exporteren" in de set-up: per regiment, met de leider
// bovenaan en de details eronder. Oudere momentopnames hebben nog geen `groups`;
// die vallen terug op één platte lijst.
export function listBlock(snap, { el, esc }) {
  const wrap = el(`<div class="listsnap"></div>`);
  if (!snap) {
    wrap.appendChild(el(`<p class="empty">Bij deze game is de lijst nog niet vastgelegd (van vóór die feature).</p>`));
    return wrap;
  }

  const head = [snap.faction, snap.formation || snap.subfaction].filter(Boolean).map(esc).join(" — ");
  wrap.appendChild(el(`<p class="subtitle">${head}${head ? " · " : ""}${snap.points} punten${snap.drops ? ` · ${snap.drops} drops` : ""}</p>`));

  const unitRow = (u) => {
    const bits = [];
    if (u.general) bits.push("General");
    if (u.reinforced) bits.push("Reinforced");
    for (const e of u.enhancements || []) bits.push(e);
    if (u.loadout) bits.push(u.loadout);
    return el(`<div class="listsnap-row">
      <span>${u.general ? icon("star") + " " : ""}${esc(u.name)}
        ${bits.length ? `<div class="subtitle">${bits.map(esc).join(" · ")}</div>` : ""}</span>
      <span class="listsnap-pts">${u.points || ""}</span>
    </div>`);
  };

  if ((snap.groups || []).length) {
    for (const g of snap.groups) {
      wrap.appendChild(el(`<div class="listsnap-group">${esc(g.title)}${g.ror ? ` — ${esc(g.ror.name)} <span class="listsnap-pts">${g.ror.points}</span>` : ""}</div>`));
      for (const u of g.units || []) wrap.appendChild(unitRow(u));
    }
  } else {
    // Oud formaat: geen regiment-indeling bekend.
    for (const u of snap.units || []) wrap.appendChild(unitRow(u));
    for (const r of snap.ror || []) {
      wrap.appendChild(el(`<div class="listsnap-row"><span>${icon("star")} ${esc(r.name)} <span class="chip tag">RoR</span></span><span class="listsnap-pts">${r.points}</span></div>`));
    }
  }

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
