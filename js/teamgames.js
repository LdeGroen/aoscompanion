import { icon } from "./icons.js";
import { uid } from "./storage.js";
import { resultLabel } from "./scorecard.js";
import { buildListSnapshot, listBlock, snapshotFromParsedList } from "./gamelist.js";
import { loadGamedata } from "./battleplans.js";
import { openBattleplanModal } from "./battleplanview.js";
import { parseListText } from "./listimport.js";
import { AOS_FACTIONS } from "./factions.js";
import { openModal } from "./modelview.js";

// Team games: scrimdagen en teamtoernooien, naast losse games en (solo)toernooien.
//
// state.data.teamEvents = [{
//   id, kind: "scrim" | "teamTournament", name, date, location, teamSize, notes, createdAt,
//   myTeam: { name, players: [Speler] },
//   — scrim:          opponents: { name, players: [Speler] }, games: [Slot]
//   — teamTournament: organization, days, armyId, list, rounds: [Slot + { opponentTeam, notes }]
// }]
// Speler = { id, name, faction, subfaction, armyName, isMe, armyId, listText, list }
// Slot   = { id, name, armyId, opponentPlayerId, opponentName, battleplanId, battleplanName,
//            game, done, archivedId }
//
// Een slot speel je als gewone companion-game (state.tournamentRef = {kind:"team", eid, gid});
// afgeronde games komen getagd met teamEventId in het archief. Alles behalve een naam mag
// leeg blijven: bij een teamtoernooi moet je snel kunnen invullen en later aanvullen.

const SIZES = [5, 7, 8];

// Voor companion.js: bij welk event, slot en tegenstander hoort deze game?
export function teamGameContext(data, ref) {
  if (!ref || ref.kind !== "team") return null;
  const ev = (data.teamEvents || []).find((e) => e.id === ref.eid);
  if (!ev) return null;
  const slot = ev.kind === "scrim"
    ? (ev.games || []).find((g) => g.id === ref.gid)
    : (ev.rounds || []).find((r) => r.id === ref.gid);
  if (!slot) return null;
  const oppTeam = ev.kind === "scrim" ? ev.opponents : slot.opponentTeam;
  const player = (oppTeam?.players || []).find((p) => p.id === slot.opponentPlayerId) || null;
  return { ev, slot, oppTeam, player };
}

// Het archief koppelt een record terug aan zijn slot via teamEventId + gameLabel.
export function reconcileTeamEvents(data) {
  if (!data) return false;
  const archive = data.gameArchive || [];
  let changed = false;
  for (const ev of data.teamEvents || []) {
    for (const s of [...(ev.games || []), ...(ev.rounds || [])]) {
      if (s.archivedId) {
        if (archive.some((r) => r.id === s.archivedId)) { if (!s.done) { s.done = true; changed = true; } continue; }
        s.archivedId = null;
        if (s.done) { s.done = false; changed = true; }
      }
      const rec = archive.find((r) => r.teamEventId === ev.id && r.gameLabel && r.gameLabel === s.name);
      if (rec) { s.archivedId = rec.id; s.done = true; changed = true; }
    }
  }
  return changed;
}

