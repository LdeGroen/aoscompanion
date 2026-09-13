import { isCoreActionKeyword, phaseLabel } from "./factions.js";

// Abilities leesbaar maken aan tafel. De teksten uit de database hebben een vaste
// vorm die we uit elkaar trekken en met kleur terugtonen:
//
//   [Once Per Turn (Army), Any Combat Phase]     ← wanneer mag dit
//   Declare: Pick an enemy unit …                ← wat kondig je aan
//   Effect: Roll a D3 …                          ← wat gebeurt er
//
// Wat we niet herkennen laten we ongemoeid staan: liever een gewone alinea dan
// een verkeerd opgeknipte regel.

// Timing die ook zónder blokhaken vooraan kan staan.
const TIMING_RE = new RegExp(
  "^(" +
  "passive|" +
  "once per (?:turn|battle)[^,\\n]*|" +
  "reaction:[^\\n]+|" +
  "(?:your|any|enemy) [a-z' ]*phase|" +
  "(?:start|end) of (?:any|your|the enemy|each)? ?(?:turn|battle ?round|round|phase)|" +
  "deployment phase|before the battle|during deployment|any turn|each turn" +
  ")\\s*[.:]?\\s*$", "i");

const BLOCK_RE = /(?:^|\n)[ \t]*(Declare|Effect|Used By|Cost|Keywords?)[ \t]*:[ \t]*/gi;

// Kleurconventie per soort timing: dezelfde fase krijgt overal dezelfde kleur,
// zodat je aan tafel op kleur kunt zoeken in plaats van op tekst.
export function timingClass(part) {
  const t = String(part || "").toLowerCase();
  if (/passive/.test(t)) return "t-passive";
  if (/reaction/.test(t)) return "t-reaction";
  if (/once per/.test(t)) return "t-limit";
  if (/hero phase/.test(t)) return "t-hero";
  if (/movement phase/.test(t)) return "t-move";
  if (/shooting phase/.test(t)) return "t-shoot";
  if (/charge phase/.test(t)) return "t-charge";
  if (/combat phase/.test(t)) return "t-combat";
  if (/deployment|before the battle/.test(t)) return "t-deploy";
  if (/start of|end of|turn|round/.test(t)) return "t-round";
  return "t-other";
}

// Haalt de timing en de Declare/Effect-blokken uit een beschrijving.
export function parseAbility(description) {
  let text = String(description || "").replace(/\r/g, "").trim();
  const timing = [];

  const bracket = /^\[([^\]]+)\]\s*/.exec(text);
  if (bracket) {
    for (const part of bracket[1].split(/,\s*(?![^()]*\))/)) {
      const p = part.trim();
      if (p) timing.push(p);
    }
    text = text.slice(bracket[0].length).trim();
  } else {
    // Zonder blokhaken: alleen de eerste regel, en alleen als hij er echt als
    // een timing uitziet (anders halen we zomaar een zin weg).
    const firstLine = text.split("\n")[0].trim();
    if (firstLine && firstLine.length <= 80 && TIMING_RE.test(firstLine)) {
      timing.push(firstLine.replace(/[.:]\s*$/, ""));
      text = text.slice(text.indexOf("\n") + 1 || text.length).trim();
    }
  }

  // Blokken (Declare/Effect/…). Alles vóór het eerste label blijft losse tekst.
  const blocks = [];
  let intro = text;
  const matches = [...text.matchAll(BLOCK_RE)];
  if (matches.length) {
    intro = text.slice(0, matches[0].index).trim();
    matches.forEach((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      blocks.push({ label: m[1], text: text.slice(start, end).trim() });
    });
  }
  return { timing, intro, blocks };
}

// Getallen die je aan tafel zoekt — afstanden, dobbelstenen en rolresultaten —
// een eigen accent geven. Werkt op al-ge-escapete tekst.
function markNumbers(escaped) {
  return escaped
    .replace(/(\d+(?:\.\d+)?&quot;)/g, '<span class="ab-num">$1</span>')
    .replace(/\b(\d*D\d+(?:\s*[+-]\s*\d+)?)\b/g, '<span class="ab-num">$1</span>')
    .replace(/\b([2-6]\+)/g, '<span class="ab-num">$1</span>');
}

// Staat er geen timing in de tekst, dan vertellen de phase-velden van de ability
// hetzelfde — in dezelfde kleuren, zodat "wanneer" altijd bovenaan staat.
export function phaseChipsHtml(phases, esc) {
  const list = (phases || []).filter(Boolean);
  if (!list.length) return "";
  const cls = (key) => {
    const k = String(key).toLowerCase();
    if (k.includes("hero")) return "t-hero";
    if (k.includes("movement")) return "t-move";
    if (k.includes("shooting")) return "t-shoot";
    if (k.includes("charge")) return "t-charge";
    if (k.includes("combat")) return "t-combat";
    if (k.includes("deployment")) return "t-deploy";
    return "t-round";
  };
  return `<div class="ab-timing">${list
    .map((p) => `<span class="tchip ${cls(p)}">${esc(phaseLabel(p))}</span>`)
    .join("")}</div>`;
}

export function timingHtml(timing, esc) {
  if (!timing.length) return "";
  return `<div class="ab-timing">${timing
    .map((t) => `<span class="tchip ${timingClass(t)}">${esc(t)}</span>`)
    .join("")}</div>`;
}

// De hele body van een ability: timing, blokken, keywords. De kop (naam, knoppen)
// blijft van de aanroeper, want die verschilt per scherm.
export function abilityBodyHtml(ab, esc, { keywords = true, phases = true } = {}) {
  const { timing, intro, blocks } = parseAbility(ab?.description);
  const parts = [];
  parts.push(timing.length
    ? timingHtml(timing, esc)
    : (phases ? phaseChipsHtml(ab?.phases, esc) : ""));
  if (intro) parts.push(`<div class="ab-text">${markNumbers(esc(intro))}</div>`);
  for (const b of blocks) {
    parts.push(`<div class="ab-block">
      <span class="ab-label ${b.label.toLowerCase().replace(/\s+/g, "-")}">${esc(b.label)}</span>
      <span class="ab-text">${markNumbers(esc(b.text))}</span>
    </div>`);
  }
  if (keywords) {
    const chips = (ab?.keywords || []).map(
      (k) => `<span class="chip kw${isCoreActionKeyword(k) ? " core" : ""}">${esc(k)}</span>`
    );
    if (ab?.cpCost) chips.push(`<span class="chip kw cp">${ab.cpCost} CP</span>`);
    if (chips.length) parts.push(`<div class="chips ability-tags">${chips.join("")}</div>`);
  }
  return parts.filter(Boolean).join("");
}
