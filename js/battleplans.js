import * as sharedb from "./sharedb.js";
import { uid } from "./storage.js";

// Battleplans en battle tactics: game-brede gedeelde data (niet faction-gebonden),
// opgeslagen in één gedeelde blob (key "gamedata"). De 12 battleplans van
// Pitched Battles 2025-26 en de 6 battle tactics worden bij de eerste keer
// laden geseed; daarna zijn ze in de database te bewerken (abilities, stappen).
//
// Score-schema's zitten als data op het battleplan (scoring.variants per
// battleround); die zijn bewust niet via de UI bewerkbaar — wel via een seed-update.

// ---------- Score-schema bouwstenen ----------
const HOLD_123 = [
  { key: "hold1", label: "Hold 1 objective", points: 5 },
  { key: "hold2", label: "Hold 2 objectives", points: 3 },
  { key: "holdMore", label: "Hold more objectives than your opponent", points: 2 },
];
const HOLD_PAIR = [
  { key: "hold1", label: "Hold 1 objective", points: 5 },
  { key: "pair", label: "Hold any pair of objectives", points: 3 },
  { key: "holdMore", label: "Hold more objectives than your opponent", points: 2 },
];
const ALL_ROUNDS = [1, 2, 3, 4, 5];

function bp(name, variants, extra = {}) {
  return {
    id: uid(),
    name,
    abilities: [],
    scoring: { variants, liferoot: false, endBonus: null, ...extra },
  };
}

export function battleplanSeeds() {
  return [
    bp("Passing Seasons", [
      { rounds: [1, 3, 5], options: [
        { key: "gnarl1", label: "1st Gnarlroot objective", points: 5 },
        { key: "gnarl2", label: "2nd Gnarlroot objective", points: 5 },
      ] },
      { rounds: [2, 4], options: [
        { key: "oak1", label: "1st Oakenbrow objective", points: 5 },
        { key: "oak2", label: "2nd Oakenbrow objective", points: 5 },
      ] },
    ]),
    bp("Paths of the Fey", [{ rounds: ALL_ROUNDS, options: HOLD_123 }]),
    bp("Roiling Roots", [{ rounds: ALL_ROUNDS, options: HOLD_PAIR }]),
    bp("Cyclic Shifts", [{ rounds: ALL_ROUNDS, options: HOLD_123 }]),
    bp("Surge of Slaughter", [{ rounds: ALL_ROUNDS, options: HOLD_PAIR }]),
    bp("Linked Ley Lines", [{ rounds: ALL_ROUNDS, options: [
      { key: "hold1", label: "Hold 1 objective", points: 3 },
      { key: "hold2", label: "Hold 2 objectives", points: 3 },
      { key: "pair", label: "Hold any pair of objectives", points: 2 },
      { key: "leyline", label: "Control all objectives on a linked ley line", points: 2 },
    ] }]),
    bp("Noxious Nexus", [
      { rounds: [2, 3, 4, 5], options: [
        { key: "oak", label: "Hold the Oakenbrow objective", points: 5 },
        { key: "gnarl", label: "Hold the Gnarlroot objective", points: 3 },
        { key: "heart", label: "Hold the Heartwood objective", points: 2 },
      ] },
    ], { endBonus: { label: "Controls the Heartwood objective at the end of the game", points: 10 } }),
    bp("The Liferoots", [{ rounds: ALL_ROUNDS, options: [
      { key: "hold1", label: "Hold 1 objective", points: 5 },
      { key: "hold2", label: "Hold 2 objectives", points: 3 },
      { key: "liferootMore", label: "More liferoot points than your opponent", points: 2 },
    ] }], { liferoot: true }),
    bp("Bountiful Equinox", [{ rounds: ALL_ROUNDS, options: [
      { key: "hold1", label: "Hold 1 objective", points: 5 },
      { key: "hold2", label: "Hold 2 objectives", points: 3 },
      { key: "trio", label: "Hold 1 Oakenbrow, 1 Gnarlroot and 1 Heartwood objective", points: 2 },
    ] }]),
    bp("Lifecycle", [
      { rounds: [1], options: [
        { key: "hold1", label: "Hold 1 objective", points: 4 },
        { key: "holdMore", label: "Hold more objectives than your opponent", points: 2 },
        { key: "both", label: "Hold both the Oakenbrow and Gnarlroot objectives", points: 4 },
      ] },
      { rounds: [2, 3, 4, 5], options: [
        { key: "hold1", label: "Hold 1 objective", points: 4 },
        { key: "holdMore", label: "Hold more objectives than your opponent", points: 2 },
        { key: "primary", label: "Hold the primary objective", points: 2 },
        { key: "sec1", label: "Hold the 1st secondary objective", points: 1 },
        { key: "sec2", label: "Hold the 2nd secondary objective", points: 1 },
      ] },
    ]),
    bp("Creeping Corruption", [{ rounds: ALL_ROUNDS, options: HOLD_123 }]),
    bp("Grasp of Thorns", [{ rounds: ALL_ROUNDS, options: HOLD_123 }]),
  ];
}