export function renderTeamGames(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  state.data.teamEvents = state.data.teamEvents || [];
  const events = () => state.data.teamEvents;
  let openId = state.teamOpenId || null;
  let creating = null; // "scrim" | "teamTournament" | null
  let editingMeta = false;

  let battleplans = null;
  loadGamedata()
    .then(({ db }) => { battleplans = db.battleplans || []; if (!creating) draw(); })
    .catch(() => { battleplans = []; });
  const bpOptions = (selected) =>
    `<option value="">— nog niet bekend —</option>` +
    (battleplans || []).map((b) => `<option value="${esc(b.id)}"${b.id === selected ? " selected" : ""}>${esc(b.name)}</option>`).join("");
  const armies = () => state.data.armies || [];
  const armyName = (id) => (armies().find((a) => a.id === id) || {}).name || "";
  const recFor = (s) => (state.data.gameArchive || []).find((r) => r.id === s.archivedId);
  const facOptions = (sel) => `<option value="">— faction —</option>` +
    Object.keys(AOS_FACTIONS).map((f) => `<option${f === sel ? " selected" : ""}>${esc(f)}</option>`).join("");
  const kindLabel = (ev) => (ev.kind === "scrim" ? "Scrimdag" : "Teamtoernooi");
  const slotsOf = (ev) => (ev.kind === "scrim" ? ev.games || [] : ev.rounds || []);
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return iso && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : (iso || "");
  };

  // Typen in een veld bewaart na een korte pauze, zonder het scherm opnieuw op te bouwen.
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveData, 600); };

  function blankPlayer(isMe = false) {
    return { id: uid(), name: isMe ? (state.user?.name || "") : "", faction: "", subfaction: "", armyName: "", isMe, armyId: "", listText: "", list: null };
  }
  function fillTeam(team, size, withMe) {
    team.players = team.players || [];
    while (team.players.length < size) team.players.push(blankPlayer(withMe && !team.players.some((p) => p.isMe)));
  }

  function standing(ev) {
    let w = 0, l = 0, d = 0, vp = 0;
    for (const s of slotsOf(ev)) {
      if (!s.done) continue;
      const rec = recFor(s);
      if (!rec) continue;
      vp += rec.totals.player || 0;
      const diff = (rec.totals.player || 0) - (rec.totals.enemy || 0);
      if (diff > 0) w++; else if (diff < 0) l++; else d++;
    }
    return { w, l, d, vp };
  }

  function draw() {
    app.innerHTML = "";
    const header = el(`<div class="topbar">
      <span class="title">${icon("users", 18)} Team games</span>
      <button class="small" id="btn-back">${icon("back")} Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => {
      saveData();
      if (creating) { creating = null; draw(); }
      else if (editingMeta) { editingMeta = false; draw(); }
      else if (openId) { openId = null; state.teamOpenId = null; draw(); }
      else navigate("home");
    });
    app.appendChild(header);
    if (creating) return drawCreate(creating);
    if (openId) {
      const ev = events().find((x) => x.id === openId);
      if (ev) return editingMeta ? drawMeta(ev) : drawDetail(ev);
      openId = null;
    }
    drawList();
  }

  // ---------- Overzicht ----------
  function drawList() {
    app.appendChild(el(`<h2>Team games</h2>`));
    const btns = el(`<div class="btnrow">
      <button class="primary" data-k="scrim">${icon("plus")} Nieuwe scrimdag</button>
      <button class="primary" data-k="teamTournament">${icon("plus")} Nieuw teamtoernooi</button>
    </div>`);
    for (const b of btns.querySelectorAll("[data-k]")) b.addEventListener("click", () => { creating = b.dataset.k; draw(); });
    app.appendChild(btns);
    const list = [...events()].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
    if (!list.length) app.appendChild(el(`<p class="empty">Nog geen scrimdagen of teamtoernooien.</p>`));
    for (const ev of list) {
      const st = standing(ev);
      const slots = slotsOf(ev);
      const done = slots.filter((s) => s.done).length;
      const meta = [kindLabel(ev), fmtDate(ev.date), ev.location].filter(Boolean).map(esc).join(" · ");
      const team = ev.myTeam?.name ? ` · team ${esc(ev.myTeam.name)}` : "";
      const vs = ev.kind === "scrim" && ev.opponents?.name ? ` · tegen ${esc(ev.opponents.name)}` : "";
      const card = el(`<div class="card clickable">
        <div class="card-header">
          <div>
            <h3>${icon(ev.kind === "scrim" ? "users" : "trophy")} ${esc(ev.name || kindLabel(ev))}</h3>
            <div class="subtitle">${meta}</div>
            <div class="subtitle">teams van ${ev.teamSize}${team}${vs} · ${done}/${slots.length} games gespeeld</div>
          </div>
          <span class="chip tag${slots.length && done === slots.length ? "" : " dim"}">${st.w}–${st.l}–${st.d}</span>
        </div>
      </div>`);
      card.addEventListener("click", () => { openId = ev.id; state.teamOpenId = ev.id; draw(); });
      app.appendChild(card);
    }
  }

  // ---------- Aanmaken ----------
  function sizeField(value) {
    const custom = !SIZES.includes(value);
    return `<label>Teamgrootte</label>
      <div class="chips" data-sizes>${SIZES.map((s) => `<button class="chip${value === s ? " active" : ""}" data-size="${s}">${s} spelers</button>`).join("")}
        <button class="chip${custom ? " active" : ""}" data-size="custom">Eigen aantal</button></div>
      <input type="number" min="1" max="20" data-size-n value="${value}" style="${custom ? "" : "display:none"};max-width:120px" />`;
  }
  function wireSize(wrap, onSize) {
    const n = wrap.querySelector("[data-size-n]");
    for (const b of wrap.querySelectorAll("[data-size]")) b.addEventListener("click", () => {
      wrap.querySelectorAll("[data-size]").forEach((x) => x.classList.toggle("active", x === b));
      if (b.dataset.size === "custom") { n.style.display = ""; n.focus(); }
      else { n.style.display = "none"; n.value = b.dataset.size; onSize(parseInt(b.dataset.size)); }
    });
    n.addEventListener("input", () => onSize(Math.max(1, parseInt(n.value) || 1)));
  }

  function drawCreate(kind) {
    let size = 5;
    const isT = kind === "teamTournament";
    const today = new Date().toISOString().slice(0, 10);
    const wrap = el(`<div class="card">
      <h2>${isT ? "Nieuw teamtoernooi" : "Nieuwe scrimdag"}</h2>
      <label>${isT ? "Naam van het toernooi" : "Naam (optioneel)"}</label>
      <input type="text" id="e-name" placeholder="${isT ? "bijv. Dutch Team Championship" : "bijv. Scrim tegen de Dice Devils"}" />
      ${isT ? `<label>Naam van je team</label><input type="text" id="e-team" placeholder="bijv. De Gargants" />` : ""}
      <div class="row">
        <div><label>Datum</label><input type="date" id="e-date" value="${today}" /></div>
        <div><label>Locatie</label><input type="text" id="e-location" placeholder="bijv. Utrecht" /></div>
      </div>
      ${isT ? `<label>Organisatie</label><input type="text" id="e-org" />
      <div class="row">
        <div><label>Dagen</label><input type="number" id="e-days" min="1" value="1" /></div>
        <div><label>Aantal rondes</label><input type="number" id="e-rounds" min="1" value="3" /></div>
      </div>
      <label>Jouw leger</label>
      <select id="e-army">${armies().map((a) => `<option value="${a.id}">${esc(a.name || "(naamloos)")} — ${esc(a.faction)}</option>`).join("")}</select>
      <label>Battleplans per ronde <span class="subtitle">(later aan te vullen)</span></label>
      <div id="e-plans"></div>` : ""}
      ${sizeField(size)}
      <p class="subtitle">De spelers voer je hierna in; alles behalve de naam mag je overslaan en later aanvullen.</p>
      <div class="btnrow">
        <button class="primary" id="e-create">${icon("check")} Aanmaken</button>
        <button id="e-cancel">Annuleren</button>
      </div>
    </div>`);
    wireSize(wrap, (n) => { size = n; });
    const chosen = [];
    const drawPlans = () => {
      const box = wrap.querySelector("#e-plans");
      if (!box) return;
      const n = Math.max(1, parseInt(wrap.querySelector("#e-rounds").value) || 1);
      box.innerHTML = "";
      if (!battleplans || !battleplans.length) { box.appendChild(el(`<p class="subtitle">${battleplans === null ? "Battleplans laden…" : "Geen battleplans beschikbaar — later in te vullen."}</p>`)); return; }
      for (let i = 0; i < n; i++) {
        const r = el(`<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span class="subtitle" style="flex:0 0 70px">Ronde ${i + 1}</span><span style="flex:1"><select>${bpOptions(chosen[i])}</select></span></div>`);
        r.querySelector("select").addEventListener("change", (e) => { chosen[i] = e.target.value; });
        box.appendChild(r);
      }
    };
    if (isT) { wrap.querySelector("#e-rounds").addEventListener("input", drawPlans); drawPlans(); }
    wrap.querySelector("#e-cancel").addEventListener("click", () => { creating = null; draw(); });
    wrap.querySelector("#e-create").addEventListener("click", () => {
      const v = (id) => (wrap.querySelector(id)?.value || "").trim();
      const name = v("#e-name");
      if (isT && !name) { wrap.querySelector("#e-name").focus(); return; }
      if (isT && !armies().length) { alert("Maak eerst een leger aan om een teamtoernooi te spelen."); return; }
      const ev = {
        id: uid(), kind, name: name || `Scrim ${fmtDate(v("#e-date"))}`, date: v("#e-date"), location: v("#e-location"),
        teamSize: size, notes: "", createdAt: Date.now(),
        myTeam: { name: isT ? v("#e-team") : "", players: [] },
      };
      fillTeam(ev.myTeam, size, true);
      if (isT) {
        const rounds = Math.max(1, parseInt(v("#e-rounds")) || 1);
        Object.assign(ev, {
          organization: v("#e-org"), days: Math.max(1, parseInt(v("#e-days")) || 1), armyId: v("#e-army"), list: null,
          rounds: Array.from({ length: rounds }, (_, i) => {
            const bp = (battleplans || []).find((b) => b.id === chosen[i]);
            return {
              id: uid(), name: `${ev.name} ronde ${i + 1}`, opponentTeam: { name: "", players: [] }, notes: "",
              opponentPlayerId: "", opponentName: "", armyId: ev.armyId,
              battleplanId: bp ? bp.id : "", battleplanName: bp ? bp.name : "", game: null, done: false, archivedId: null,
            };
          }),
        });
        const me = ev.myTeam.players.find((p) => p.isMe);
        const a = armies().find((x) => x.id === ev.armyId);
        if (me && a) { me.armyId = a.id; me.faction = a.faction; me.subfaction = a.subfaction || ""; me.armyName = a.name; }
      } else {
        ev.opponents = { name: "", players: [] };
        fillTeam(ev.opponents, size, false);
        ev.games = [];
      }
      events().push(ev);
      saveData();
      creating = null;
      openId = ev.id; state.teamOpenId = ev.id;
      draw();
    });
    app.appendChild(wrap);
  }

  // ---------- Detail ----------
  function drawDetail(ev) {
    const isT = ev.kind === "teamTournament";
    const st = standing(ev);
    const meta = [fmtDate(ev.date), ev.location, ev.organization].filter(Boolean).map(esc).join(" · ");
    const head = el(`<div class="card">
      <div class="card-header">
        <h2 style="margin:0">${icon(isT ? "trophy" : "users")} ${esc(ev.name)}</h2>
        <button class="small" data-meta>${icon("edit")} Gegevens</button>
      </div>
      <div class="subtitle">${kindLabel(ev)} · teams van ${ev.teamSize}${isT && ev.myTeam?.name ? ` · team ${esc(ev.myTeam.name)}` : ""}${isT ? ` · ${(ev.rounds || []).length} rondes · ${esc(armyName(ev.armyId) || "geen leger")}` : ""}</div>
      ${meta ? `<div class="subtitle">${meta}</div>` : ""}
      <div class="scoreline" style="justify-content:flex-start;gap:16px;padding-top:10px">
        <span>Gewonnen <strong>${st.w}</strong></span><span>Verloren <strong>${st.l}</strong></span>
        <span>Gelijk <strong>${st.d}</strong></span><span>VP <strong>${st.vp}</strong></span>
      </div>
    </div>`);
    head.querySelector("[data-meta]").addEventListener("click", () => { editingMeta = true; draw(); });
    app.appendChild(head);

    app.appendChild(notesCard(ev, `Notities${isT ? " bij het toernooi" : " van deze scrimdag"}`));
    app.appendChild(teamCard(ev.myTeam, { title: isT ? `Jouw team${ev.myTeam?.name ? " — " + ev.myTeam.name : ""}` : "Jouw team", size: ev.teamSize, withMe: true, open: !ev.myTeam.players.some((p) => p.name && !p.isMe) }));

    if (isT) {
      app.appendChild(tournamentListCard(ev));
      (ev.rounds || []).forEach((r, i) => app.appendChild(roundCard(ev, r, i)));
      const add = el(`<button class="small">${icon("plus")} Ronde toevoegen</button>`);
      add.addEventListener("click", () => {
        ev.rounds.push({ id: uid(), name: `${ev.name} ronde ${ev.rounds.length + 1}`, opponentTeam: { name: "", players: [] }, notes: "", opponentPlayerId: "", opponentName: "", armyId: ev.armyId, battleplanId: "", battleplanName: "", game: null, done: false, archivedId: null });
        saveData(); draw();
      });
      app.appendChild(add);
    } else {
      app.appendChild(teamCard(ev.opponents, { title: `Tegenstanders${ev.opponents?.name ? " — " + ev.opponents.name : ""}`, size: ev.teamSize, withName: true, open: !ev.opponents.players.some((p) => p.name) }));
      app.appendChild(scrimGamesCard(ev));
    }

    const del = el(`<div class="btnrow" style="margin-top:16px"><button class="danger small">${icon("trash")} ${kindLabel(ev)} verwijderen</button></div>`);
    del.querySelector("button").addEventListener("click", () => {
      if (!confirm(`"${ev.name}" verwijderen? De games in het archief blijven staan.`)) return;
      state.data.teamEvents = events().filter((x) => x.id !== ev.id);
      saveData(); openId = null; state.teamOpenId = null; draw();
    });
    app.appendChild(del);
  }

  function notesCard(obj, title) {
    const card = el(`<div class="card"><h3>${icon("edit", 16)} ${esc(title)}</h3>
      <textarea class="notes" placeholder="Pairings, tactiek, wat je opviel…" style="min-height:90px">${esc(obj.notes || "")}</textarea></div>`);
    card.querySelector("textarea").addEventListener("input", (e) => { obj.notes = e.target.value; saveSoon(); });
    return card;
  }

  // Spelers van een team: naam, faction, legernaam en (optioneel) een geplakte lijst.
  // `withMe` = jouw eigen team: één speler ben jij, gekoppeld aan een van je legers.
  function teamCard(team, { title, size, withMe = false, withName = false, open = true }) {
    team.players = team.players || [];
    const filled = team.players.filter((p) => p.name).length;
    const card = el(`<details class="card team-card" ${open ? "open" : ""}>
      <summary><h3 style="display:inline">${icon("users", 16)} ${esc(title)}</h3> <span class="subtitle">${filled}/${size} spelers ingevuld</span></summary>
      ${withName ? `<label>Teamnaam</label><input type="text" data-teamname value="${esc(team.name || "")}" placeholder="bijv. Dice Devils" />` : ""}
      <div data-players></div>
      <button class="small" data-addp>${icon("plus")} Speler toevoegen</button>
    </details>`);
    const tn = card.querySelector("[data-teamname]");
    if (tn) tn.addEventListener("input", (e) => { team.name = e.target.value; saveSoon(); });
    const box = card.querySelector("[data-players]");
    const drawPlayers = () => {
      box.innerHTML = "";
      team.players.forEach((p, i) => box.appendChild(playerRow(team, p, i, withMe, drawPlayers)));
    };
    drawPlayers();
    card.querySelector("[data-addp]").addEventListener("click", () => { team.players.push(blankPlayer(false)); saveData(); drawPlayers(); });
    return card;
  }

  function playerRow(team, p, i, withMe, redraw) {
    const row = el(`<div class="player-row${p.isMe ? " me" : ""}">
      <div class="player-main">
        <input type="text" data-f="name" value="${esc(p.name)}" placeholder="Speler ${i + 1}" />
        ${p.isMe
          ? `<select data-army><option value="">— jouw leger —</option>${armies().map((a) => `<option value="${a.id}"${a.id === p.armyId ? " selected" : ""}>${esc(a.name || "(naamloos)")}</option>`).join("")}</select>`
          : `<select data-f="faction">${facOptions(p.faction)}</select>`}
      </div>
      <div class="player-sub">
        ${p.isMe ? `<span class="chip tag">ik</span> <span class="subtitle">${esc(p.faction || "")}${p.subfaction ? " — " + esc(p.subfaction) : ""}</span>`
          : `<input type="text" data-f="armyName" value="${esc(p.armyName || "")}" placeholder="leger / subfaction (optioneel)" />`}
        <button class="small" data-list>${icon("list")} ${p.list ? "Lijst" : "Lijst plakken"}</button>
        ${withMe && !p.isMe ? `<button class="small" data-me title="Dit ben ik">ik</button>` : ""}
        <button class="danger small" data-del title="Speler weghalen">${icon("trash")}</button>
      </div>
    </div>`);
    for (const inp of row.querySelectorAll("[data-f]")) {
      const f = inp.dataset.f;
      inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", (e) => { p[f] = e.target.value; saveSoon(); });
    }
    const armySel = row.querySelector("[data-army]");
    if (armySel) armySel.addEventListener("change", (e) => {
      const a = armies().find((x) => x.id === e.target.value);
      p.armyId = a ? a.id : ""; p.faction = a ? a.faction : ""; p.subfaction = a ? a.subfaction || "" : ""; p.armyName = a ? a.name : "";
      saveData(); redraw();
    });
    row.querySelector("[data-list]").addEventListener("click", () => openPlayerList(p, redraw));
    const meBtn = row.querySelector("[data-me]");
    if (meBtn) meBtn.addEventListener("click", () => { team.players.forEach((x) => { x.isMe = x === p; }); saveData(); redraw(); });
    row.querySelector("[data-del]").addEventListener("click", () => {
      if ((p.name || p.list) && !confirm(`${p.name || "Deze speler"} weghalen?`)) return;
      team.players.splice(team.players.indexOf(p), 1); saveData(); redraw();
    });
    return row;
  }

  // Lijst van een speler: plakken (wordt ingelezen tot faction/subfaction/regiments) of
  // voor jezelf de huidige lijst van je leger overnemen.
  function openPlayerList(p, redraw) {
    const wrap = el(`<div><h2>${icon("list")} Lijst van ${esc(p.name || "deze speler")}</h2>
      <div data-current></div>
      <label>Geëxporteerde lijst plakken</label>
      <textarea data-text style="min-height:160px;font-family:monospace;font-size:0.8rem" placeholder="Plak hier de lijst…">${esc(p.listText || "")}</textarea>
      <div class="btnrow">
        <button class="primary" data-save>${icon("check")} Opslaan</button>
        ${p.isMe && p.armyId ? `<button data-mine>${icon("copy")} Huidige lijst van mijn leger</button>` : ""}
        ${p.list ? `<button class="danger" data-clear>${icon("trash")} Lijst weghalen</button>` : ""}
      </div></div>`);
    if (p.list) wrap.querySelector("[data-current]").appendChild(listBlock(p.list, { el, esc }));
    const overlay = openModal(wrap, el);
    wrap.querySelector("[data-save]").addEventListener("click", () => {
      const text = wrap.querySelector("[data-text]").value;
      p.listText = text;
      if (text.trim()) {
        const parsed = parseListText(text, { factions: AOS_FACTIONS });
        p.list = snapshotFromParsedList(parsed);
        if (!p.faction && parsed.faction) p.faction = parsed.faction;
        if (!p.subfaction && parsed.subfaction) p.subfaction = parsed.subfaction;
        if (!p.armyName && parsed.armyName) p.armyName = parsed.armyName;
      } else p.list = null;
      saveData(); overlay.remove(); redraw();
    });
    const mine = wrap.querySelector("[data-mine]");
    if (mine) mine.addEventListener("click", () => {
      const a = armies().find((x) => x.id === p.armyId);
      if (a) { p.list = buildListSnapshot(a); p.listText = ""; saveData(); }
      overlay.remove(); redraw();
    });
    const clr = wrap.querySelector("[data-clear]");
    if (clr) clr.addEventListener("click", () => { p.list = null; p.listText = ""; saveData(); overlay.remove(); redraw(); });
  }

  // Teamtoernooi: één lijst voor het hele toernooi, net als een solotoernooi.
  function tournamentListCard(ev) {
    const army = armies().find((a) => a.id === ev.armyId) || null;
    const card = el(`<details class="card"><summary><h3 style="display:inline">${icon("list", 16)} Toernooilijst</h3> <span class="subtitle">${ev.list ? "vastgelegd" : "nog niet vastgelegd"}</span></summary><div data-body></div></details>`);
    const body = card.querySelector("[data-body]");
    if (ev.list) body.appendChild(listBlock(ev.list, { el, esc }));
    else body.appendChild(el(`<p class="empty">Wordt vastgelegd zodra je de eerste game start, of leg hem nu vast.</p>`));
    if (army) {
      const b = el(`<button class="small">${icon(ev.list ? "refresh" : "check")} ${ev.list ? "Opnieuw vastleggen" : "Nu vastleggen"}</button>`);
      b.addEventListener("click", () => {
        if (!confirm(`De huidige lijst van ${army.name} vastleggen als lijst van dit teamtoernooi?`)) return;
        ev.list = buildListSnapshot(army);
        for (const r of ev.rounds || []) { const rec = recFor(r); if (rec) rec.list = ev.list; }
        saveData(); draw();
      });
      body.appendChild(b);
    }
    return card;
  }

  // Een slot: status, battleplan en de speel-knop.
  function slotStatus(s) {
    const rec = s.done ? recFor(s) : null;
    if (rec) return { html: `${rec.totals.player}–${rec.totals.enemy} · ${esc(resultLabel(rec).text)}`, btn: `${icon("edit")} Bekijken`, chip: "Klaar" };
    if (s.game) return { html: `Bezig — battleround ${s.game.round || 1}`, btn: `${icon("play")} Verder spelen`, chip: "Bezig" };
    return { html: "Nog te spelen", btn: `${icon("play")} Spelen`, chip: "Open" };
  }
  function play(ev, s) {
    const armyId = s.armyId || ev.armyId || ev.myTeam.players.find((p) => p.isMe)?.armyId;
    if (!armyId || !armies().some((a) => a.id === armyId)) { alert("Kies eerst met welk leger je deze game speelt."); return; }
    s.armyId = armyId;
    saveData();
    navigate("companion", { armyId, tournamentRef: { kind: "team", eid: ev.id, gid: s.id }, teamOpenId: ev.id });
  }
  function bpControls(s, box) {
    const bp = (battleplans || []).find((b) => b.id === s.battleplanId);
    const wrap = el(`<div class="row" style="align-items:end">
      <div><label>Battleplan</label><select data-bp>${bpOptions(s.battleplanId)}</select></div>
      ${bp ? `<div style="flex:0 0 auto"><button class="small" data-bpinfo>${icon("map")} Bekijken</button></div>` : ""}
    </div>`);
    wrap.querySelector("[data-bp]").addEventListener("change", (e) => {
      const c = (battleplans || []).find((b) => b.id === e.target.value);
      s.battleplanId = c ? c.id : ""; s.battleplanName = c ? c.name : ""; saveData(); draw();
    });
    const info = wrap.querySelector("[data-bpinfo]");
    if (info) info.addEventListener("click", () => openBattleplanModal(bp, { el, esc }));
    box.appendChild(wrap);
  }
  const oppLabel = (p) => `${p.name || "(naamloos)"}${p.faction ? " — " + p.faction : ""}`;

  // Scrimdag: losse games tegen spelers van het andere team.
  function scrimGamesCard(ev) {
    const card = el(`<div class="card"><h3>${icon("sword", 16)} Games</h3><div data-games></div>
      <div class="new-game"><h4>Nieuwe game</h4>
        <div class="row">
          <div><label>Tegen</label><select data-opp></select></div>
          <div><label>Met leger</label><select data-army>${armies().map((a) => `<option value="${a.id}"${a.id === ev.myTeam.players.find((p) => p.isMe)?.armyId ? " selected" : ""}>${esc(a.name || "(naamloos)")}</option>`).join("")}</select></div>
        </div>
        <button class="primary small" data-new>${icon("plus")} Game aanmaken</button>
      </div></div>`);
    const list = card.querySelector("[data-games]");
    if (!(ev.games || []).length) list.appendChild(el(`<p class="empty">Nog geen games op deze scrimdag.</p>`));
    for (const g of ev.games || []) {
      const opp = (ev.opponents.players || []).find((p) => p.id === g.opponentPlayerId);
      const st = slotStatus(g);
      const row = el(`<div class="card inner">
        <div class="card-header"><div><strong>vs ${esc(opp ? oppLabel(opp) : g.opponentName || "?")}</strong>
          <div class="subtitle">${esc(armyName(g.armyId) || "?")} · ${st.html}</div></div>
          <span class="chip tag${g.done ? "" : " dim"}">${st.chip}</span></div>
        <div data-bp></div>
        <div class="btnrow"><button class="primary small" data-play>${st.btn}</button>
          ${!g.game && !g.done ? `<button class="danger small" data-del>${icon("trash")}</button>` : ""}</div>
      </div>`);
      bpControls(g, row.querySelector("[data-bp]"));
      row.querySelector("[data-play]").addEventListener("click", () => play(ev, g));
      const d = row.querySelector("[data-del]");
      if (d) d.addEventListener("click", () => { ev.games.splice(ev.games.indexOf(g), 1); saveData(); draw(); });
      list.appendChild(row);
    }
    // De tegenstanders typ je vaak net hierboven in: vul de keuzelijst steeds vers.
    const oppSel = card.querySelector("[data-opp]");
    const fillOpp = () => {
      const cur = oppSel.value;
      const ps = (ev.opponents.players || []).filter((p) => p.name);
      oppSel.innerHTML = ps.map((p) => `<option value="${p.id}"${p.id === cur ? " selected" : ""}>${esc(oppLabel(p))}</option>`).join("")
        || `<option value="">— vul eerst de tegenstanders in —</option>`;
    };
    fillOpp();
    for (const evName of ["focus", "mousedown", "touchstart"]) oppSel.addEventListener(evName, fillOpp);
    card.querySelector("[data-new]").addEventListener("click", () => {
      fillOpp();
      const pid = oppSel.value;
      const opp = (ev.opponents.players || []).find((p) => p.id === pid);
      if (!opp) { alert("Vul eerst bij Tegenstanders minstens één speler met naam in."); return; }
      const n = (ev.games || []).filter((x) => x.opponentPlayerId === pid).length + 1;
      ev.games.push({
        id: uid(), name: `${ev.name}: vs ${opp.name}${n > 1 ? ` (${n})` : ""}`, armyId: card.querySelector("[data-army]").value,
        opponentPlayerId: pid, opponentName: opp.name, battleplanId: "", battleplanName: "", game: null, done: false, archivedId: null,
      });
      saveData(); draw();
    });
    return card;
  }

  // Teamtoernooi: per ronde het andere team, je eigen tegenstander, notities en de game.
  function roundCard(ev, r, i) {
    const st = slotStatus(r);
    r.opponentTeam = r.opponentTeam || { name: "", players: [] };
    fillTeam(r.opponentTeam, ev.teamSize, false);
    const me = (r.opponentTeam.players || []).find((p) => p.id === r.opponentPlayerId);
    const card = el(`<details class="card round-card" ${r.done ? "" : "open"}>
      <summary><h3 style="display:inline">Ronde ${i + 1}${r.opponentTeam.name ? ` — vs ${esc(r.opponentTeam.name)}` : ""}</h3>
        <span class="chip tag${r.done ? "" : " dim"}">${st.chip}</span>
        <div class="subtitle">${me ? `jij tegen ${esc(oppLabel(me))} · ` : r.opponentName ? `jij tegen ${esc(r.opponentName)} · ` : ""}${st.html}</div></summary>
      <label>Tegenstanderteam</label>
      <input type="text" data-team value="${esc(r.opponentTeam.name || "")}" placeholder="naam van het team (mag later)" />
      <div data-players></div>
      <div class="row">
        <div><label>Jouw tegenstander</label>
          <select data-opp></select></div>
        <div><label>…of alleen een naam</label><input type="text" data-oppname value="${esc(r.opponentName || "")}" placeholder="naam" /></div>
      </div>
      <div data-bp></div>
      <label>Notities bij deze ronde</label>
      <textarea data-notes style="min-height:60px" placeholder="Pairing-keuzes, wat je opviel…">${esc(r.notes || "")}</textarea>
      <div class="btnrow"><button class="primary small" data-play>${st.btn}</button></div>
    </details>`);
    card.querySelector("[data-team]").addEventListener("input", (e) => { r.opponentTeam.name = e.target.value; saveSoon(); });
    card.querySelector("[data-players]").appendChild(teamCard(r.opponentTeam, { title: "Spelers van dit team", size: ev.teamSize, open: false }));
    // Spelers van het andere team vul je vaak net hierboven in: keuzelijst steeds vers vullen.
    const oppSel = card.querySelector("[data-opp]");
    const fillOpp = () => {
      const ps = (r.opponentTeam.players || []).filter((p) => p.name);
      oppSel.innerHTML = `<option value="">— kies (of typ hiernaast) —</option>` +
        ps.map((p) => `<option value="${p.id}"${p.id === r.opponentPlayerId ? " selected" : ""}>${esc(oppLabel(p))}</option>`).join("");
    };
    fillOpp();
    for (const evName of ["focus", "mousedown", "touchstart"]) oppSel.addEventListener(evName, fillOpp);
    oppSel.addEventListener("change", (e) => {
      r.opponentPlayerId = e.target.value;
      const p = (r.opponentTeam.players || []).find((x) => x.id === r.opponentPlayerId);
      if (p) r.opponentName = p.name;
      saveData(); draw();
    });
    card.querySelector("[data-oppname]").addEventListener("input", (e) => { r.opponentName = e.target.value; saveSoon(); });
    card.querySelector("[data-notes]").addEventListener("input", (e) => { r.notes = e.target.value; saveSoon(); });
    bpControls(r, card.querySelector("[data-bp]"));
    card.querySelector("[data-play]").addEventListener("click", () => play(ev, r));
    return card;
  }

  // Gegevens achteraf aanpassen; de teamgrootte vult spelersrijen aan (weghalen doe je per speler).
  function drawMeta(ev) {
    const isT = ev.kind === "teamTournament";
    let size = ev.teamSize;
    const wrap = el(`<div class="card"><h2>Gegevens — ${kindLabel(ev)}</h2>
      <label>Naam</label><input type="text" id="m-name" value="${esc(ev.name)}" />
      ${isT ? `<label>Naam van je team</label><input type="text" id="m-team" value="${esc(ev.myTeam?.name || "")}" />` : ""}
      <div class="row">
        <div><label>Datum</label><input type="date" id="m-date" value="${esc(ev.date || "")}" /></div>
        <div><label>Locatie</label><input type="text" id="m-location" value="${esc(ev.location || "")}" /></div>
      </div>
      ${isT ? `<label>Organisatie</label><input type="text" id="m-org" value="${esc(ev.organization || "")}" />
        <label>Jouw leger</label><select id="m-army">${armies().map((a) => `<option value="${a.id}"${a.id === ev.armyId ? " selected" : ""}>${esc(a.name || "(naamloos)")}</option>`).join("")}</select>` : ""}
      ${sizeField(size)}
      <div class="btnrow"><button class="primary" id="m-save">${icon("check")} Opslaan</button><button id="m-cancel">Annuleren</button></div>
    </div>`);
    wireSize(wrap, (n) => { size = n; });
    wrap.querySelector("#m-cancel").addEventListener("click", () => { editingMeta = false; draw(); });
    wrap.querySelector("#m-save").addEventListener("click", () => {
      const v = (id) => (wrap.querySelector(id)?.value || "").trim();
      const oldName = ev.name;
      ev.name = v("#m-name") || ev.name;
      // Slotnamen die nog het standaardpatroon volgen meelaten wijzigen (zonder gearchiveerde games los te koppelen).
      for (const s of slotsOf(ev)) if (!s.archivedId && s.name.startsWith(oldName)) s.name = ev.name + s.name.slice(oldName.length);
      ev.date = v("#m-date"); ev.location = v("#m-location"); ev.teamSize = size;
      if (isT) {
        ev.myTeam.name = v("#m-team"); ev.organization = v("#m-org");
        const a = v("#m-army");
        if (a && a !== ev.armyId) { ev.armyId = a; for (const r of ev.rounds || []) if (!r.game && !r.done) r.armyId = a; }
      }
      fillTeam(ev.myTeam, size, true);
      if (ev.opponents) fillTeam(ev.opponents, size, false);
      saveData(); editingMeta = false; draw();
    });
    app.appendChild(wrap);
  }

  draw();
}
