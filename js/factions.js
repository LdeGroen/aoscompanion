// Factions en subfactions, overgenomen uit de AoS Teams App
export const AOS_FACTIONS = {
  // --- ORDER ---
  "Stormcast Eternals": ["Lightning Echelon", "Sacrosanct Convocation", "Thunderhead Host", "Sentinels of the Bleak Citadels", "Vanguard Wing", "Draconith Skywing", "Heroes of the First-Forged", "Ruiniation Brotherhood"],
  "Cities of Sigmar": ["Stalwart Guardians", "Collegiate Exemplars", "Zealous Hordes", "Swift Reinforcements", "Veteran Cannoneers", "Fearless Exemplars", "Thrall Warhost", "Grudgebound War Throng"],
  "Seraphon": ["Eternal Starhost", "Sunclaw Starhost", "Shadowstrike Starhost", "Thunderquake Starhost"],
  "Sylvaneth": ["Followers of Kurnoth", "Outcasts", "Lords of the Clan", "Glade Defenders", "Wargrove of the Burgeoning", "Wargrove of Everdusk"],
  "Lumineth Realm-lords": ["Warhost of Duality", "Pilgrims of Haixiah", "Aelementor Guardians", "Scinari Council"],
  "Daughters of Khaine": ["Coven of Blood", "Cold-Hearted Murderers", "Frenzied Devotees", "Fervent Ritualists", "Coven Zealots", "Arena Veterans"],
  "Idoneth Deepkin": ["Namarti Corps", "Isharann Council", "Akhelian Beastmasters", "Soul-raid Ambushers", "Deep-sea Stalkers", "Ethersea Predators"],
  "Kharadron Overlords": ["Pioneers and Scavengers", "Veteran Ground Troops", "Rapid Redeployment Squadron", "Endrineers Guild Expeditionary Force"],
  "Fyreslayers": ["Warrior Kinband", "Scales of Vulcatrix", "Forge Brethren", "Lords of the Lodge"],

  // --- CHAOS ---
  "Slaves to Darkness": ["Legion of Chaos", "Despoilers", "Legion of the First Prince", "Godswrath Warband", "Darkoath Horde", "Chaos Horde", "Champions of Chaos"],
  "Skaven": ["Fleshmeld Menagerie", "Virulent Procession", "Warpcog Convocation", "Claw-horde", "Kill‑Pack", "Envoys of the Deepengnaw", "Gathering of the Clans"],
  "Blades of Khorne": ["Khornate Legion", "Bloodbound Warhorde", "Brass Stampede", "Murderhost", "Tournament of Skulls", "The Goretide"],
  "Disciples of Tzeentch": ["Fated Blades", "Denizens of the Silver Towers", "Malevolent Schemers", "Mutants and Mad Thingst", "Masters of Fate", "Spellweaver Coven"],
  "Maggotkin of Nurgle": ["Tallyband of Nurgle", "Plague Cyst", "Nurgle's Menagerie", "Affliction Cyst"],
  "Hedonites of Slaanesh": ["Supreme Sybarites", "Seeker Cavalcade", "Epicurean Revellers", "Depraved Carnival", "Pretenders", "Invaders"],
  "Helsmiths of Hashut": ["Hashutite Host", "The Bullfather's Horns", "Castigation Battery", "Daemonsmith Cabal", "Domination Force", "Industrial Polluters"],

  // --- DEATH ---
  "Soulblight Gravelords": ["Bacchanal of Blood", "Deathmarch", "Deathstench Drove", "Legion of Shyish", "Legions of Ulfenkarn", "Cryptmasters", "Skinshifters"],
  "Ossiarch Bonereapers": ["Border Guards", "Ruthless Legion", "The Inevitable Empire", "Remorseless Conquerors", "Tithe Guards", "Hekatos Drillmasters"],
  "Nighthaunt": ["Quicksilver Gheists", "Shrieker Host", "Royal Procession", "Death Stalkers", "Hungry Nexus", "Deathrust Gheists"],
  "Flesh-eater Courts": ["Knightly Echelon", "The Royal Hunt", "Lords of the Manor", "Royal Menagerie", "Impassioned Serfs", "Questing Courtiers"],

  // --- DESTRUCTION ---
  "Ironjawz": ["Ironjawz Brawl", "Weirdfist", "Ironfist", "Grunta Stampede", "Brutefist", "Bigsnikkaz"],
  "Kruleboyz": ["Kruleboyz Klaw", "Light Finga", "Middul Finga", "Trophy Finga", "Swamphorde Bullies", "Badmouthing Baiterz"],
  "Gloomspite Gitz": ["Gloomspite Horde", "Squigalanche", "Troggherd", "Gitmob Pack", "Sunbiter Pack", "Gittish Tide"],
  "Ogor Mawtribes": ["Heralds of the Everwinter", "Prophets of the Gulping God", "Beast Handlers", "Blackpowder Fanatics", "Mawpath Menaces", "Greedy Eaters"],
  "Sons of Behemat": ["Stomper Tribe", "Taker Tribe", "Breaker Tribe", "Boss Tribe", "Manskittle Mob", "Big Toes"],
};

