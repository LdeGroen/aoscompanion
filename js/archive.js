import { buildScoreSummary, buildExportButtons, resultLabel } from "./scorecard.js";
import { icon } from "./icons.js";

// Archief: afgeronde games (scorekaarten) teruglezen, delen of verwijderen.
// Records staan in state.data.gameArchive en syncen mee met de userdata.
export function renderArchive(ctx) {
  const { state, app, navigate, saveData, el, esc } = ctx;
  state.data.gameArchive = state.data.gameArchive || [];
  let detail = null; // record dat open staat

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
      if (detail) { detail = null; draw(); }
      else navigate("home");
    });
    app.appendChild(header);

    if (detail) {
      app.appendChild(buildScoreSummary(detail, { el, esc }));
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
    for (const rec of games) {
      const res = resultLabel(rec);
      const card = el(`<div class="card clickable">
        <div class="card-header">
          <div>
            <h3>${esc(rec.player.name)} ${rec.totals.player} — ${rec.totals.enemy} ${esc(rec.opponent.name)}</h3>
            <div class="subtitle">${fmtDate(rec.date)} · ${esc(rec.opponent.faction || "?")}${rec.battleplan ? " · " + esc(rec.battleplan) : ""}</div>
          </div>
          <span class="chip tag ${res.win === true ? "" : "dim"}">${esc(res.text)}</span>
        </div>
      </div>`);
      card.addEventListener("click", () => { detail = rec; draw(); });
      app.appendChild(card);
    }
  }

  draw();
}