export function tacticSeeds() {
  const names = ["Attuned to Ghyran", "Intercept and Recover", "Master The Paths", "Restless Energy", "Scouting Force", "Wrathfull Cycles"];
  return names.map((name) => ({
    id: uid(),
    name,
    steps: [1, 2, 3].map((n) => ({ name: `Stap ${n}`, description: "" })),
  }));
}

// ---------- Laden / opslaan ----------
export function emptyGamedata() {
  return { battleplans: [], tactics: [] };
}

function normalize(obj) {
  const db = obj || emptyGamedata();
  db.battleplans = db.battleplans || [];
  db.tactics = db.tactics || [];
  for (const b of db.battleplans) b.abilities = b.abilities || [];
  return db;
}

// Laadt de gamedata en seedt hem bij de allereerste keer.
export async function loadGamedata() {
  const { db, offline } = await sharedb.loadSharedBlob("gamedata", normalize);
  let seeded = false;
  if (!db.battleplans.length) { db.battleplans = battleplanSeeds(); seeded = true; }
  if (!db.tactics.length) { db.tactics = tacticSeeds(); seeded = true; }
  if (seeded && !offline) {
    try { await saveGamedata(db); } catch { /* seeds blijven dan lokaal */ }
  }
  return { db, offline };
}

export async function saveGamedata(db) {
  await sharedb.saveSharedBlob("gamedata", db);
}

// ---------- Scoring helpers ----------
export function scoringOptionsFor(battleplan, round) {
  const variant = (battleplan?.scoring?.variants || []).find((v) => v.rounds.includes(round));
  return variant ? variant.options : [];
}

export const TACTIC_STEP_POINTS = 5;

// Telt de punten van één kant ("player" of "enemy") op basis van de spelstatus.
export function calcSide(game, side) {
  const perRound = {};
  let objective = 0;
  for (let r = 1; r <= 5; r++) {
    let pts = 0;
    for (const opt of scoringOptionsFor(game.battleplan, r)) {
      if (game.scores?.[side]?.[r]?.[opt.key]) pts += opt.points;
    }
    perRound[r] = pts;
    objective += pts;
  }
  const endBonus = game.battleplan?.scoring?.endBonus && game.endBonusOwner === side
    ? game.battleplan.scoring.endBonus.points : 0;
  let tactics = 0;
  const tacticsList = side === "player" ? game.tactics : game.enemyTactics;
  for (const t of tacticsList || []) tactics += (t.scoredRounds || []).length * TACTIC_STEP_POINTS;
  return { perRound, objective, endBonus, tactics, total: objective + endBonus + tactics };
}

export function calcScores(game) {
  return { player: calcSide(game, "player"), enemy: calcSide(game, "enemy") };
}