// Phases bestaan dubbel: eigen beurt en beurt van de tegenstander
export const PHASES = [
  { key: "start",    label: "Start of Turn" },
  { key: "hero",     label: "Hero Phase" },
  { key: "movement", label: "Movement Phase" },
  { key: "shooting", label: "Shooting Phase" },
  { key: "charge",   label: "Charge Phase" },
  { key: "combat",   label: "Combat Phase" },
  { key: "end",      label: "End of Turn" },
];

export const PHASE_OPTIONS = [
  // Deployment (alleen vóór battleround 1) en Start of Battleround (vóór de
  // eerste beurt van iedere battleround) vallen buiten de beurten,
  // dus die bestaan niet dubbel
  { key: "deployment", label: "Deployment" },
  { key: "startOfRound", label: "Start of Battleround" },
  ...PHASES.flatMap((p) => [
    { key: `own-${p.key}`,   label: `Eigen ${p.label}` },
    { key: `enemy-${p.key}`, label: `Enemy ${p.label}` },
  ]),
];

export function phaseLabel(key) {
  const opt = PHASE_OPTIONS.find((o) => o.key === key);
  return opt ? opt.label : key;
}

export const SAVES = ["2+", "3+", "4+", "5+", "6+", "-"];
export const TO_HIT_WOUND = ["2+", "3+", "4+", "5+", "6+"];

// Ieder uniek model heeft een type; "-" = geen ward save
// "Manifestation" werkt anders: die is pas in het spel nadat hij in de hero
// phase gesummend is (zie companion.js, game.summoned).
export const MODEL_TYPES = ["Hero", "Named hero", "Infantry", "Cavalry", "Beast", "Monster", "Warmachine", "Faction terrain", "Manifestation"];
export const WARDS = ["-", "2+", "3+", "4+", "5+", "6+"];

// Enhancements: artifacts/heroic traits alleen voor models met type "Hero"
// (Named heroes mogen volgens de regels géén enhancements); "other" geldt
// voor één specifiek model-type dat je zelf kiest (forType).
export const ENHANCEMENT_CATEGORIES = [
  { key: "artifact",       label: "Artifacts of Power",  heroOnly: true },
  { key: "heroicTrait",    label: "Heroic Traits",       heroOnly: true },
  { key: "monstrousTrait", label: "Monstrous Traits",    heroOnly: true },
  { key: "other",          label: "Other Enhancements",  heroOnly: false },
];

export function enhancementCategoryLabel(key) {
  const cat = ENHANCEMENT_CATEGORIES.find((c) => c.key === key);
  return cat ? cat.label : key;
}

// Groepeert items (models of wrappers daarvan) per model-type, in de volgorde
// van MODEL_TYPES; alles zonder (bekend) type komt achteraan onder "Zonder type".
export function groupByType(items, getType = (x) => x.type) {
  const groups = [];
  const rest = [...items];
  for (const t of MODEL_TYPES) {
    const matched = rest.filter((x) => getType(x) === t);
    if (matched.length) {
      groups.push([t, matched]);
      for (const x of matched) rest.splice(rest.indexOf(x), 1);
    }
  }
  if (rest.length) groups.push(["Zonder type", rest]);
  return groups;
}

// Lore-soorten: de army-velden spellLore/manifestationLore/prayerLore en de
// gedeelde database gebruiken dezelfde kinds. Manifestation lores kunnen
// "universal" zijn — die zijn voor iedere faction kiesbaar.
export const LORE_KINDS = [
  { key: "spell",         label: "Spell lore",         armyField: "spellLore",         valueLabel: "Casting value",  noun: "spell" },
  { key: "manifestation", label: "Manifestation lore", armyField: "manifestationLore", valueLabel: "Casting value",  noun: "manifestation" },
  { key: "prayer",        label: "Prayer lore",        armyField: "prayerLore",        valueLabel: "Chanting value", noun: "prayer" },
];

export function loreKind(key) {
  return LORE_KINDS.find((k) => k.key === key);
}

// Stat improvements die een enhancement kan geven.
// kind bepaalt de invoer: "steps" = aantal stappen beter (bijv. save 4+ → 3+),
// "amount" = +N op een getal/dobbelsteen-notatie, "ward" = ward save waarde.
export const STAT_MODS = [
  { key: "save",    label: "Save",            kind: "steps"  },
  { key: "ward",    label: "Ward save",       kind: "ward"   },
  { key: "toHit",   label: "To hit",          kind: "steps"  },
  { key: "toWound", label: "To wound",        kind: "steps"  },
  { key: "rend",    label: "Rend",            kind: "amount" },
  { key: "attacks", label: "Attacks",         kind: "amount" },
  { key: "damage",  label: "Damage",          kind: "amount" },
  { key: "health",  label: "Health",          kind: "amount" },
  { key: "move",    label: "Movement (\")",   kind: "amount" },
  { key: "control", label: "Control",         kind: "amount" },
  { key: "wizard",  label: "Wizard level",    kind: "amount" },
  { key: "priest",  label: "Priest level",    kind: "amount" },
];
