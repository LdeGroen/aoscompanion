import { buildScoreSummary, buildExportButtons, resultLabel, recomputeTotals } from "./scorecard.js";
import { icon } from "./icons.js";

// Archief: afgeronde games (scorekaarten) teruglezen, delen, bewerken of verwijderen.
// Records staan in state.data.gameArchive en syncen mee met de userdata.
export function renderArchive(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  state.data.gameArchive = state.data.gameArchive || [];
  let detail = null; // record dat open staat
  let editRec = null; // werkkopie tijdens bewerken (null = niet in bewerkmodus)

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  };

  function draw() {
    app.innerHTML = "";
    window.scrollTo(0, 0);

    const header = el(`<div class="topbar">
      <span class="title">${icon("flag", 18)} Archief</span>
      <button class="small" id="btn-back">${icon("back")} Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => {
      if (editRec) { editRec = null; draw(); }
      else if (detail) { detail = null; draw(); }
      else navigate("home");
    });
    app.appendChild(header);

    if (editRec) { drawEditor(); return; }

    if (detail) {
      app.appendChild(buildScoreSummary(detail, { el, esc }));
      const actions = el(`<div class="btnrow">
        <button class="small" id="ar-edit">${icon("edit")} Scores bewerken</button>
      </div>`);
      actions.querySelector("#ar-edit").addEventListener("click", () => {
        editRec = JSON.parse(JSON.stringify(detail));
        draw();
      });
      app.appendChild(actions);
      app.appendChild(buildExportButtons(detail, { el }));
      const delBtn = el(`<div class="btnrow"><button class="danger small">${icon("trash")} Verwijder uit archief</button></div>`);
      delBtn.querySelector("button").addEventListener("click", () => {
        if (!confirm("Deze game uit het archief verwijderen?")) return;
        state.data.gameArchive = state.data.gameArchive.filter((r) => r.id !== detail.id);
        saveData();
        detail = null;
        draw();
      });
      app.appendChild(delBtn);
      return;
    }

    const games = [...state.data.gameArchive].reverse(); // nieuwste eerst
    if (!games.length) {
      app.appendChild(el(`<p class="empty">Nog geen games in het archief. Een afgeronde game (met battleplan) wordt aan het einde automatisch opgeslagen.</p>`));
      return;
    }

    // Losse games apart; toernooi-games gegroepeerd per toernooi achter een uitvouw.
    const solo = games.filter((r) => !r.tournamentId);
    const groups = new Map(); // tournamentId -> { name, recs }
    for (const r of games) {
      if (!r.tournamentId) continue;
      if (!groups.has(r.tournamentId)) groups.set(r.tournamentId, { name: r.tournamentName || "Toernooi", recs: [] });
      groups.get(r.tournamentId).recs.push(r);
    }

    for (const rec of solo) app.appendChild(recCard(rec));

    for (const grp of groups.values()) {
      const wins = grp.recs.filter((r) => r.totals.player > r.totals.enemy).length;
      const det = el(`<details class="type-group" open style="margin-top:6px">
        <summary>${icon("trophy")} ${esc(grp.name)} <span class="count">(${grp.recs.length} games · ${wins} gewonnen)</span></summary>
        <div data-grp></div>
      </details>`);
      const box = det.querySelector("[data-grp]");
      for (const rec of grp.recs) box.appendChild(recCard(rec));
      app.appendChild(det);
    }
  }

  function recCard(rec) {
    const res = resultLabel(rec);
    const card = el(`<div class="card clickable">
      <div class="card-header">
        <div>
          <h3>${esc(rec.player.name)} ${rec.totals.player} — ${rec.totals.enemy} ${esc(rec.opponent.name)}</h3>
          <div class="subtitle">${rec.gameLabel ? esc(rec.gameLabel) + " · " : ""}${fmtDate(rec.date)} · ${esc(rec.opponent.faction || "?")}${rec.battleplan ? " · " + esc(rec.battleplan) : ""}</div>
        </div>
        <span class="chip tag ${res.win === true ? "" : "dim"}">${esc(res.text)}</span>
      </div>
    </div>`);
    card.addEventListener("click", () => { detail = rec; draw(); });
    return card;
  }

  // Bewerk-modus: objective-punten per ronde, tactics per ronde, endBonus en
  // liferoot rechtstreeks aanpassen; totalen live herberekend.
  function drawEditor() {
    const rec = editRec;
    const rounds = rec.rounds || [];

    const wrap = el(`<div class="scorecard">
      <div class="card">
        <div class="sc-head">
          <span class="subtitle">${fmtDate(rec.date)}</span>
          <span class="subtitle">Scores bewerken</span>
        </div>
        <div class="sc-score">
          <div class="sc-side"><div class="sc-name">${esc(rec.player.name)}</div></div>
          <div class="sc-mid"><div class="sc-points"><span data-tot="player">${rec.totals.player}</span> - <span data-tot="enemy">${rec.totals.enemy}</span></div></div>
          <div class="sc-side" style="text-align:right"><div class="sc-name">${esc(rec.opponent.name)}</div></div>
        </div>
        <div data-body></div>
      </div>
    </div>`);
    const body = wrap.querySelector("[data-body]");
    const totEls = { player: wrap.querySelector('[data-tot="player"]'), enemy: wrap.querySelector('[data-tot="enemy"]') };
    const refreshTotals = () => {
      recomputeTotals(rec);
      totEls.player.textContent = rec.totals.player;
      totEls.enemy.textContent = rec.totals.enemy;
    };

    // Objective-punten per ronde
    const objBlock = el(`<div class="sc-block"><h3>Objective control per ronde</h3></div>`);
    for (const r of rounds) {
      const line = el(`<div class="row tight" style="align-items:center;margin:4px 0">
        <div style="min-width:70px;flex:0 0 auto"><span class="subtitle">Ronde ${r.round}</span></div>
        <div><label>${esc(rec.player.name)}</label><input type="number" inputmode="numeric" data-side="player" value="${Number(r.player) || 0}" /></div>
        <div><label>${esc(rec.opponent.name)}</label><input type="number" inputmode="numeric" data-side="enemy" value="${Number(r.enemy) || 0}" /></div>
      </div>`);
      for (const inp of line.querySelectorAll("input")) {
        inp.addEventListener("input", (e) => { r[e.target.dataset.side] = Number(e.target.value) || 0; refreshTotals(); });
      }
      objBlock.appendChild(line);
    }
    body.appendChild(objBlock);

    // Tactics per kant (per ronde afvinken)
    const tacticsBlock = (side) => {
      const list = side === "player" ? rec.tactics : rec.enemyTactics;
      if (!list || !list.length) return null;
      const who = side === "player" ? rec.player.name : rec.opponent.name;
      const block = el(`<div class="sc-block"><h3>Battle tactics — ${esc(who)}</h3></div>`);
      for (const t of list) {
        t.scoredRounds = t.scoredRounds || [];
        const trow = el(`<div style="margin:6px 0"><div style="font-weight:600;font-size:0.9rem">${esc(t.name)}</div><div class="chips" data-rc></div></div>`);
        const rc = trow.querySelector("[data-rc]");
        for (let rn = 1; rn <= 5; rn++) {
          const on = t.scoredRounds.includes(rn);
          const chip = el(`<span class="chip${on ? " active" : ""}">R${rn}</span>`);
          chip.addEventListener("click", () => {
            const i = t.scoredRounds.indexOf(rn);
            if (i >= 0) t.scoredRounds.splice(i, 1); else t.scoredRounds.push(rn);
            chip.classList.toggle("active");
            refreshTotals();
          });
          rc.appendChild(chip);
        }
        block.appendChild(trow);
      }
      return block;
    };
    const tp = tacticsBlock("player"); if (tp) body.appendChild(tp);
    const te = tacticsBlock("enemy"); if (te) body.appendChild(te);

    // endBonus-eigenaar
    if (rec.endBonus) {
      const eb = el(`<div class="sc-block"><h3>Eindbonus</h3>
        <div class="subtitle" style="margin-bottom:4px">${esc(rec.endBonus.label)} (+${rec.endBonus.points})</div>
        <select>
          <option value="">Niemand</option>
          <option value="player">${esc(rec.player.name)}</option>
          <option value="enemy">${esc(rec.opponent.name)}</option>
        </select></div>`);
      const sel = eb.querySelector("select");
      sel.value = rec.endBonus.owner || "";
      sel.addEventListener("change", () => { rec.endBonus.owner = sel.value; refreshTotals(); });
      body.appendChild(eb);
    }

    // liferoot (informatief; telt niet mee in totaal, maar wel te corrigeren)
    if (rec.liferoot) {
      const lr = el(`<div class="sc-block"><h3>Liferoot points</h3>
        <div class="row tight">
          <div><label>${esc(rec.player.name)}</label><input type="number" inputmode="numeric" data-side="player" value="${Number(rec.liferoot.player) || 0}" /></div>
          <div><label>${esc(rec.opponent.name)}</label><input type="number" inputmode="numeric" data-side="enemy" value="${Number(rec.liferoot.enemy) || 0}" /></div>
        </div></div>`);
      for (const inp of lr.querySelectorAll("input")) {
        inp.addEventListener("input", (e) => { rec.liferoot[e.target.dataset.side] = Number(e.target.value) || 0; });
      }
      body.appendChild(lr);
    }

    app.appendChild(wrap);

    const actions = el(`<div class="btnrow">
      <button class="primary" id="ed-save">${icon("check")} Opslaan</button>
      <button id="ed-cancel">Annuleren</button>
    </div>`);
    actions.querySelector("#ed-save").addEventListener("click", () => {
      recomputeTotals(rec);
      const idx = state.data.gameArchive.findIndex((x) => x.id === rec.id);
      if (idx >= 0) state.data.gameArchive[idx] = rec;
      saveData();
      detail = rec;
      editRec = null;
      draw();
    });
    actions.querySelector("#ed-cancel").addEventListener("click", () => { editRec = null; draw(); });
    app.appendChild(actions);
  }

  draw();
}
