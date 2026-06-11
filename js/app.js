import * as store from "./storage.js";
import * as backend from "./backend.js";
import { AOS_FACTIONS } from "./factions.js";
import { renderSetup } from "./setup.js";
import { renderCompanion } from "./companion.js";
import { renderDatabase } from "./database.js";

const app = document.getElementById("app");

// Eenvoudige router-state
const state = {
  screen: "login", // login | home | admin | setup | companion
  user: null,      // { name, isAdmin }
  data: null,      // { armies, modelLibrary }
  armyId: null,
};

export function navigate(screen, opts = {}) {
  Object.assign(state, opts, { screen });
  render();
}

export function saveData() {
  store.saveUserData(state.user.name, state.data);
  // Met backend: ook (debounced) naar de server syncen
  if (backend.hasBackend() && backend.getToken()) {
    backend.pushData(state.data);
  }
}

async function login(name, isAdmin) {
  state.user = { name, isAdmin };
  state.data = store.getUserData(name);
  // Met backend: serverdata is leidend (en wordt lokaal gecachet)
  if (backend.hasBackend() && backend.getToken()) {
    try {
      const remote = await backend.fetchData();
      if (remote) {
        state.data = remote;
        store.saveUserData(name, remote);
      } else if (state.data.armies.length) {
        // Eerste keer online met bestaande lokale data: upload die
        backend.pushData(state.data);
      }
    } catch (e) {
      console.warn("Backend niet bereikbaar, lokale data wordt gebruikt:", e.message);
    }
  }
  store.setSession(name, isAdmin);
  navigate("home");
}

function logout() {
  store.clearSession();
  backend.logout();
  state.user = null;
  state.data = null;
  navigate("login");
}

// ---------- Thema ----------
// Apparaat-instelling (localStorage, synct bewust niet mee): donker, licht of
// meekijken met het systeem.
const THEME_KEY = "aoscomp_theme"; // "dark" | "light" | "system"
const lightMedia = window.matchMedia("(prefers-color-scheme: light)");

const getTheme = () => localStorage.getItem(THEME_KEY) || "dark";
const themeLabel = () => ({ dark: "🌙 Donker", light: "☀️ Licht", system: "🖥️ Systeem" }[getTheme()]);

function applyTheme() {
  const mode = getTheme();
  const light = mode === "light" || (mode === "system" && lightMedia.matches);
  document.body.classList.toggle("theme-light", light);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = light ? "#f2efe8" : "#15161c";
}

function cycleTheme() {
  const order = ["dark", "light", "system"];
  localStorage.setItem(THEME_KEY, order[(order.indexOf(getTheme()) + 1) % order.length]);
  applyTheme();
}

lightMedia.addEventListener("change", () => {
  if (getTheme() === "system") applyTheme();
});
applyTheme();

// ---------- Helpers ----------
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Screens ----------
function render() {
  app.innerHTML = "";
  window.scrollTo(0, 0);
  switch (state.screen) {
    case "login": return renderLogin();
    case "home": return renderHome();
    case "admin": return renderAdmin();
    case "setup": return renderSetup({ state, app, navigate, saveData, el, esc });
    case "companion": return renderCompanion({ state, app, navigate, saveData, el, esc });
    case "database": return renderDatabase({ state, app, navigate, saveData, el, esc });
  }
}

