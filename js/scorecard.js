import { calcScores, TACTIC_STEP_POINTS } from "./battleplans.js";
import { uid } from "./storage.js";
import { icon } from "./icons.js";

// Scorekaart van een afgeronde game: opbouw van het game-record (voor het
// archief), het samenvattingsscherm, en export als tekst of PNG-afbeelding
// (canvas, geen dependencies).

const ROUNDS = [1, 2, 3, 4, 5];

export function buildGameRecord(army, game, playerName) {
  const s = calcScores(game);
  return {
    id: uid(),
    date: new Date().toISOString(),
    player: { name: playerName, faction: army.faction, subfaction: army.subfaction || "", army: army.name },
    opponent: {
      name: game.opponent?.name || "Tegenstander",
      faction: game.opponent?.faction || "",
      subfaction: game.opponent?.subfaction || "",
    },
    battleplan: game.battleplan?.name || "",
    rounds: ROUNDS.map((r) => ({
      round: r,
      player: s.player.perRound[r] || 0,
      enemy: s.enemy.perRound[r] || 0,
      firstTurn: game.firstTurnByRound?.[r] || "",
      underdog: game.underdog?.[r] || "",
    })),
    tactics: (game.tactics || []).map((t) => ({ name: t.name, scoredRounds: [...(t.scoredRounds || [])] })),
    enemyTactics: (game.enemyTactics || []).map((t) => ({ name: t.name, scoredRounds: [...(t.scoredRounds || [])] })),
    liferoot: game.battleplan?.scoring?.liferoot ? { ...(game.liferoot || {}) } : null,
    endBonus: game.battleplan?.scoring?.endBonus
      ? { label: game.battleplan.scoring.endBonus.label, points: game.battleplan.scoring.endBonus.points, owner: game.endBonusOwner || "" }
      : null,
    totals: { player: s.player.total, enemy: s.enemy.total },
  };
}

// Herberekent rec.totals uit de (mogelijk bewerkte) onderdelen van een
// archief-record: som van de objective-punten per ronde + tactics (5/step) +
// endBonus. Zelfde formule als calcSide, maar op recordniveau (voor het
// direct bewerken van een gearchiveerde game).
export function recomputeTotals(rec) {
  const sideTotal = (side) => {
    const obj = (rec.rounds || []).reduce((a, r) => a + (Number(r[side]) || 0), 0);
    const list = side === "player" ? rec.tactics : rec.enemyTactics;
    const tac = (list || []).reduce((a, t) => a + (t.scoredRounds || []).length * TACTIC_STEP_POINTS, 0);
    const eb = rec.endBonus && rec.endBonus.owner === side ? rec.endBonus.points : 0;
    return obj + tac + eb;
  };
  rec.totals = { player: sideTotal("player"), enemy: sideTotal("enemy") };
  return rec;
}

export function resultLabel(rec) {
  const d = rec.totals.player - rec.totals.enemy;
  if (d === 0) return { text: "Draw", win: null };
  const size = Math.abs(d) > 10 ? "Major" : "Minor";
  return d > 0 ? { text: `${size} victory`, win: true } : { text: `${size} defeat`, win: false };
}

const tacticsFor = (rec, side) => (side === "player" ? rec.tactics : rec.enemyTactics) || [];

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
};

// ---------- Samenvattingsscherm ----------
export function buildScoreSummary(rec, { el, esc }) {
  const res = resultLabel(rec);
  const wrap = el(`<div class="scorecard">
    <div class="card">
      <div class="sc-head">
        <span class="subtitle">${fmtDate(rec.date)}</span>
        <span class="subtitle">${esc(rec.player.name)} vs ${esc(rec.opponent.name)}</span>
      </div>
      <div class="sc-score">
        <div class="sc-side">
          <div class="sc-name">${esc(rec.player.name)}</div>
          <div class="subtitle">${esc(rec.player.faction)}${rec.player.subfaction ? " — " + esc(rec.player.subfaction) : ""}</div>
        </div>
        <div class="sc-mid">
          <div class="sc-points">${rec.totals.player} - ${rec.totals.enemy}</div>
          <div class="sc-result ${res.win === true ? "win" : res.win === false ? "loss" : ""}">${esc(res.text)}</div>
        </div>
        <div class="sc-side" style="text-align:right">
          <div class="sc-name">${esc(rec.opponent.name)}</div>
          <div class="subtitle">${esc(rec.opponent.faction)}${rec.opponent.subfaction ? " — " + esc(rec.opponent.subfaction) : ""}</div>
        </div>
      </div>
      ${rec.battleplan ? `<div class="subtitle" style="text-align:center">Battleplan: ${esc(rec.battleplan)}</div>` : ""}
      <div data-blocks></div>
    </div>
  </div>`);
  const blocks = wrap.querySelector("[data-blocks]");
  blocks.appendChild(sideBlock(rec, "player", { el, esc }));
  blocks.appendChild(sideBlock(rec, "enemy", { el, esc }));
  return wrap;
}

