import * as store from "./storage.js";
import { AOS_FACTIONS } from "./factions.js";
import { renderSetup } from "./setup.js";
import { renderCompanion } from "./companion.js";

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
}

function login(name) {
  state.user = { name, isAdmin: name.toLowerCase() === store.SUPERADMIN.name.toLowerCase() };
  state.data = store.getUserData(name);
  store.setSession(name);
  navigate("home");
}

function logout() {
  store.clearSession();
  state.user = null;
  state.data = null;
  navigate("login");
}

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

  const doLogin = () => {
    const name = nameInput.value.trim();
    if (!name) { err.textContent = "Vul je naam in."; return; }
    if (isAdminName()) {
      if (pwInput.value !== store.SUPERADMIN.password) { err.textContent = "Onjuist wachtwoord."; return; }
      login(store.SUPERADMIN.name);
      return;
    }
    const account = store.findAccount(name);
    if (!account) { err.textContent = "Geen account gevonden met deze naam."; return; }
    login(account.name);
  };
  wrap.querySelector("#login-btn").addEventListener("click", doLogin);
  wrap.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  nameInput.focus();
}

function renderHome() {
  const header = el(`<div class="topbar">
    <span class="title">⚔️ AoS Companion</span>
    <div style="display:flex;gap:6px">
      ${state.user.isAdmin ? `<button class="small" id="btn-admin">Accounts</button>` : ""}
      <button class="small" id="btn-logout">Uitloggen (${esc(state.user.name)})</button>
    </div>
  </div>`);
  app.appendChild(header);
  header.querySelector("#btn-logout").addEventListener("click", logout);
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
    <p class="subtitle" style="margin-top:10px">Let op: accounts en legerdata staan lokaal op het apparaat (localStorage).
    Een account dat je hier aanmaakt bestaat alleen op dit apparaat — op een ander apparaat kan iemand gewoon
    zijn naam invoeren zodra daar ooit met die naam is ingelogd, of je maakt het account daar opnieuw aan.</p>
  </div>`);
  app.appendChild(card);

  const list = el(`<div class="card"><h3>Bestaande accounts</h3><div id="acc-list"></div></div>`);
  app.appendChild(list);

  const refreshList = () => {
    const target = list.querySelector("#acc-list");
    target.innerHTML = "";
    const accounts = store.getAccounts();
    if (!accounts.length) target.appendChild(el(`<p class="empty">Nog geen accounts.</p>`));
    for (const a of accounts) {
      const row = el(`<div class="card-header" style="padding:6px 0;border-bottom:1px dashed var(--border)">
        <span>${esc(a.name)} <span class="subtitle">(ww: ${esc(a.password)})</span></span>
        <button class="danger small">Verwijderen</button>
      </div>`);
      row.querySelector("button").addEventListener("click", () => {
        if (confirm(`Account "${a.name}" en alle bijbehorende legers verwijderen?`)) {
          store.deleteAccount(a.name);
          refreshList();
        }
      });
      target.appendChild(row);
    }
  };
  refreshList();

  card.querySelector("#acc-add").addEventListener("click", () => {
    const name = card.querySelector("#acc-name").value.trim();
    const pw = card.querySelector("#acc-pw").value.trim();
    const err = card.querySelector("#acc-err");
    if (!name || !pw) { err.textContent = "Vul naam en wachtwoord in."; return; }
    try {
      store.addAccount(name, pw);
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
  login(session);
} else {
  render();
}
