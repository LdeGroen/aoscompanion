// Een geëxporteerde legerlijst (tekst) inlezen en koppelen aan de database.
// Bedoeld om de lijst van je tegenstander in één keer in te voeren in plaats van
// kaartje voor kaartje aan te klikken.
//
// De parser is bewust tolerant: onze eigen export (setup.js → buildExportText) is
// de maat, maar lijsten uit de officiële app of van een forum zien er net anders
// uit (hoofdletters, andere bullets, regels die wij niet kennen). Wat we niet
// begrijpen slaan we over en melden we — er wordt niets geraden.

const SECTIONS = [
  [/^general'?s\s+regiment\b/i, "General's Regiment"],
  [/^regiments?\s+of\s+renown\b/i, "Regiment of Renown"],
  [/^regiment\s*\d*\b/i, "Regiment"],
  [/^auxiliary\s+units?\b/i, "Auxiliary Units"],
  [/^faction\s+terrain\b/i, "Faction Terrain"],
  [/^manifestations?\b/i, "Manifestations"],
  [/^terrain\b/i, "Faction Terrain"],
];

// Regels die over de lijst als geheel gaan en dus geen unit zijn.
const META = [
  /^drops\s*[:\-]/i,
  /^army\s+(faction|subfaction|type)\s*[:\-]/i,
  /^(total\s+)?points\s*[:\-]/i,
  /^battle\s+tactic/i,
  /^(spell|prayer|manifestation)\s+lore\s*[:\-]/i,
  /^lore\s+of\b/i,
  /^created\s+with\b/i,
  /^gemaakt\s+met\b/i,
  /^\d+\s*\/\s*\d+\s*(pts|points)?$/i,
];

const isBullet = (line) => /^[•\-\*•‣▪·]\s*/.test(line);
const stripBullet = (line) => line.replace(/^[•\-\*•‣▪·]\s*/, "").trim();

// Namen vergelijken: hoofdletters, aanhalingstekens en dubbele spaties negeren.
export function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’`']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Korte vorm: alles vóór de komma ("Dexcessa, the Talon of Slaanesh" → "dexcessa")
const shortName = (s) => normName(String(s || "").split(",")[0]);

export function parseListText(text, { factions = {} } = {}) {
  const out = {
    armyName: "", points: 0, faction: "", subfaction: "", drops: 0,
    lores: { spell: "", prayer: "", manifestation: "" },
    battleTactics: [],
    units: [],      // {name, points, bullets[], general, reinforced, group}
    ignored: [],    // regels die we niet thuis konden brengen
  };
  const lines = String(text || "").split(/\r?\n/);
  const factionNames = Object.keys(factions);
  let group = "";
  let current = null;
  let seenSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Bullet → hoort bij de vorige unit
    if (isBullet(line)) {
      const b = stripBullet(line);
      if (!current) { out.ignored.push(line); continue; }
      if (/^general$/i.test(b)) { current.general = true; continue; }
      if (/^reinforced$/i.test(b)) { current.reinforced = true; continue; }
      current.bullets.push(b);
      continue;
    }

    // Kopjes van secties
    const sec = SECTIONS.find(([re]) => re.test(line));
    if (sec) { group = sec[1]; seenSection = true; current = null; continue; }

    // Eerste regel: "Naam 1970/2000 pts"
    const head = /^(.*?)\s+(\d+)\s*\/\s*(\d+)\s*(pts|points)?$/i.exec(line);
    if (head && !out.armyName) {
      out.armyName = head[1].trim();
      out.points = Number(head[2]);
      continue;
    }

    // Meta-regels
    const lore = /^(spell|prayer|manifestation)\s+lore\s*[:\-]\s*(.+)$/i.exec(line);
    if (lore) { out.lores[lore[1].toLowerCase()] = lore[2].trim(); continue; }
    const drops = /^drops\s*[:\-]\s*(\d+)/i.exec(line);
    if (drops) { out.drops = Number(drops[1]); continue; }
    const bt = /^battle\s+tactic\s+cards?\s*[:\-]\s*(.+)$/i.exec(line);
    if (bt) { out.battleTactics = bt[1].split(",").map((x) => x.trim()).filter(Boolean); continue; }
    if (META.some((re) => re.test(line))) continue;

    // Faction / subfaction (alleen vóór de eerste sectie, daar staan ze)
    if (!seenSection) {
      const fac = factionNames.find((f) => normName(f) === normName(line));
      if (fac) { out.faction = fac; continue; }
      const subOwner = factionNames.find((f) => (factions[f] || []).some((sf) => normName(sf) === normName(line)));
      if (subOwner) {
        out.subfaction = (factions[subOwner] || []).find((sf) => normName(sf) === normName(line));
        if (!out.faction) out.faction = subOwner;
        continue;
      }
      if (!out.armyName) { out.armyName = line; continue; } // de eerste losse regel is de legernaam
    }

    // Unit: "Naam (150)" of, binnen een sectie, een kale naam
    const unit = /^(.*?)\s*\((\d+)\)\s*$/.exec(line);
    if (unit) {
      current = { name: unit[1].trim(), points: Number(unit[2]), bullets: [], general: false, reinforced: false, group };
      out.units.push(current);
      continue;
    }
    if (seenSection && /[a-z]/i.test(line)) {
      current = { name: line.replace(/\s*\(.*\)$/, "").trim(), points: 0, bullets: [], general: false, reinforced: false, group };
      out.units.push(current);
      continue;
    }
    out.ignored.push(line);
  }
  return out;
}

// Gevonden units en enhancements koppelen aan de database van die faction.
// Geeft per unit terug wat er gevonden is, zodat de gebruiker het kan nakijken
// vóór er iets wordt toegevoegd.
export function resolveList(parsed, { models = [], enhancements = [] } = {}) {
  const byName = new Map();
  for (const m of models) {
    byName.set(normName(m.name), m);
    if (!byName.has(shortName(m.name))) byName.set(shortName(m.name), m);
  }
  const findModel = (name) => byName.get(normName(name)) || byName.get(shortName(name)) || null;

  const enhByName = new Map();
  for (const e of enhancements) enhByName.set(normName(e.name), e);
  const findEnh = (name) => enhByName.get(normName(name)) || null;

  const matched = [];   // {entry, model, enhancements[], unknownBullets[]}
  const unknown = [];   // units die niet in de database staan
  for (const u of parsed.units) {
    // Een Regiment of Renown-kopregel is zelf geen kaartje; die units staan eronder.
    const model = findModel(u.name);
    if (!model) { unknown.push(u); continue; }
    const enhs = [], rest = [];
    for (const b of u.bullets) {
      const e = findEnh(b);
      if (e) enhs.push(e); else rest.push(b);
    }
    matched.push({ entry: u, model, enhancements: enhs, unknownBullets: rest });
  }
  return { matched, unknown };
}
