import { icon } from "./icons.js";
import { uid } from "./storage.js";
import { resultLabel } from "./scorecard.js";

// Toernooi-mode: een toernooi is een reeks companion-games voor één leger.
// state.data.tournaments = [{ id, name, armyId, days, rounds, createdAt,
//   games: [{ id, name, game, done, archivedId }] }]
// Elke game speel je als een volledige companion-game (via state.tournamentRef);
// afgeronde games komen — getagd met tournamentId — in het archief.

const FORMATS = [
  { key: "1d3", label: "1 dag · 3 games", days: 1, rounds: 3 },
  { key: "2d5", label: "2 dagen · 5 games", days: 2, rounds: 5 },
  { key: "3d8", label: "3 dagen · 8 games", days: 3, rounds: 8 },
  { key: "custom", label: "Aangepast", days: 1, rounds: 3 },
];

export function renderTournament(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  state.data.tournaments = state.data.tournaments || [];
  let openId = state.tournamentOpenId || null;
  let creating = false;

  const tournaments = () => state.data.tournaments;
  const armyName = (id) => (state.data.armies.find((a) => a.id === id) || {}).name || "onbekend leger";
  const isPast = (t) => (t.games || []).length > 0 && (t.games || []).every((g) => g.done);
  const recFor = (g) => (state.data.gameArchive || []).find((r) => r.id === g.archivedId);

  function draw() {
    app.innerHTML = "";
    window.scrollTo(0, 0);
    const header = el(`<div class="topbar">
      <span class="title">${icon("trophy", 18)} Toernooi</span>
      <button class="small" id="btn-back">${icon("back")} Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => {
      if (creating) { creating = false; draw(); }
      else if (openId) { openId = null; draw(); }
      else navigate("home");
    });
    app.appendChild(header);

    if (creating) return drawCreate();
    if (openId) {
      const t = tournaments().find((x) => x.id === openId);
      if (t) return drawDetail(t);
      openId = null;
    }
    drawList();
  }

  // ---------- Lijst ----------
  function drawList() {
    const active = tournaments().filter((t) => !isPast(t));
    const past = tournaments().filter((t) => isPast(t));

    app.appendChild(el(`<h2>Toernooien</h2>`));
    if (!active.length) app.appendChild(el(`<p class="empty">Nog geen lopend toernooi. Maak er een aan!</p>`));
    for (const t of active) app.appendChild(tournamentCard(t));

    const newBtn = el(`<button class="primary bigbtn">${icon("plus")} Nieuw toernooi</button>`);
    newBtn.addEventListener("click", () => { creating = true; draw(); });
    app.appendChild(newBtn);

    if (past.length) {
      const det = el(`<details class="type-group" style="margin-top:16px">
        <summary>Voorbije toernooien <span class="count">(${past.length})</span></summary>
        <div data-past></div>
      </details>`);
      const box = det.querySelector("[data-past]");
      for (const t of past) box.appendChild(tournamentCard(t));
      app.appendChild(det);
    }
  }

  function tournamentCard(t) {
    const done = (t.games || []).filter((g) => g.done).length;
    const total = (t.games || []).length;
    const st = standing(t);
    const card = el(`<div class="card clickable">
      <div class="card-header">
        <div>
          <h3>${esc(t.name)}</h3>
          <div class="subtitle">${esc(armyName(t.armyId))} · ${t.days} dag${t.days === 1 ? "" : "en"} · ${done}/${total} gespeeld</div>
        </div>
        <span class="chip tag${done === total ? "" : " dim"}">${st.w}–${st.l}–${st.d}</span>
      </div>
    </div>`);
    card.addEventListener("click", () => { openId = t.id; draw(); });
    return card;
  }

  // ---------- Aanmaken ----------
  function drawCreate() {
    if (!state.data.armies.length) {
      app.appendChild(el(`<p class="empty">Je hebt nog geen legers. Maak eerst een leger aan om een toernooi te starten.</p>`));
      return;
    }
    let fmtKey = "1d3";
    const wrap = el(`<div class="card">
      <h2>Nieuw toernooi</h2>
      <label>Naam van het toernooi</label>
      <input type="text" id="t-name" placeholder="bijv. GT Nijmegen" />
      <label>Formaat</label>
      <select id="t-fmt">${FORMATS.map((f) => `<option value="${f.key}">${f.label}</option>`).join("")}</select>
      <div class="row" id="t-custom" style="display:none">
        <div><label>Dagen</label><input type="number" id="t-days" min="1" value="1" /></div>
        <div><label>Aantal games</label><input type="number" id="t-rounds" min="1" value="3" /></div>
      </div>
      <label>Leger</label>
      <select id="t-army">${state.data.armies.map((a) => `<option value="${a.id}">${esc(a.name || "(naamloos)")} — ${esc(a.faction)}</option>`).join("")}</select>
      <div class="btnrow">
        <button class="primary" id="t-create">${icon("check")} Toernooi aanmaken</button>
        <button id="t-cancel">Annuleren</button>
      </div>
    </div>`);
    const fmtSel = wrap.querySelector("#t-fmt");
    const custom = wrap.querySelector("#t-custom");
    fmtSel.addEventListener("change", () => {
      fmtKey = fmtSel.value;
      custom.style.display = fmtKey === "custom" ? "flex" : "none";
    });
    wrap.querySelector("#t-cancel").addEventListener("click", () => { creating = false; draw(); });
    wrap.querySelector("#t-create").addEventListener("click", () => {
      const name = wrap.querySelector("#t-name").value.trim();
      if (!name) { wrap.querySelector("#t-name").focus(); return; }
      const armyId = wrap.querySelector("#t-army").value;
      const fmt = FORMATS.find((f) => f.key === fmtKey);
      let days = fmt.days, rounds = fmt.rounds;
      if (fmtKey === "custom") {
        days = Math.max(1, parseInt(wrap.querySelector("#t-days").value) || 1);
        rounds = Math.max(1, parseInt(wrap.querySelector("#t-rounds").value) || 1);
      }
      const t = {
        id: uid(), name, armyId, days, rounds, createdAt: Date.now(),
        games: Array.from({ length: rounds }, (_, i) => ({
          id: uid(), name: `${name} game ${i + 1}`, game: null, done: false, archivedId: null,
        })),
      };
      tournaments().push(t);
      saveData();
      creating = false;
      openId = t.id;
      draw();
    });
    app.appendChild(wrap);
  }

  // ---------- Detail ----------
  function drawDetail(t) {
    const st = standing(t);
    app.appendChild(el(`<div class="card">
      <h2>${esc(t.name)}</h2>
      <div class="subtitle">${esc(armyName(t.armyId))} · ${t.days} dag${t.days === 1 ? "" : "en"} · ${t.rounds} games</div>
      <div class="scoreline" style="justify-content:flex-start;gap:16px;padding-top:10px">
        <span>Gewonnen <strong>${st.w}</strong></span>
        <span>Verloren <strong>${st.l}</strong></span>
        <span>Gelijk <strong>${st.d}</strong></span>
        <span>VP <strong>${st.vp}</strong></span>
      </div>
    </div>`));

    for (const g of t.games) app.appendChild(gameRow(t, g));

    const delWrap = el(`<div class="btnrow" style="margin-top:16px"><button class="danger small">${icon("trash")} Toernooi verwijderen</button></div>`);
    delWrap.querySelector("button").addEventListener("click", () => {
      if (!confirm(`Toernooi "${t.name}" verwijderen? De games in het archief blijven staan.`)) return;
      state.data.tournaments = tournaments().filter((x) => x.id !== t.id);
      saveData();
      openId = null;
      draw();
    });
    app.appendChild(delWrap);
  }

  function gameRow(t, g) {
    const rec = recFor(g);
    let statusHtml, btnLabel;
    if (g.done && rec) {
      const res = resultLabel(rec);
      statusHtml = `<div class="subtitle">${rec.totals.player}–${rec.totals.enemy} · ${esc(res.text)}${rec.opponent?.name ? " vs " + esc(rec.opponent.name) : ""}</div>`;
      btnLabel = `${icon("edit")} Bekijken`;
    } else if (g.game) {
      statusHtml = `<div class="subtitle">Bezig — battleround ${g.game.round || 1}</div>`;
      btnLabel = `${icon("play")} Verder spelen`;
    } else {
      statusHtml = `<div class="subtitle">Nog te spelen</div>`;
      btnLabel = `${icon("play")} Spelen`;
    }
    const chipCls = g.done ? (rec && resultLabel(rec).win === true ? "" : "dim") : "dim";
    const row = el(`<div class="card">
      <div class="card-header">
        <div><h3>${esc(g.name)}</h3>${statusHtml}</div>
        <span class="chip tag ${chipCls}">${g.done ? "Klaar" : g.game ? "Bezig" : "Open"}</span>
      </div>
      <div class="btnrow"><button class="primary small" data-play>${btnLabel}</button></div>
    </div>`);
    row.querySelector("[data-play]").addEventListener("click", () => {
      saveData();
      navigate("companion", { armyId: t.armyId, tournamentRef: { tid: t.id, gid: g.id }, tournamentOpenId: null });
    });
    return row;
  }

  // Stand: W/L/D + totale VP van de speler over afgeronde games.
  function standing(t) {
    let w = 0, l = 0, d = 0, vp = 0;
    for (const g of t.games || []) {
      if (!g.done) continue;
      const rec = recFor(g);
      if (!rec) continue;
      vp += rec.totals.player || 0;
      const diff = (rec.totals.player || 0) - (rec.totals.enemy || 0);
      if (diff > 0) w++; else if (diff < 0) l++; else d++;
    }
    return { w, l, d, vp };
  }

  draw();
}