function renderLogin() {
  const wrap = el(`<div class="login-wrap">
    <h1>⚔️ AoS Companion</h1>
    <p class="subtitle" style="text-align:center">Voer je naam in om bij je legers te komen.</p>
    <div class="card">
      <label>Naam</label>
      <input type="text" id="login-name" autocomplete="off" />
      <div id="pw-block" style="display:none">
        <label>Wachtwoord</label>
        <input type="password" id="login-pw" />
      </div>
      <p id="login-err" style="color:var(--red);min-height:1.2em;font-size:0.9rem"></p>
      <button class="primary bigbtn" id="login-btn">Inloggen</button>
    </div>
  </div>`);
  app.appendChild(wrap);

  const nameInput = wrap.querySelector("#login-name");
  const pwBlock = wrap.querySelector("#pw-block");
  const pwInput = wrap.querySelector("#login-pw");
  const err = wrap.querySelector("#login-err");

  const isAdminName = () => nameInput.value.trim().toLowerCase() === store.SUPERADMIN.name.toLowerCase();
  nameInput.addEventListener("input", () => {
    pwBlock.style.display = isAdminName() ? "block" : "none";
  });

  const doLogin = async () => {
    const name = nameInput.value.trim();
    if (!name) { err.textContent = "Vul je naam in."; return; }

    // Met backend: de server bepaalt of naam/wachtwoord klopt
    if (backend.hasBackend()) {
      err.textContent = "Bezig met inloggen…";
      try {
        const result = await backend.login(name, isAdminName() ? pwInput.value : undefined);
        await login(name, result.isAdmin);
      } catch (e) {
        err.textContent = e.message === "Failed to fetch"
          ? "Backend niet bereikbaar. Controleer je internetverbinding."
          : e.message;
      }
      return;
    }

    // Zonder backend: lokale accounts
    if (isAdminName()) {
      if (pwInput.value !== store.SUPERADMIN.password) { err.textContent = "Onjuist wachtwoord."; return; }
      await login(store.SUPERADMIN.name, true);
      return;
    }
    const account = store.findAccount(name);
    if (!account) { err.textContent = "Geen account gevonden met deze naam."; return; }
    await login(account.name, false);
  };
  wrap.querySelector("#login-btn").addEventListener("click", doLogin);
  wrap.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  nameInput.focus();
}

function renderHome() {
  const header = el(`<div class="topbar">
    <span class="title">⚔️ AoS Companion</span>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
      <button class="small" id="btn-theme" title="Wissel tussen donker, licht en systeem">${themeLabel()}</button>
      <button class="small" id="btn-db">📚 Database</button>
      ${state.user.isAdmin ? `<button class="small" id="btn-admin">Accounts</button>` : ""}
      <button class="small" id="btn-logout">Uitloggen (${esc(state.user.name)})</button>
    </div>
  </div>`);
  app.appendChild(header);
  header.querySelector("#btn-logout").addEventListener("click", logout);
  header.querySelector("#btn-theme").addEventListener("click", (e) => {
    cycleTheme();
    e.target.textContent = themeLabel();
  });
  header.querySelector("#btn-db").addEventListener("click", () => navigate("database", { armyId: null, dbReturn: "home" }));
  if (state.user.isAdmin) header.querySelector("#btn-admin").addEventListener("click", () => navigate("admin"));

  app.appendChild(el(`<h2>Mijn legers</h2>`));

  if (!state.data.armies.length) {
    app.appendChild(el(`<p class="empty">Nog geen legers. Maak je eerste leger aan!</p>`));
  }

  for (const army of state.data.armies) {
    const modelCount = army.models.length;
    const card = el(`<div class="card">
      <div class="card-header">
        <div>
          <h3>${esc(army.name)}</h3>
          <div class="subtitle">${esc(army.faction)}${army.subfaction ? " — " + esc(army.subfaction) : ""} · ${modelCount} model${modelCount === 1 ? "" : "s"}</div>
        </div>
      </div>
      <div class="btnrow">
        <button class="primary" data-act="play">▶ Spelen</button>
        <button data-act="edit">✎ Set-up</button>
        <button class="danger small" data-act="del">Verwijderen</button>
      </div>
    </div>`);
    card.querySelector('[data-act="play"]').addEventListener("click", () => navigate("companion", { armyId: army.id }));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => navigate("setup", { armyId: army.id }));
    card.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (confirm(`Leger "${army.name}" verwijderen?`)) {
        state.data.armies = state.data.armies.filter((a) => a.id !== army.id);
        saveData();
        render();
      }
    });
    app.appendChild(card);
  }

  const newBtn = el(`<button class="primary bigbtn">+ Nieuw leger</button>`);
  newBtn.addEventListener("click", () => {
    const army = {
      id: store.uid(),
      name: "",
      faction: Object.keys(AOS_FACTIONS)[0],
      subfaction: "",
      models: [],
      enhancements: [],
      spellLore: null,
      manifestationLore: null,
      prayerLore: null,
      factionRules: [],
      subfactionRules: [],
    };
    state.data.armies.push(army);
    saveData();
    navigate("setup", { armyId: army.id });
  });
  app.appendChild(newBtn);
}

