import { icon } from "./icons.js";
import { uid } from "./storage.js";
import { resultLabel } from "./scorecard.js";
import { buildListSnapshot, listBlock } from "./gamelist.js";
import { loadGamedata } from "./battleplans.js";
import { openBattleplanModal } from "./battleplanview.js";

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
  let editingMeta = false;

  const tournaments = () => state.data.tournaments;

  // Battleplans komen uit de gedeelde gamedata-blob. Bij een toernooi liggen ze
  // vooraf vast, dus je kunt ze hier per ronde invullen en tijdens het toernooi
  // teruglezen — inclusief kaartje, twist en scoreschema.
  let battleplans = null;   // null = nog aan het laden, [] = niet gelukt
  let onBattleplansReady = null; // gezet door het aanmaakformulier, zodat een
                                 // late lading dat formulier niet opnieuw opbouwt
                                 // (en je getypte naam wist)
  const battleplansLoaded = () => {
    if (onBattleplansReady) onBattleplansReady();
    else draw();
  };
  loadGamedata()
    .then(({ db }) => { battleplans = db.battleplans || []; battleplansLoaded(); })
    .catch(() => { battleplans = []; battleplansLoaded(); });
  const bpFor = (g) => (battleplans || []).find((b) => b.id === g.battleplanId) || null;
  const bpOptions = (selected) =>
    `<option value="">— nog niet bekend —</option>` +
    (battleplans || []).map((b) => `<option value="${esc(b.id)}"${b.id === selected ? " selected" : ""}>${esc(b.name)}</option>`).join("");
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
    const meta = [t.dates, t.location].filter(Boolean).map(esc).join(" · ");
    const card = el(`<div class="card clickable">
      <div class="card-header">
        <div>
          <h3>${esc(t.name)}</h3>
          <div class="subtitle">${esc(armyName(t.armyId))} · ${t.days} dag${t.days === 1 ? "" : "en"} · ${done}/${total} gespeeld</div>
          ${meta ? `<div class="subtitle">${meta}</div>` : ""}
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
      <label>Datum / data</label>
      <input type="text" id="t-dates" placeholder="bijv. 14 & 15 juni 2026" />
      <div class="row">
        <div><label>Locatie</label><input type="text" id="t-location" placeholder="bijv. Nijmegen" /></div>
        <div><label>Organisatie</label><input type="text" id="t-org" placeholder="bijv. Dutch Devastation" /></div>
      </div>
      <label>Formaat</label>
      <select id="t-fmt">${FORMATS.map((f) => `<option value="${f.key}">${f.label}</option>`).join("")}</select>
      <div class="row" id="t-custom" style="display:none">
        <div><label>Dagen</label><input type="number" id="t-days" min="1" value="1" /></div>
        <div><label>Aantal games</label><input type="number" id="t-rounds" min="1" value="3" /></div>
      </div>
      <label>Leger</label>
      <select id="t-army">${state.data.armies.map((a) => `<option value="${a.id}">${esc(a.name || "(naamloos)")} — ${esc(a.faction)}</option>`).join("")}</select>
      <label>Battleplans per ronde <span class="subtitle">(liggen bij een toernooi meestal vooraf vast — later aan te vullen)</span></label>
      <div id="t-plans"></div>
      <div class="btnrow">
        <button class="primary" id="t-create">${icon("check")} Toernooi aanmaken</button>
        <button id="t-cancel">Annuleren</button>
      </div>
    </div>`);
    const fmtSel = wrap.querySelector("#t-fmt");
    const custom = wrap.querySelector("#t-custom");
    const plansBox = wrap.querySelector("#t-plans");

    // Eén keuzelijst per ronde; het aantal volgt het gekozen formaat.
    const chosen = [];
    function drawPlans() {
      const n = roundCount();
      plansBox.innerHTML = "";
      if (battleplans === null) { plansBox.appendChild(el(`<p class="subtitle">Battleplans laden…</p>`)); return; }
      if (!battleplans.length) { plansBox.appendChild(el(`<p class="subtitle">Battleplans konden niet geladen worden — je kunt ze later invullen.</p>`)); return; }
      for (let i = 0; i < n; i++) {
        const rowEl = el(`<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
          <span class="subtitle" style="flex:0 0 70px">Game ${i + 1}</span>
          <span style="flex:1"><select data-i="${i}">${bpOptions(chosen[i])}</select></span>
        </div>`);
        rowEl.querySelector("select").addEventListener("change", (e) => { chosen[i] = e.target.value; });
        plansBox.appendChild(rowEl);
      }
    }
    function roundCount() {
      if (fmtKey !== "custom") return (FORMATS.find((f) => f.key === fmtKey) || {}).rounds || 0;
      return Math.max(1, parseInt(wrap.querySelector("#t-rounds").value) || 1);
    }

    fmtSel.addEventListener("change", () => {
      fmtKey = fmtSel.value;
      custom.style.display = fmtKey === "custom" ? "flex" : "none";
      drawPlans();
    });
    wrap.querySelector("#t-rounds").addEventListener("input", drawPlans);
    wrap.querySelector("#t-cancel").addEventListener("click", () => { creating = false; onBattleplansReady = null; draw(); });
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
        dates: wrap.querySelector("#t-dates").value.trim(),
        location: wrap.querySelector("#t-location").value.trim(),
        organization: wrap.querySelector("#t-org").value.trim(),
        games: Array.from({ length: rounds }, (_, i) => {
          const bp = (battleplans || []).find((b) => b.id === chosen[i]);
          return {
            id: uid(), name: `${name} game ${i + 1}`, game: null, done: false, archivedId: null,
            battleplanId: bp ? bp.id : "", battleplanName: bp ? bp.name : "",
          };
        }),
      };
      tournaments().push(t);
      saveData();
      creating = false;
      onBattleplansReady = null;
      openId = t.id;
      draw();
    });
    onBattleplansReady = drawPlans;
    drawPlans();
    app.appendChild(wrap);
  }

  // ---------- Detail ----------
  function drawDetail(t) {
    if (editingMeta) return drawMetaEditor(t);
    const st = standing(t);
    const metaLine = [t.location, t.organization].filter(Boolean).map(esc).join(" · ");
    const card = el(`<div class="card">
      <div class="card-header">
        <h2 style="margin:0">${esc(t.name)}</h2>
        <button class="small" id="t-editmeta">${icon("edit")} Gegevens</button>
      </div>
      <div class="subtitle">${esc(armyName(t.armyId))} · ${t.days} dag${t.days === 1 ? "" : "en"} · ${t.rounds} games</div>
      ${t.dates ? `<div class="subtitle">${esc(t.dates)}</div>` : ""}
      ${metaLine ? `<div class="subtitle">${metaLine}</div>` : ""}
      <div class="scoreline" style="justify-content:flex-start;gap:16px;padding-top:10px">
        <span>Gewonnen <strong>${st.w}</strong></span>
        <span>Verloren <strong>${st.l}</strong></span>
        <span>Gelijk <strong>${st.d}</strong></span>
        <span>VP <strong>${st.vp}</strong></span>
      </div>
    </div>`);
    card.querySelector("#t-editmeta").addEventListener("click", () => { editingMeta = true; draw(); });
    app.appendChild(card);

    app.appendChild(listCard(t));

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

  // Eén toernooi = één lijst. Die wordt vastgelegd zodra je de eerste game start
  // en gaat mee naar het archief bij elke game van dit toernooi. Je kunt hem hier
  // altijd (opnieuw) vastleggen — ook bij een lopend toernooi, bijvoorbeeld als de
  // games al openstonden voordat deze functie bestond. Zijn er al games
  // gearchiveerd, dan worden die records meteen bijgewerkt, zodat alle games van
  // het toernooi dezelfde lijst tonen.
  function listCard(t) {
    const army = state.data.armies.find((a) => a.id === t.armyId) || null;
    const archived = (t.games || []).filter((g) => g.archivedId).length;
    const card = el(`<div class="card">
      <div class="card-header">
        <h3 style="margin:0">${icon("list", 18)} Toernooilijst</h3>
        <div class="btnrow" style="margin:0" data-actions></div>
      </div>
      <div data-body></div>
    </div>`);
    const body = card.querySelector("[data-body]");
    const actions = card.querySelector("[data-actions]");

    if (t.list) {
      body.appendChild(listBlock(t.list, { el, esc }));
      body.appendChild(el(`<p class="subtitle">Deze lijst hangt aan alle games van dit toernooi in het archief.</p>`));
    } else {
      body.appendChild(el(`<p class="empty">Nog niet vastgelegd — leg hem hier vast, of start een game dan gebeurt het vanzelf.</p>`));
    }

    if (!army) {
      body.appendChild(el(`<p class="subtitle">Het leger van dit toernooi bestaat niet meer, dus er valt niets (opnieuw) vast te leggen.</p>`));
      return card;
    }

    const btn = el(`<button class="small">${icon(t.list ? "refresh" : "check")} ${t.list ? "Opnieuw vastleggen" : "Nu vastleggen"}</button>`);
    btn.addEventListener("click", () => {
      const vraag = t.list
        ? `De lijst van dit toernooi vervangen door de huidige lijst van ${army.name}?`
        : `De huidige lijst van ${army.name} vastleggen als toernooilijst?`;
      const extra = archived ? `

De ${archived} al gearchiveerde game(s) van dit toernooi krijgen deze lijst ook.` : "";
      if (!confirm(vraag + extra)) return;
      t.list = buildListSnapshot(army);
      // Al gearchiveerde games meteen gelijktrekken.
      for (const g of t.games || []) {
        if (!g.archivedId) continue;
        const rec = (state.data.gameArchive || []).find((r) => r.id === g.archivedId);
        if (rec) rec.list = t.list;
      }
      saveData();
      draw();
    });
    actions.appendChild(btn);
    return card;
  }

  // Toernooi-gegevens bewerken (naam, datum/data, locatie, organisatie).
  function drawMetaEditor(t) {
    const wrap = el(`<div class="card">
      <h2>Toernooi-gegevens</h2>
      <label>Naam</label>
      <input type="text" id="m-name" value="${esc(t.name)}" />
      <label>Datum / data</label>
      <input type="text" id="m-dates" value="${esc(t.dates || "")}" placeholder="bijv. 14 & 15 juni 2026" />
      <div class="row">
        <div><label>Locatie</label><input type="text" id="m-location" value="${esc(t.location || "")}" /></div>
        <div><label>Organisatie</label><input type="text" id="m-org" value="${esc(t.organization || "")}" /></div>
      </div>
      <div class="btnrow">
        <button class="primary" id="m-save">${icon("check")} Opslaan</button>
        <button id="m-cancel">Annuleren</button>
      </div>
    </div>`);
    wrap.querySelector("#m-cancel").addEventListener("click", () => { editingMeta = false; draw(); });
    wrap.querySelector("#m-save").addEventListener("click", () => {
      const newName = wrap.querySelector("#m-name").value.trim();
      const oldName = t.name;
      if (newName) {
        // Game-namen die nog het standaardpatroon volgen meelaten wijzigen.
        t.games.forEach((g, i) => {
          if (g.name === `${oldName} game ${i + 1}`) g.name = `${newName} game ${i + 1}`;
        });
        t.name = newName;
      }
      t.dates = wrap.querySelector("#m-dates").value.trim();
      t.location = wrap.querySelector("#m-location").value.trim();
      t.organization = wrap.querySelector("#m-org").value.trim();
      saveData();
      editingMeta = false;
      draw();
    });
    app.appendChild(wrap);
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
    const bp = bpFor(g);
    const bpName = bp ? bp.name : (g.battleplanName || "");
    const row = el(`<div class="card">
      <div class="card-header">
        <div><h3>${esc(g.name)}</h3>${statusHtml}
          ${bpName ? `<div class="subtitle">${icon("map", 14)} ${esc(bpName)}</div>` : ""}</div>
        <span class="chip tag ${chipCls}">${g.done ? "Klaar" : g.game ? "Bezig" : "Open"}</span>
      </div>
      <div class="btnrow">
        <button class="primary small" data-play>${btnLabel}</button>
        ${bp ? `<button class="small" data-bpinfo>${icon("map")} Battleplan bekijken</button>` : ""}
        <button class="small" data-bppick>${icon("map")} ${bpName ? "Battleplan wijzigen" : "Battleplan invullen"}</button>
      </div>
      <div data-bpedit></div>
    </div>`);
    row.querySelector("[data-play]").addEventListener("click", () => {
      saveData();
      navigate("companion", { armyId: t.armyId, tournamentRef: { tid: t.id, gid: g.id }, tournamentOpenId: null });
    });
    const infoBtn = row.querySelector("[data-bpinfo]");
    if (infoBtn) infoBtn.addEventListener("click", () => openBattleplanModal(bp, { el, esc }));

    const editBox = row.querySelector("[data-bpedit]");
    row.querySelector("[data-bppick]").addEventListener("click", () => {
      if (editBox.children.length) { editBox.innerHTML = ""; return; }
      if (battleplans === null) { editBox.appendChild(el(`<p class="subtitle">Battleplans laden…</p>`)); return; }
      if (!battleplans.length) { editBox.appendChild(el(`<p class="subtitle">Battleplans konden niet geladen worden (offline?).</p>`)); return; }
      const box = el(`<div style="margin-top:8px">
        <label>Welk battleplan is deze ronde?</label>
        <select data-sel>${bpOptions(g.battleplanId)}</select>
      </div>`);
      box.querySelector("[data-sel]").addEventListener("change", (e) => {
        const chosen = (battleplans || []).find((b) => b.id === e.target.value);
        g.battleplanId = chosen ? chosen.id : "";
        g.battleplanName = chosen ? chosen.name : "";
        saveData();
        draw();
      });
      editBox.appendChild(box);
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
