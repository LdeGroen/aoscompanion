// Weapon options: een unit heeft een standaard-uitrusting en kan op X modellen
// een wapen vervangen door een ander. De opties komen uit BSData (zie
// ko-import/parse-weaponoptions.mjs) en staan op m.weaponOptions:
//   { name, type:'optional'|'grouped', max, replaces:[names], group, modelGroup, groupSize }
// De keuze van de speler staat op m.weaponLoadout = { [optionNaam]: aantal }.
//
// In de set-up kies je per optie hoeveel modellen het wapen pakken; in companion
// tonen we alleen de wapens die op de standaard-loadout staan of daadwerkelijk
// zijn gekozen (met aantallen).

export function hasWeaponOptions(m) {
  return Array.isArray(m && m.weaponOptions) && m.weaponOptions.length > 0;
}

// Sleutel waaronder opties in dezelfde keuzegroep vallen (modelgroep + group).
export function groupKey(opt) {
  return (opt.modelGroup || "") + "::" + (opt.group || "");
}

// Effectief maximum voor één optie (verdubbelt bij reinforced).
export function effectiveMax(opt, reinforced) {
  const base = parseInt(opt.max) || 0;
  return reinforced ? base * 2 : base;
}

// Totaalbudget voor een grouped-keuze (aantal modellen in de groep, ×2 reinforced).
export function groupBudget(opt, reinforced) {
  const base = parseInt(opt.groupSize || opt.max) || 1;
  return reinforced ? base * 2 : base;
}

// Hoeveel modellen hebben in deze grouped-keuze al een wapen gekozen (excl. zichzelf).
export function groupUsed(m, opt, exceptName) {
  const lo = m.weaponLoadout || {};
  let used = 0;
  for (const o of m.weaponOptions || []) {
    if (o.type !== "grouped" || groupKey(o) !== groupKey(opt)) continue;
    if (o.name === exceptName) continue;
    used += parseInt(lo[o.name]) || 0;
  }
  return used;
}

// Heeft de speler een loadout ingesteld? (zo niet: companion toont alles, zoals voorheen)
export function loadoutConfigured(m) {
  const lo = m.weaponLoadout || {};
  return Object.values(lo).some((v) => (parseInt(v) || 0) > 0);
}

// Korte samenvatting voor in de set-up ("Grandhammer ×1 · Skypike ×1").
export function loadoutSummary(m) {
  const lo = m.weaponLoadout || {};
  const parts = [];
  for (const o of m.weaponOptions || []) {
    const n = parseInt(lo[o.name]) || 0;
    if (n > 0) parts.push(`${o.name} ×${n}`);
  }
  return parts.join(" · ");
}

// Filtert + annoteert de wapenprofielen op basis van de gekozen loadout.
// Een profiel waarvan de naam een (niet-gekozen) optie is, wordt verborgen;
// gekozen opties krijgen een `count`. Default/basiswapens blijven altijd staan.
// Zonder ingestelde loadout blijft alles staan (achterwaarts compatibel).
export function filterWeapons(weapons, m) {
  if (!hasWeaponOptions(m) || !loadoutConfigured(m)) return weapons;
  const lo = m.weaponLoadout || {};
  const optByName = new Map((m.weaponOptions || []).map((o) => [o.name, o]));
  const out = [];
  for (const w of weapons || []) {
    const opt = optByName.get(w.name);
    if (!opt) { out.push(w); continue; } // basiswapen
    const n = parseInt(lo[w.name]) || 0;
    if (n > 0) out.push({ ...w, count: n });
  }
  return out;
}
