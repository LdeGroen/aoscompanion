// Rekenkern voor de gemiddelde-schadecalculator. Puur rekenwerk, geen DOM —
// zo is het los te testen (ko-import/test-damage.mjs) en te hergebruiken.
//
// Regels waar we van uitgaan (AoS 4e):
// - Een ongewijzigde 1 mislukt altijd, bij hit-, wound- én save-rolls.
// - Een ongewijzigde 6 is een critical hit. Wat die doet hangt af van het wapen:
//   "Crit (2 Hits)" = een extra hit, "Crit (Auto-wound)" = wound-rol overslaan,
//   "Crit (Mortal)" = wound én save overslaan, alleen een ward houdt het nog tegen.
// - Rend verslechtert de save; ward is niet te beïnvloeden door rend.

// "2D6", "D3+2", "D6", "4", 4 → gemiddelde waarde. Null bij iets onleesbaars
// (sommige warscrolls verwijzen naar een ability i.p.v. een getal).
export function avgDice(expr) {
  if (typeof expr === "number") return Number.isFinite(expr) ? expr : null;
  const s = String(expr ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(\d*)\s*D\s*(\d+)\s*([+-]\s*\d+)?$/i.exec(s);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  const bonus = m[3] ? Number(m[3].replace(/\s+/g, "")) : 0;
  if (!sides) return null;
  return count * ((sides + 1) / 2) + bonus;
}

// "3+" → 3. Ook los getal of "3" wordt begrepen. Null als er niets bruikbaars staat.
export function parseTarget(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /(\d)\s*\+?/.exec(String(v ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : null;
}

// Rend/modifier als getal ("-1", "1", 0, "" → 0).
export function num(v) {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// Kans op een geslaagde rol, plus de kans op een ongewijzigde 6 (de crit).
// reroll: "none" | "ones" | "fails".
export function rollChance(target, modifier = 0, reroll = "none") {
  if (target === null) return { p: 0, crit: 0 };
  let hits = 0;
  for (let r = 1; r <= 6; r++) {
    if (r === 1) continue;                 // ongewijzigde 1 mislukt altijd
    if (r + modifier >= target) hits++;
  }
  const p = hits / 6;
  const crit = 1 / 6;
  // Bij een herworp krijg je een tweede kans over precies dat deel van de
  // uitkomsten dat je opnieuw mag gooien — ook op een 6, dus de crit-kans groeit mee.
  let again = 0;
  if (reroll === "ones") again = 1 / 6;
  else if (reroll === "fails") again = 1 - p;
  return { p: p + again * p, crit: crit + again * crit };
}

// Kans dat de verdediger de save haalt. Rend verslechtert de save; "geen save"
// (bijv. na een ability) geef je door met save = null.
export function saveChance(save, rend = 0, modifier = 0, reroll = "none") {
  const target = parseTarget(save);
  if (target === null) return 0;
  return rollChance(target, modifier - num(rend), reroll).p;
}

// Ward: eigen rol, rend telt niet mee, ongewijzigde 1 mislukt.
export function wardChance(ward) {
  const target = parseTarget(ward);
  if (target === null) return 0;
  return rollChance(target, 0).p;
}

export const DEFAULT_OPTS = {
  models: 1,          // aantal modellen dat met dit wapen aanvalt
  attacksBonus: 0,
  hitBonus: 0,
  woundBonus: 0,
  rendBonus: 0,
  damageBonus: 0,
  rerollHits: "none", // none | ones | fails
  rerollWounds: "none",
  crit: "none",       // none | hits2 | autowound | mortal
  saveMod: 0,         // + = betere save voor de verdediger (bijv. cover)
  rerollSaves: "none",
  noSave: false,
  wardOverride: "",   // "" = de ward van het doelwit gebruiken
};

// Verwachte schade van één wapen tegen één doelwit.
// weapon: {name, attacks, toHit, toWound, rend, damage}
// target: {save, ward}
export function weaponDamage(weapon, target, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const perModel = avgDice(weapon.attacks);
  const dmg = avgDice(weapon.damage);
  const hitT = parseTarget(weapon.toHit);
  const woundT = parseTarget(weapon.toWound);
  if (perModel === null || dmg === null || hitT === null || woundT === null) {
    return { unknown: true, attacks: 0, hits: 0, wounds: 0, unsaved: 0, damage: 0 };
  }

  const attacks = Math.max(0, (perModel + o.attacksBonus) * Math.max(1, o.models));
  const hit = rollChance(hitT, o.hitBonus, o.rerollHits);
  const wound = rollChance(woundT, o.woundBonus, o.rerollWounds);

  const ward = o.wardOverride ? wardChance(o.wardOverride) : wardChance(target.ward);
  const rend = num(weapon.rend) + o.rendBonus;
  const save = o.noSave ? 0 : saveChance(target.save, rend, o.saveMod, o.rerollSaves);
  const dmgPer = Math.max(0, dmg + o.damageBonus);

  let hits = attacks * hit.p;
  const crits = attacks * hit.crit;
  let mortalDamage = 0;
  let wounds;

  if (o.crit === "hits2") {
    hits += crits;                                   // elke crit levert een extra hit
    wounds = hits * wound.p;
  } else if (o.crit === "autowound") {
    wounds = (hits - crits) * wound.p + crits;       // crits slaan de wound-rol over
  } else if (o.crit === "mortal") {
    hits -= crits;                                   // crits verlaten de normale reeks
    wounds = hits * wound.p;
    mortalDamage = crits * dmgPer * (1 - ward);
  } else {
    wounds = hits * wound.p;
  }

  const unsaved = wounds * (1 - save);
  const damage = unsaved * dmgPer * (1 - ward) + mortalDamage;
  return {
    unknown: false,
    attacks,
    hits: o.crit === "mortal" ? hits + crits : hits,  // voor de weergave tellen crits als hit
    wounds,
    unsaved: o.crit === "mortal" ? unsaved + crits : unsaved,
    mortalDamage,
    damage,
  };
}

// Totaal over meerdere wapens, met de rij per wapen erbij.
export function totalDamage(weapons, target, optsFor) {
  const rows = weapons.map((w) => ({ weapon: w, ...weaponDamage(w, target, optsFor ? optsFor(w) : {}) }));
  const damage = rows.reduce((a, r) => a + (r.unknown ? 0 : r.damage), 0);
  return { rows, damage };
}
