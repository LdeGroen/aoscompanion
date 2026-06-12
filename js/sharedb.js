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
    lores: [],            // {id, name, kind: spell|manifestation|prayer, entries, addedBy}
  };
}

function normalize(dbObj) {
  const db = dbObj || emptyFactionDb();
  db.factionRules = db.factionRules || [];
  db.subfactions = db.subfactions || {};
  db.models = db.models || [];
  db.enhancements = db.enhancements || [];
  db.lores = db.lores || [];
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

// ---------- Universal lores ----------
// Universal manifestation lores zijn door iedere faction te kiezen en staan
// daarom in een eigen gedeelde blob (key "universal") in plaats van per faction.
const UNIVERSAL_KEY = "universal";

function normalizeUniversal(obj) {
  const db = obj || {};
  db.lores = db.lores || [];   // alleen manifestation lores
  db.models = db.models || []; // alleen universal manifestation-models
  return db;
}

export async function loadUniversalDb() {
  if (backend.hasBackend() && backend.getToken()) {
    try {
      const remote = await backend.getShared(UNIVERSAL_KEY);
      const db = normalizeUniversal(remote);
      localStorage.setItem(LOCAL_PREFIX + UNIVERSAL_KEY, JSON.stringify(db));
      return { db, offline: false };
    } catch (e) {
      const cached = localStorage.getItem(LOCAL_PREFIX + UNIVERSAL_KEY);
      if (cached) return { db: normalizeUniversal(JSON.parse(cached)), offline: true };
      throw e;
    }
  }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LOCAL_PREFIX + UNIVERSAL_KEY)); } catch {}
  return { db: normalizeUniversal(cached), offline: false };
}

export async function saveUniversalDb(db) {
  localStorage.setItem(LOCAL_PREFIX + UNIVERSAL_KEY, JSON.stringify(db));
  if (backend.hasBackend() && backend.getToken()) {
    await backend.setShared(UNIVERSAL_KEY, db);
  }
}

// ---------- Generieke gedeelde blobs (bijv. "gamedata") ----------
// Zelfde patroon als de faction-/universal-blobs: backend leidend,
// localStorage als offline-cache.
export async function loadSharedBlob(key, normalize) {
  if (backend.hasBackend() && backend.getToken()) {
    try {
      const remote = await backend.getShared(key);
      const db = normalize(remote);
      localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(db));
      return { db, offline: false };
    } catch (e) {
      const cached = localStorage.getItem(LOCAL_PREFIX + key);
      if (cached) return { db: normalize(JSON.parse(cached)), offline: true };
      throw e;
    }
  }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LOCAL_PREFIX + key)); } catch {}
  return { db: normalize(cached), offline: false };
}

export async function saveSharedBlob(key, db) {
  localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(db));
  if (backend.hasBackend() && backend.getToken()) {
    await backend.setShared(key, db);
  }
}

// ---------- Eigenaarschap ----------
// Iedere gedeelde entry onthoudt wie hem deelde (addedBy). Bewerken en
// verwijderen mag alleen door die persoon of door de superadmin. Entries van
// vóór deze feature hebben geen addedBy — die kan alleen de admin aanpassen.
export function canEditEntry(item, user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return !!item.addedBy && item.addedBy.toLowerCase() === user.name.toLowerCase();
}

// ---------- Delen vanuit set-up: read-modify-write met upsert op naam ----------
const sameName = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function upsertByName(list, item, user) {
  const i = list.findIndex((x) => sameName(x.name, item.name));
  if (i >= 0) {
    if (!canEditEntry(list[i], user)) {
      throw new Error(`"${item.name}" staat al in de database (gedeeld door ${list[i].addedBy || "iemand anders"}). Alleen diegene of de superadmin kan hem aanpassen.`);
    }
    item.addedBy = list[i].addedBy || user.name;
    list[i] = item;
  } else {
    item.addedBy = user.name;
    list.push(item);
  }
}

function cleanCopy(item, extra = {}) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uid();
  return Object.assign(copy, extra);
}

export async function shareModel(faction, model, user) {
  const item = cleanCopy(model, { enhancementIds: [] });
  // Universal manifestations zijn niet faction-gebonden en gaan naar de
  // universal-blob, zodat ze bij iedere faction beschikbaar zijn.
  if (model.type === "Manifestation" && model.universal) {
    const { db } = await loadUniversalDb();
    upsertByName(db.models, item, user);
    await saveUniversalDb(db);
  } else {
    delete item.universal;
    const { db } = await loadFactionDb(faction);
    upsertByName(db.models, item, user);
    await saveFactionDb(faction, db);
  }
}

export async function shareEnhancement(faction, enh, user) {
  const { db } = await loadFactionDb(faction);
  upsertByName(db.enhancements, cleanCopy(enh), user);
  await saveFactionDb(faction, db);
}

// Lores worden ge-upsert op (kind, naam). Een universal manifestation lore
// gaat naar de universal-blob, alle andere lores naar de faction-database.
function upsertLore(list, item, user) {
  const i = list.findIndex((x) => x.kind === item.kind && sameName(x.name, item.name));
  if (i >= 0) {
    if (!canEditEntry(list[i], user)) {
      throw new Error(`"${item.name}" staat al in de database (gedeeld door ${list[i].addedBy || "iemand anders"}). Alleen diegene of de superadmin kan hem aanpassen.`);
    }
    item.addedBy = list[i].addedBy || user.name;
    list[i] = item;
  } else {
    item.addedBy = user.name;
    list.push(item);
  }
}

export async function shareLore(faction, kind, lore, user) {
  const item = cleanCopy(lore);
  item.kind = kind;
  if (kind === "manifestation" && lore.universal) {
    item.universal = true;
    const { db } = await loadUniversalDb();
    upsertLore(db.lores, item, user);
    await saveUniversalDb(db);
  } else {
    delete item.universal;
    const { db } = await loadFactionDb(faction);
    upsertLore(db.lores, item, user);
    await saveFactionDb(faction, db);
  }
}

export async function shareRule(faction, subfaction, rule, user) {
  const { db } = await loadFactionDb(faction);
  if (subfaction) {
    db.subfactions[subfaction] = db.subfactions[subfaction] || { rules: [] };
    upsertByName(db.subfactions[subfaction].rules, cleanCopy(rule), user);
  } else {
    upsertByName(db.factionRules, cleanCopy(rule), user);
  }
  await saveFactionDb(faction, db);
}
