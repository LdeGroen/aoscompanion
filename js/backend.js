import { API_URL, APP_KEY } from "./config.js";

// Client voor de AppSync-backend. Alle functies gooien een Error bij mislukking.

const TOKEN_KEY = "aoscomp_api_token";

export function hasBackend() {
  return !!API_URL;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function call(action, body = {}, withToken = true, tokenOverride = null) {
  const headers = { "Content-Type": "application/json" };
  const token = tokenOverride || getToken();
  if (withToken && token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api?action=${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    const err = new Error(json.error || `Backend-fout (${res.status})`);
    err.status = res.status;
    err.payload = json; // bij een conflict (409) zit hier de actuele serverdata in
    throw err;
  }
  return json;
}

export async function login(name, password) {
  const result = await call("login", { name, password }, false);
  localStorage.setItem(TOKEN_KEY, result.token);
  return result; // { ok, token, isAdmin }
}

export function logout() {
  // Nog lopende (debounced) sync annuleren, anders kan die data van de
  // vorige gebruiker onder het token van de volgende gebruiker pushen.
  clearTimeout(pushTimer);
  localStorage.removeItem(TOKEN_KEY);
}

// De serverversie waarop onze lokale data is gebaseerd. Die sturen we bij iedere
// push mee; staat er inmiddels een nieuwere versie op de server (een ander
// apparaat heeft geschreven), dan weigert de server en krijgen we die versie
// terug in plaats van dat we hem overschrijven. Zo kan een app die met oude
// gegevens in het geheugen staat nooit meer je archief wegvagen.
let baseUpdatedAt = null;
let onConflict = null; // (remoteData) => void — gezet door app.js

export function setConflictHandler(fn) { onConflict = fn; }
export function getBaseUpdatedAt() { return baseUpdatedAt; }
export function markBase(updatedAt) { baseUpdatedAt = updatedAt || null; }

export async function fetchData() {
  const result = await call("getData", { app: APP_KEY });
  baseUpdatedAt = result.updatedAt || null;
  return result.data; // null als er nog niets staat
}

// Debounced zodat tikken in een invoerveld niet per toetsaanslag een request doet.
// Het token wordt bij het inplannen vastgelegd, zodat een late push nooit
// onder het token van een inmiddels andere ingelogde gebruiker belandt.
let pushTimer = null;
export function pushData(data) {
  clearTimeout(pushTimer);
  const snapshot = JSON.stringify(data);
  const token = getToken();
  pushTimer = setTimeout(async () => {
    try {
      const res = await call("setData", { app: APP_KEY, data: JSON.parse(snapshot), baseUpdatedAt }, true, token);
      baseUpdatedAt = res.updatedAt || baseUpdatedAt;
    } catch (e) {
      if (e.status === 409 && e.payload?.conflict) {
        // Iemand anders (of dit apparaat in een ander tabblad) was ons voor.
        baseUpdatedAt = e.payload.updatedAt || null;
        if (onConflict) onConflict(e.payload.data);
        else console.warn("Sync-conflict: serverdata is nieuwer, lokale wijziging niet gepusht.");
        return;
      }
      console.warn("Sync naar backend mislukt (lokaal wel opgeslagen):", e.message);
    }
  }, 800);
}

// Gedeelde data (de faction-database): voor alle accounts toegankelijk.
export async function getShared(key) {
  const result = await call("getShared", { app: APP_KEY, key });
  return result.data; // null als er nog niets staat
}

export async function setShared(key, data) {
  await call("setShared", { app: APP_KEY, key, data });
}

export async function listShared() {
  return (await call("listShared", { app: APP_KEY })).keys; // [{key, updatedAt}]
}

export async function listAccounts() {
  return (await call("listAccounts")).accounts;
}

export async function createAccount(name, password) {
  await call("createAccount", { name, password });
}

export async function deleteAccount(name) {
  await call("deleteAccount", { name });
}

export async function setAdminPassword(password) {
  await call("setAdminPassword", { password });
}
