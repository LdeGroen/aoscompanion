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
  if (!json.ok) throw new Error(json.error || `Backend-fout (${res.status})`);
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

export async function fetchData() {
  const result = await call("getData", { app: APP_KEY });
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
  pushTimer = setTimeout(() => {
    call("setData", { app: APP_KEY, data: JSON.parse(snapshot) }, true, token).catch((e) =>
      console.warn("Sync naar backend mislukt (lokaal wel opgeslagen):", e.message)
    );
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