function sideBlock(rec, side, { el, esc }) {
  const who = side === "player" ? rec.player : rec.opponent;
  const block = el(`<div class="sc-block">
    <h3>${esc(who.name)}</h3>
    <table class="scoregrid"><tbody data-rows></tbody></table>
  </div>`);
  const rows = block.querySelector("[data-rows]");

  const row = (label, cells, total) => {
    rows.appendChild(el(`<tr>
      <td class="lbl">${label}</td>
      ${cells.map((c) => `<td class="cell">${c}</td>`).join("")}
      <td class="tot">${total}</td>
    </tr>`));
  };

  row("Eerste beurt", rec.rounds.map((r) => (r.firstTurn === side ? "✓" : "·")), "");
  row("Underdog", rec.rounds.map((r) => (r.underdog === side ? "✓" : "·")), "");
  const objTotal = rec.rounds.reduce((a, r) => a + r[side], 0);
  row("Objective control", rec.rounds.map((r) => String(r[side])), String(objTotal));

  for (const t of tacticsFor(rec, side)) {
    row(esc(t.name),
      rec.rounds.map((r) => (t.scoredRounds.includes(r.round) ? String(TACTIC_STEP_POINTS) : "·")),
      `${t.scoredRounds.length * TACTIC_STEP_POINTS}/${3 * TACTIC_STEP_POINTS}`);
  }
  if (rec.liferoot) {
    rows.appendChild(el(`<tr><td class="lbl">Liferoot points</td><td class="cell" colspan="5">${rec.liferoot[side] || 0}</td><td class="tot"></td></tr>`));
  }
  if (rec.endBonus && rec.endBonus.owner === side) {
    rows.appendChild(el(`<tr><td class="lbl">${esc(rec.endBonus.label)}</td><td class="cell" colspan="5"></td><td class="tot">+${rec.endBonus.points}</td></tr>`));
  }
  rows.appendChild(el(`<tr><td class="lbl"><strong>Totaal</strong></td><td class="cell" colspan="5"></td><td class="tot"><strong>${rec.totals[side]}</strong></td></tr>`));
  return block;
}

// ---------- Export ----------
export function recordAsText(rec) {
  const res = resultLabel(rec);
  const lines = [];
  lines.push(`${fmtDate(rec.date)} — ${rec.player.name} vs ${rec.opponent.name}`);
  lines.push(`${rec.player.faction}${rec.player.subfaction ? " (" + rec.player.subfaction + ")" : ""} vs ${rec.opponent.faction}${rec.opponent.subfaction ? " (" + rec.opponent.subfaction + ")" : ""}`);
  if (rec.battleplan) lines.push(`Battleplan: ${rec.battleplan}`);
  lines.push(`Eindstand: ${rec.totals.player} - ${rec.totals.enemy} (${res.text})`);
  lines.push("");
  for (const side of ["player", "enemy"]) {
    const who = side === "player" ? rec.player : rec.opponent;
    lines.push(`${who.name}:`);
    lines.push(`  Objective control: ${rec.rounds.map((r) => r[side]).join(" | ")} = ${rec.rounds.reduce((a, r) => a + r[side], 0)}`);
    for (const t of tacticsFor(rec, side)) {
      lines.push(`  ${t.name}: ${rec.rounds.map((r) => (t.scoredRounds.includes(r.round) ? TACTIC_STEP_POINTS : "-")).join(" | ")} = ${t.scoredRounds.length * TACTIC_STEP_POINTS}/15`);
    }
    if (rec.liferoot) lines.push(`  Liferoot points: ${rec.liferoot[side] || 0}`);
    if (rec.endBonus && rec.endBonus.owner === side) lines.push(`  ${rec.endBonus.label}: +${rec.endBonus.points}`);
    lines.push(`  Totaal: ${rec.totals[side]}`);
    lines.push("");
  }
  lines.push("Gemaakt met AoS Companion");
  return lines.join("\n");
}

