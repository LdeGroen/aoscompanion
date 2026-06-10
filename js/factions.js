// Factions en subfactions, overgenomen uit de AoS Teams App
export const AOS_FACTIONS = {
  // --- ORDER ---
  "Stormcast Eternals": ["Lightning Echelon", "Sacrosanct Convocation", "Thunderhead Host", "Sentinels of the Bleak Citadels", "Vanguard Wing", "Draconith Skywing", "Heroes of the First-Forged", "Ruiniation Brotherhood"],
  "Cities of Sigmar": ["Dawnbringer Crusade", "Fortress-city Defenders", "Ironweld Guild Army", "Collegiate Arcane Expedition", "Veteran Cannoneers", "Fearless Exemplars"],
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
  // Deployment is er alleen vóór battleround 1 en valt buiten de beurten,
  // dus die bestaat niet dubbel
  { key: "deployment", label: "Deployment" },
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
