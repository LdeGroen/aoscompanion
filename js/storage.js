// Opslag: alle data staat in localStorage op het apparaat zelf.
// Let op: GitHub Pages heeft geen server, dus accounts en legers zijn per apparaat.

const ACCOUNTS_KEY = "aoscomp_accounts";
const SESSION_KEY = "aoscomp_session";

export const SUPERADMIN = { name: "Luc", password: "Ludotjek1991" };

export function getAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function addAccount(name, password) {
  const accounts = getAccounts();
  if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("Er bestaat al een account met deze naam.");
  }
  accounts.push({ name, password });
  saveAccounts(accounts);
}

export function deleteAccount(name) {
  saveAccounts(getAccounts().filter((a) => a.name !== name));
  localStorage.removeItem(userDataKey(name));
}

export function findAccount(name) {
  if (name.toLowerCase() === SUPERADMIN.name.toLowerCase()) {
    return { ...SUPERADMIN, isAdmin: true };
  }
  return getAccounts().find((a) => a.name.toLowerCase() === name.toLowerCase()) || null;
}

export function setSession(name) {
  localStorage.setItem(SESSION_KEY, name);
}

export function getSession() {
  return localStorage.getItem(SESSION_KEY);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function userDataKey(name) {
  return `aoscomp_data_${name.toLowerCase()}`;
}

export function getUserData(name) {
  try {
    const data = JSON.parse(localStorage.getItem(userDataKey(name)));
    return data || { armies: [], modelLibrary: [] };
  } catch {
    return { armies: [], modelLibrary: [] };
  }
}

export function saveUserData(name, data) {
  localStorage.setItem(userDataKey(name), JSON.stringify(data));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