// Tekent de scorekaart op een canvas (donkere stijl) voor delen als afbeelding.
export function drawScoreImage(rec) {
  const W = 640;
  const rowH = 30;
  const playerRows = 3 + tacticsFor(rec, "player").length + (rec.liferoot ? 1 : 0) + (rec.endBonus?.owner === "player" ? 1 : 0) + 1;
  const enemyRows = 3 + tacticsFor(rec, "enemy").length + (rec.liferoot ? 1 : 0) + (rec.endBonus?.owner === "enemy" ? 1 : 0) + 1;
  const H = 170 + (playerRows + enemyRows) * rowH + 2 * 46 + 40;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext("2d");

  c.fillStyle = "#15161c"; c.fillRect(0, 0, W, H);
  const gold = "#c9a227", text = "#e8e6df", dim = "#a7a497";

  c.fillStyle = dim; c.font = "14px Segoe UI, sans-serif";
  c.fillText(fmtDate(rec.date), 24, 32);
  c.textAlign = "right"; c.fillText(`${rec.player.name} vs ${rec.opponent.name}`, W - 24, 32);
  c.textAlign = "left";

  // namen + facties
  c.fillStyle = text; c.font = "bold 20px Georgia, serif";
  c.fillText(rec.player.name, 24, 70);
  c.textAlign = "right"; c.fillText(rec.opponent.name, W - 24, 70);
  c.textAlign = "left";
  c.fillStyle = dim; c.font = "13px Segoe UI, sans-serif";
  c.fillText(`${rec.player.faction}${rec.player.subfaction ? " — " + rec.player.subfaction : ""}`, 24, 90);
  c.textAlign = "right";
  c.fillText(`${rec.opponent.faction}${rec.opponent.subfaction ? " — " + rec.opponent.subfaction : ""}`, W - 24, 90);
  c.textAlign = "center";

  // grote score + resultaat
  c.fillStyle = text; c.font = "bold 40px Georgia, serif";
  c.fillText(`${rec.totals.player} - ${rec.totals.enemy}`, W / 2, 78);
  const res = resultLabel(rec);
  c.fillStyle = res.win === true ? "#5d9b6c" : res.win === false ? "#b34a4a" : dim;
  c.font = "bold 15px Segoe UI, sans-serif";
  c.fillText(res.text.toUpperCase(), W / 2, 100);
  if (rec.battleplan) { c.fillStyle = dim; c.font = "13px Segoe UI, sans-serif"; c.fillText(`Battleplan: ${rec.battleplan}`, W / 2, 122); }
  c.textAlign = "left";

  // blokken
  const cellX = (i) => 280 + i * 56;
  let y = 150;
  const drawBlock = (side) => {
    const who = side === "player" ? rec.player : rec.opponent;
    c.fillStyle = gold; c.font = "bold 18px Georgia, serif";
    c.fillText(who.name, 24, y + 24);
    y += 40;
    const drawRow = (label, cells, total, bold = false) => {
      c.fillStyle = dim; c.font = `${bold ? "bold " : ""}13px Segoe UI, sans-serif`;
      c.fillText(label.length > 30 ? label.slice(0, 29) + "…" : label, 24, y + 19);
      cells.forEach((v, i) => {
        c.fillStyle = "#272a37"; c.fillRect(cellX(i), y, 48, rowH - 6);
        c.fillStyle = text; c.textAlign = "center"; c.font = "13px Segoe UI, sans-serif";
        c.fillText(String(v), cellX(i) + 24, y + 19);
        c.textAlign = "left";
      });
      c.fillStyle = bold ? gold : text; c.font = `${bold ? "bold " : ""}13px Segoe UI, sans-serif`;
      c.fillText(String(total), cellX(5) + 8, y + 19);
      y += rowH;
    };
    drawRow("Eerste beurt", rec.rounds.map((r) => (r.firstTurn === side ? "✓" : "·")), "");
    drawRow("Underdog", rec.rounds.map((r) => (r.underdog === side ? "✓" : "·")), "");
    drawRow("Objective control", rec.rounds.map((r) => r[side]), rec.rounds.reduce((a, r) => a + r[side], 0));
    for (const t of tacticsFor(rec, side)) {
      drawRow(t.name, rec.rounds.map((r) => (t.scoredRounds.includes(r.round) ? TACTIC_STEP_POINTS : "·")), `${t.scoredRounds.length * TACTIC_STEP_POINTS}/15`);
    }
    if (rec.liferoot) drawRow("Liferoot points", [rec.liferoot[side] || 0, "", "", "", ""], "");
    if (rec.endBonus?.owner === side) drawRow(rec.endBonus.label, ["", "", "", "", ""], `+${rec.endBonus.points}`);
    drawRow("Totaal", ["", "", "", "", ""], rec.totals[side], true);
    y += 6;
  };
  drawBlock("player");
  drawBlock("enemy");

  c.fillStyle = dim; c.font = "italic 12px Segoe UI, sans-serif";
  c.fillText("Gemaakt met AoS Companion", 24, H - 14);
  return canvas;
}

// Exportknoppen (kopieer tekst + deel/download afbeelding) onder een samenvatting.
export function buildExportButtons(rec, { el }) {
  const row = el(`<div class="btnrow">
    <button class="small" data-act="copy">${icon("copy")} Kopieer als tekst</button>
    <button class="small" data-act="img">${icon("share")} Deel als afbeelding</button>
  </div>`);
  row.querySelector('[data-act="copy"]').addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(recordAsText(rec));
      e.currentTarget.innerHTML = `${icon("check")} Gekopieerd!`;
    } catch {
      alert("Kopiëren mislukt — selecteer en kopieer handmatig:\n\n" + recordAsText(rec));
    }
  });
  row.querySelector('[data-act="img"]').addEventListener("click", () => {
    const canvas = drawScoreImage(rec);
    canvas.toBlob(async (blob) => {
      const file = new File([blob], "aos-score.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "AoS score" }); return; } catch { /* geannuleerd → download */ }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "aos-score.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  });
  return row;
}
