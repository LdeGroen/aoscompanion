import { effectiveModel } from "./enhancements.js";
import { icon } from "./icons.js";

// Units, models en wounds van een leger. Een warscroll draagt `modelCount` (uit Sigdex,
// zie ko-import/add-modelcount-sigdex.mjs); reinforced verdubbelt dat. Wounds = models ×
// health, mét health-enhancements. Manifestaties en faction terrain tellen niet mee.
// Units zonder modelCount (oude kopie, eigen kaartje) tellen als 1 model: `unknown` zegt
// hoeveel dat er zijn, zodat de weergave kan laten zien dat het een ondergrens is.
export function armyTotals(army) {
  const t = { units: 0, models: 0, wounds: 0, unknown: 0 };
  for (const m of army.models || []) {
    if (m.type === "Manifestation" || m.type === "Faction terrain") continue;
    const count = parseInt(m.modelCount) || 0;
    if (!count) t.unknown++;
    const n = (count || 1) * (m.reinforced ? 2 : 1);
    const hp = parseInt(effectiveModel(army, m).model.health) || 0;
    t.units++;
    t.models += n;
    t.wounds += n * hp;
  }
  return t;
}

// "12 units · 48 models · 96 wounds" — met "≥" als niet alle modelaantallen bekend zijn.
export function armyTotalsHtml(army, esc) {
  const t = armyTotals(army);
  const pre = t.unknown ? "≥" : "";
  const title = t.unknown ? ` title="${esc(`${t.unknown} unit${t.unknown === 1 ? "" : "s"} zonder bekend modelaantal, geteld als 1 model`)}"` : "";
  return `<span class="army-totals"${title}>${t.units} unit${t.units === 1 ? "" : "s"} · ${icon("users", 12)} ${pre}${t.models} models · ${icon("shield", 12)} ${pre}${t.wounds} wounds</span>`;
}
