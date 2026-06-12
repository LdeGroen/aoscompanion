import { STAT_MODS, enhancementCategoryLabel } from "./factions.js";

// Logica rond enhancements: welke mag een model krijgen, en wat doen de
// stat improvements met de getoonde stats.

// Mag deze enhancement aan dit model gegeven worden?
// Artifacts/heroic traits: alleen type "Hero" (Named heroes expliciet niet).
// Other enhancements: alleen het model-type waarvoor ze bedoeld zijn.
export function enhancementFits(enh, model) {
  if (enh.category === "other") return !!enh.forType && enh.forType === model.type;
  return model.type === "Hero";
}

export function enhancementsOf(army, model) {
  const all = army.enhancements || [];
  return (model.enhancementIds || []).map((id) => all.find((e) => e.id === id)).filter(Boolean);
}

// "4+" n stappen beter → "3+" (nooit beter dan 2+); "-" blijft "-"
export function improveRoll(roll, steps) {
  const n = parseInt(roll);
  if (!n) return roll;
  return Math.max(2, n - steps) + "+";
}

// "+N" op een waarde die ook dobbelsteen-notatie kan zijn ("D3", "2D6+2", "7")
export function addToValue(value, n) {
  const s = String(value ?? "").trim();
  if (s === "") return s;
  if (/^-?\d+$/.test(s)) return String(parseInt(s) + n);
  const m = /^(.*?)([+-]\d+)$/.exec(s);
  if (m) {
    const total = parseInt(m[2]) + n;
    return total === 0 ? m[1] : m[1] + (total > 0 ? "+" + total : String(total));
  }
  return `${s}+${n}`;
}

// Beste (laagste) van twee ward saves; "" of "-" = geen ward
const wardNum = (w) => (w && w !== "-" ? parseInt(w) : 99);
export function bestWard(a, b) {
  return wardNum(a) <= wardNum(b) ? (wardNum(a) === 99 ? "" : a) : b;
}

export function modLabel(mod) {
  const def = STAT_MODS.find((s) => s.key === mod.stat);
  const name = def ? def.label : mod.stat;
  if (mod.stat === "ward") return `Ward ${mod.value}`;
  return `+${mod.value} ${name.toLowerCase()}`;
}

// Past alle enhancement-mods van een model toe en geeft een kopie terug,
// plus notities over wat er gewijzigd is (voor de ✦-markering in de UI).
export function effectiveModel(army, model) {
  const enhs = enhancementsOf(army, model);
  const eff = JSON.parse(JSON.stringify(model));
  eff.ward = eff.ward && eff.ward !== "-" ? eff.ward : "";
  const notes = [];
  const changed = new Set();

  for (const enh of enhs) {
    for (const mod of enh.statMods || []) {
      const n = mod.stat === "ward" ? 0 : parseInt(mod.value) || 0;
      switch (mod.stat) {
        case "save":    eff.save = improveRoll(eff.save, n); break;
        case "ward":    eff.ward = bestWard(mod.value, eff.ward); break;
        case "health":  eff.health = (parseInt(eff.health) || 0) + n; break;
        case "control": eff.control = (parseInt(eff.control) || 0) + n; break;
        case "wizard":  eff.wizardLevel = (parseInt(eff.wizardLevel) || 0) + n; break;
        case "priest":  eff.priestLevel = (parseInt(eff.priestLevel) || 0) + n; break;
        case "move":    eff.move = addToValue(eff.move, n); break;
        case "toHit":
        case "toWound":
        case "rend":
        case "attacks":
        case "damage":
          for (const w of [...eff.rangedAttacks, ...eff.meleeAttacks]) {
            if (mod.stat === "toHit") w.toHit = improveRoll(w.toHit, n);
            else if (mod.stat === "toWound") w.toWound = improveRoll(w.toWound, n);
            else if (mod.stat === "rend") w.rend = (parseInt(w.rend) || 0) + n;
            else if (mod.stat === "attacks") w.attacks = addToValue(w.attacks, n);
            else w.damage = addToValue(w.damage, n);
          }
          break;
      }
      changed.add(mod.stat);
      notes.push({ source: enh.name, category: enh.category, stat: mod.stat, label: modLabel(mod) });
    }
  }
  return { model: eff, enhancements: enhs, notes, changed };
}

export function enhancementSource(enh, modelName) {
  return `${enh.name} (${enhancementCategoryLabel(enh.category)}${modelName ? ", " + modelName : ""})`;
}