function renderAdmin() {
  const header = el(`<div class="topbar">
    <span class="title">Accountbeheer</span>
    <button class="small" id="btn-back">← Terug</button>
  </div>`);
  header.querySelector("#btn-back").addEventListener("click", () => navigate("home"));
  app.appendChild(header);

  const card = el(`<div class="card">
    <h3>Nieuw account</h3>
    <label>Naam</label>
    <input type="text" id="acc-name" autocomplete="off" />
    <label>Wachtwoord</label>
    <input type="text" id="acc-pw" autocomplete="off" />
    <p id="acc-err" style="color:var(--red);min-height:1.2em;font-size:0.9rem"></p>
    <button class="primary" id="acc-add">Account aanmaken</button>
    <p class="subtitle" style="margin-top:10px">${backend.hasBackend()
      ? "Accounts staan op de server: ze werken op ieder apparaat en data synct automatisch."
      : "Let op: accounts en legerdata staan lokaal op het apparaat (localStorage). Een account dat je hier aanmaakt bestaat alleen op dit apparaat."}</p>
  </div>`);
  app.appendChild(card);

  const list = el(`<div class="card"><h3>Bestaande accounts</h3><div id="acc-list"></div></div>`);
  app.appendChild(list);

  const refreshList = async () => {
    const target = list.querySelector("#acc-list");
    target.innerHTML = "";
    let accounts;
    try {
      accounts = backend.hasBackend() ? await backend.listAccounts() : store.getAccounts();
    } catch (e) {
      target.appendChild(el(`<p class="empty" style="color:var(--red)">Accounts ophalen mislukt: ${esc(e.message)}</p>`));
      return;
    }
    if (!accounts.length) target.appendChild(el(`<p class="empty">Nog geen accounts.</p>`));
    for (const a of accounts) {
      const row = el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span>${esc(a.name)} <span class="subtitle">(ww: ${esc(a.password)})</span></span>
        <button class="danger small">Verwijderen</button>
      </div>`);
      row.querySelector("button").addEventListener("click", async () => {
        if (!confirm(`Account "${a.name}" en alle bijbehorende legers verwijderen?`)) return;
        try {
          if (backend.hasBackend()) await backend.deleteAccount(a.name);
          else store.deleteAccount(a.name);
          refreshList();
        } catch (e) {
          alert("Verwijderen mislukt: " + e.message);
        }
      });
      target.appendChild(row);
    }
  };
  refreshList();

  card.querySelector("#acc-add").addEventListener("click", async () => {
    const name = card.querySelector("#acc-name").value.trim();
    const pw = card.querySelector("#acc-pw").value.trim();
    const err = card.querySelector("#acc-err");
    if (!name || !pw) { err.textContent = "Vul naam en wachtwoord in."; return; }
    try {
      if (backend.hasBackend()) await backend.createAccount(name, pw);
      else store.addAccount(name, pw);
      err.textContent = "";
      card.querySelector("#acc-name").value = "";
      card.querySelector("#acc-pw").value = "";
      refreshList();
    } catch (e) {
      err.textContent = e.message;
    }
  });
}

// ---------- Init ----------
const session = store.getSession();
if (session) {
  login(session.name, session.isAdmin);
} else {
  render();
}
