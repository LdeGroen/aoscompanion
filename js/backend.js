import { API_URL, APP_KEY } from "./config.js";

// Client voor de AppSync-backend. Alle functies gooien een Error bij mislukking.

const TOKEN_KEY = "aoscomp_api_token";

export function hasBackend() {
  return !!API_URL;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function call(action, body = {}, withToken = true) {
  const headers = { "Content-Type": "application/json" };
  if (withToken && getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
  const res = await fetch(`${API_URL}/index.php?action=${action}`, {
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
  localStorage.removeItem(TOKEN_KEY);
}

export async function fetchData() {
  const result = await call("getData", { app: APP_KEY });
  return result.data; // null als er nog niets staat
}

// Debounced zodat tikken in een invoerveld niet per toetsaanslag een request doet.
let pushTimer = null;
export function pushData(data) {
  clearTimeout(pushTimer);
  const snapshot = JSON.stringify(data);
  pushTimer = setTimeout(() => {
    call("setData", { app: APP_KEY, data: JSON.parse(snapshot) }).catch((e) =>
      console.warn("Sync naar backend mislukt (lokaal wel opgeslagen):", e.message)
    );
  }, 800);
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
