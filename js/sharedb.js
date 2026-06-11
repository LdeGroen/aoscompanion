import * as backend from "./backend.js";
import { uid } from "./storage.js";

// De gedeelde faction-database: per faction één blob die voor álle accounts
// toegankelijk is. Bevat kaartjes (models), enhancements en faction/subfaction
// rules — en is uitbreidbaar voor wat we later nog toevoegen.
//
// Met backend: opslag op de server (key "faction:<naam>"), met localStorage
// als cache/offline-vangnet. Zonder backend: alleen localStorage (per apparaat).

const LOCAL_PREFIX = "aoscomp_shared_";

export function emptyFactionDb() {
  return {
    factionRules: [],
    subfactions: {},      // "<naam>": { rules: [] }
    models: [],
    enhancements: [],     // alle categorieën samen; category-veld onderscheidt ze
  };
}

function normalize(dbObj) {
  const db = dbObj || emptyFactionDb();
  db.factionRules = db.factionRules || [];
  db.subfactions = db.subfactions || {};
  db.models = db.models || [];
  db.enhancements = db.enhancements || [];
  return db;
}

const factionKey = (faction) => `faction:${faction}`;

function getLocal(faction) {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFIX + factionKey(faction)));
  } catch {
    return null;
  }
}

function saveLocal(faction, db) {
  localStorage.setItem(LOCAL_PREFIX + factionKey(faction), JSON.stringify(db));
}

// Laadt de database van een faction. Gooit alleen een Error als er
// óók geen lokale cache is.
export async function loadFactionDb(faction) {
  if (backend.hasBackend() && backend.getToken()) {
    try {
      const remote = await backend.getShared(factionKey(faction));
      const db = normalize(remote);
      saveLocal(faction, db);
      return { db, offline: false };
    } catch (e) {
      const cached = getLocal(faction);
      if (cached) return { db: normalize(cached), offline: true };
      throw e;
    }
  }
  return { db: normalize(getLocal(faction)), offline: !backend.hasBackend() ? false : true };
}

export async function saveFactionDb(faction, db) {
  saveLocal(faction, db);
  if (backend.hasBackend() && backend.getToken()) {
    await backend.setShared(factionKey(faction), db);
  }
}

// ---------- Delen vanuit set-up: read-modify-write met upsert op naam ----------
const sameName = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function upsertByName(list, item) {
  const i = list.findIndex((x) => sameName(x.name, item.name));
  if (i >= 0) list[i] = item;
  else list.push(item);
}

function cleanCopy(item, extra = {}) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uid();
  return Object.assign(copy, extra);
}

export async function shareModel(faction, model) {
  const { db } = await loadFactionDb(faction);
  upsertByName(db.models, cleanCopy(model, { enhancementIds: [] }));
  await saveFactionDb(faction, db);
}

export async function shareEnhancement(faction, enh) {
  const { db } = await loadFactionDb(faction);
  upsertByName(db.enhancements, cleanCopy(enh));
  await saveFactionDb(faction, db);
}

export async function shareRule(faction, subfaction, rule) {
  const { db } = await loadFactionDb(faction);
  if (subfaction) {
    db.subfactions[subfaction] = db.subfactions[subfaction] || { rules: [] };
    upsertByName(db.subfactions[subfaction].rules, cleanCopy(rule));
  } else {
    upsertByName(db.factionRules, cleanCopy(rule));
  }
  await saveFactionDb(faction, db);
}
