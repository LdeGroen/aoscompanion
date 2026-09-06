import { TACTIC_STEP_POINTS } from "./battleplans.js";
import { resultLabel } from "./scorecard.js";
import { icon } from "./icons.js";

// Statistieken over alle gearchiveerde games (losse potjes én toernooigames).
// Alles wordt live uit state.data.gameArchive gerekend; er wordt niets opgeslagen.
//
// Wat een record aan bruikbare data heeft (zie scorecard.buildGameRecord):
//   date, player {name, faction, subfaction, army}, opponent {name, faction, subfaction},
//   battleplan, rounds[5] {round, player, enemy, firstTurn, underdog},
//   tactics[] {name, scoredRounds[]}, enemyTactics[], endBonus, totals {player, enemy}
//   en voor toernooigames: tournamentId, tournamentName, gameLabel.

const ROUNDS = [1, 2, 3, 4, 5];
const TACTIC_STEPS = 3; // een battle tactic is in 3 stappen (rondes) volledig te scoren

// ---------- kleine helpers ----------
const sum = (list) => list.reduce((a, b) => a + b, 0);
const avg = (list) => (list.length ? sum(list) / list.length : null);
const fmt = (n, dec = 1) => (n === null || n === undefined || Number.isNaN(n) ? "–" : n.toFixed(dec).replace(".", ","));
const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "–");
const armyOf = (rec) => rec.player?.army || "Onbekend leger";

// Win = meer punten. resultLabel geeft ook major/minor terug (>10 verschil = major).
const isWin = (rec) => rec.totals.player > rec.totals.enemy;
const isLoss = (rec) => rec.totals.player < rec.totals.enemy;

// Punten uit battle tactics (5 per gescoorde stap) en het aantal gescoorde stappen.
const tacticSteps = (rec, side) => sum(((side === "enemy" ? rec.enemyTactics : rec.tactics) || []).map((t) => (t.scoredRounds || []).length));
const objPoints = (rec, side) => sum((rec.rounds || []).map((r) => Number(r[side]) || 0));

export function renderStats(ctx) {
  const { state, app, navigate, el, esc } = ctx;
  const all = state.data.gameArchive || [];

  let armyFilter = null;              // null = alle legers
  let scope = "all";                  // all | tournament | casual

  function selection() {
    return all.filter((r) => {
      if (armyFilter && armyOf(r) !== armyFilter) return false;
      if (scope === "tournament" && !r.tournamentId) return false;
      if (scope === "casual" && r.tournamentId) return false;
      return true;
    });
  }

  function draw() {
    app.innerHTML = "";
    window.scrollTo(0, 0);

    const header = el(`<div class="topbar">
      <span class="title">${icon("chart", 18)} Statistieken</span>
      <button class="small" id="btn-back">${icon("back")} Terug</button>
    </div>`);
    header.querySelector("#btn-back").addEventListener("click", () => navigate("home"));
    app.appendChild(header);

    if (!all.length) {
      app.appendChild(el(`<p class="empty">Nog geen afgeronde games in het archief — speel een potje uit, dan verschijnen hier je statistieken.</p>`));
      return;
    }

    app.appendChild(filterBar());

    const recs = selection();
    if (!recs.length) {
      app.appendChild(el(`<p class="empty">Geen games die aan deze filters voldoen.</p>`));
      return;
    }

    app.appendChild(overviewCard(recs));
    app.appendChild(firstTurnCard(recs));
    app.appendChild(roundsCard(recs));
    app.appendChild(tacticsCard(recs));
    app.appendChild(battleplanCard(recs));
    app.appendChild(opponentCard(recs));
    if (!armyFilter) app.appendChild(armyCard(recs));
    app.appendChild(funCard(recs));
    app.appendChild(timelineCard(recs));
  }

  // ---------- filters ----------
  function filterBar() {
    const armies = [...new Set(all.map(armyOf))].sort((a, b) => a.localeCompare(b));
    const wrap = el(`<div class="card">
      <div class="subtitle">Leger</div>
      <div class="chips" data-armies></div>
      <div class="subtitle" style="margin-top:8px">Soort game</div>
      <div class="chips" data-scope></div>
    </div>`);

    const armyBox = wrap.querySelector("[data-armies]");
    const addArmy = (label, value) => {
      const c = el(`<button class="chip${armyFilter === value ? " active" : ""}">${esc(label)}</button>`);
      c.addEventListener("click", () => { armyFilter = value; draw(); });
      armyBox.appendChild(c);
    };
    addArmy(`Alle legers (${all.length})`, null);
    for (const a of armies) addArmy(`${a} (${all.filter((r) => armyOf(r) === a).length})`, a);

    const scopeBox = wrap.querySelector("[data-scope]");
    const nTour = all.filter((r) => r.tournamentId).length;
    for (const [key, label] of [["all", `Alles (${all.length})`], ["tournament", `Toernooi (${nTour})`], ["casual", `Los (${all.length - nTour})`]]) {
      const c = el(`<button class="chip${scope === key ? " active" : ""}">${esc(label)}</button>`);
      c.addEventListener("click", () => { scope = key; draw(); });
      scopeBox.appendChild(c);
    }
    return wrap;
  }

  // ---------- bouwstenen ----------
  function statBlocks(pairs) {
    return `<div class="stats">${pairs
      .filter(Boolean)
      .map(([k, v]) => `<div class="stat"><span class="v">${esc(String(v))}</span><span class="k">${esc(k)}</span></div>`)
      .join("")}</div>`;
  }

  // Tabel met een label-kolom en verder rechts uitgelijnde waarden.
  function table(headers, rows) {
    return `<table class="statgrid">
      <thead><tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }

  const section = (title, inner) => el(`<div class="card"><h3>${title}</h3>${inner}</div>`);

  // Win-loss-draw van een setje records als "5-1-2 (63%)"
  function record(recs) {
    const w = recs.filter(isWin).length, l = recs.filter(isLoss).length;
    return { w, l, d: recs.length - w - l, rate: pct(w, recs.length) };
  }

  // ---------- 1. overzicht ----------
  function overviewCard(recs) {
    const r = record(recs);
    const majors = recs.filter((x) => resultLabel(x).text.startsWith("Major") && isWin(x)).length;
    const majorL = recs.filter((x) => resultLabel(x).text.startsWith("Major") && isLoss(x)).length;
    const forPts = recs.map((x) => x.totals.player);
    const agPts = recs.map((x) => x.totals.enemy);

    // Reeksen: op datum gesorteerd, draws breken een reeks niet af maar tellen niet mee.
    const chrono = [...recs].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let best = 0, run = 0, current = 0, currentKind = "";
    for (const x of chrono) {
      if (isWin(x)) { run++; best = Math.max(best, run); } else if (isLoss(x)) { run = 0; }
    }
    for (let i = chrono.length - 1; i >= 0; i--) {
      const x = chrono[i];
      const kind = isWin(x) ? "w" : isLoss(x) ? "l" : "d";
      if (kind === "d") continue;
      if (!currentKind) currentKind = kind;
      if (kind !== currentKind) break;
      current++;
    }

    return section(`${icon("trophy", 18)} Overzicht`, statBlocks([
      ["games", recs.length],
      ["winst%", r.rate],
      ["W-G-V", `${r.w}-${r.d}-${r.l}`],
      ["major wins", majors],
      ["major losses", majorL],
      ["gem. punten", fmt(avg(forPts))],
      ["gem. tegen", fmt(avg(agPts))],
      ["gem. saldo", fmt(avg(recs.map((x) => x.totals.player - x.totals.enemy)))],
      ["hoogste score", Math.max(...forPts)],
      ["langste winreeks", best],
      current ? [currentKind === "w" ? "reeks: winst" : "reeks: verlies", current] : null,
    ]));
  }

  // ---------- 2. eerste beurt in ronde 1 ----------
  function firstTurnCard(recs) {
    const withR1 = recs.filter((x) => x.rounds?.[0]?.firstTurn);
    const mine = withR1.filter((x) => x.rounds[0].firstTurn === "player");
    const theirs = withR1.filter((x) => x.rounds[0].firstTurn === "enemy");

    const row = (label, set) => {
      const r = record(set);
      return [label, set.length, `<strong>${r.rate}</strong>`, `${r.w}-${r.d}-${r.l}`,
        fmt(avg(set.map((x) => x.totals.player))), fmt(avg(set.map((x) => x.totals.player - x.totals.enemy)))];
    };

    let inner = statBlocks([
      ["games met data", withR1.length],
      ["jij begon", `${withR1.length ? Math.round((mine.length / withR1.length) * 100) : 0}%`],
      ["winst% als jij begint", record(mine).rate],
      ["winst% als hij begint", record(theirs).rate],
    ]);
    inner += table(["Ronde 1", "Games", "Winst%", "W-G-V", "Gem. score", "Gem. saldo"], [row("Jij eerst", mine), row("Tegenstander eerst", theirs)]);
    if (withR1.length < recs.length) {
      inner += `<p class="subtitle">${recs.length - withR1.length} game(s) hebben geen eerste-beurt-gegevens en tellen hier niet mee.</p>`;
    }
    return section(`${icon("zap", 18)} Eerste beurt (ronde 1)`, inner);
  }

  // ---------- 3. punten per battleround ----------
  function roundsCard(recs) {
    // Let op: rounds[].player is objective control; battle-tacticpunten zitten er niet in.
    const rows = ROUNDS.map((n) => {
      const rs = recs.map((x) => (x.rounds || []).find((r) => r.round === n)).filter(Boolean);
      const first = rs.filter((r) => r.firstTurn === "player");
      const second = rs.filter((r) => r.firstTurn === "enemy");
      return [`Ronde ${n}`,
        fmt(avg(rs.map((r) => Number(r.player) || 0))),
        fmt(avg(rs.map((r) => Number(r.enemy) || 0))),
        fmt(avg(first.map((r) => Number(r.player) || 0))),
        fmt(avg(second.map((r) => Number(r.player) || 0))),
        pct(first.length, first.length + second.length)];
    });

    const allRounds = recs.flatMap((x) => x.rounds || []);
    const first = allRounds.filter((r) => r.firstTurn === "player");
    const second = allRounds.filter((r) => r.firstTurn === "enemy");
    rows.push([`<strong>Gemiddeld</strong>`,
      `<strong>${fmt(avg(allRounds.map((r) => Number(r.player) || 0)))}</strong>`,
      `<strong>${fmt(avg(allRounds.map((r) => Number(r.enemy) || 0)))}</strong>`,
      `<strong>${fmt(avg(first.map((r) => Number(r.player) || 0)))}</strong>`,
      `<strong>${fmt(avg(second.map((r) => Number(r.player) || 0)))}</strong>`,
      `<strong>${pct(first.length, first.length + second.length)}</strong>`]);

    const diff = (avg(first.map((r) => Number(r.player) || 0)) || 0) - (avg(second.map((r) => Number(r.player) || 0)) || 0);
    let inner = statBlocks([
      ["gem. objectives p/ronde", fmt(avg(allRounds.map((r) => Number(r.player) || 0)))],
      ["als eerste in de ronde", fmt(avg(first.map((r) => Number(r.player) || 0)))],
      ["als tweede in de ronde", fmt(avg(second.map((r) => Number(r.player) || 0)))],
      ["verschil", (diff >= 0 ? "+" : "") + fmt(diff)],
    ]);
    inner += table(["", "Jij", "Tegenstander", "Jij, 1e beurt", "Jij, 2e beurt", "Jij eerst"], rows);
    inner += `<p class="subtitle">Dit zijn objective-punten per battleround; battle tactics tellen apart (hieronder).</p>`;
    return section(`${icon("flag", 18)} Punten per battleround`, inner);
  }

  // ---------- 4. battle tactics ----------
  function tacticsCard(recs) {
    const withT = recs.filter((x) => (x.tactics || []).length);
    const stepsPerGame = withT.map((x) => tacticSteps(x, "player"));
    const fullPerGame = withT.map((x) => (x.tactics || []).filter((t) => (t.scoredRounds || []).length >= TACTIC_STEPS).length);
    const maxSteps = sum(withT.map((x) => (x.tactics || []).length * TACTIC_STEPS));

    let inner = statBlocks([
      ["gem. tacticpunten p/game", fmt(avg(stepsPerGame.map((s) => s * TACTIC_STEP_POINTS)))],
      ["gem. stappen p/game", fmt(avg(stepsPerGame))],
      ["volledig gescoord p/game", fmt(avg(fullPerGame))],
      ["stappen gescoord", pct(sum(stepsPerGame), maxSteps)],
      ["tegenstander p/game", fmt(avg(withT.map((x) => tacticSteps(x, "enemy") * TACTIC_STEP_POINTS)))],
    ]);

    // Per tactic: hoe vaak gekozen, gemiddeld aantal stappen, hoe vaak volledig,
    // en (zonder legerfilter) met welke legers je hem speelde.
    const per = new Map();
    for (const rec of withT) {
      for (const t of rec.tactics || []) {
        const key = t.name || "Onbekend";
        if (!per.has(key)) per.set(key, { name: key, n: 0, steps: [], full: 0, armies: new Set(), wins: 0 });
        const e = per.get(key);
        e.n++;
        e.steps.push((t.scoredRounds || []).length);
        if ((t.scoredRounds || []).length >= TACTIC_STEPS) e.full++;
        e.armies.add(armyOf(rec));
        if (isWin(rec)) e.wins++;
      }
    }
    const list = [...per.values()].sort((a, b) => b.n - a.n || (avg(b.steps) - avg(a.steps)));
    if (list.length) {
      const headers = ["Battle tactic", "Gespeeld", "Gem. stappen", "Volledig", "Punten"];
      if (!armyFilter) headers.push("Legers");
      inner += table(headers, list.map((e) => {
        const row = [esc(e.name), e.n, fmt(avg(e.steps), 2), pct(e.full, e.n), fmt(avg(e.steps) * TACTIC_STEP_POINTS)];
        if (!armyFilter) row.push(esc([...e.armies].join(", ")));
        return row;
      }));
      inner += `<p class="subtitle">Een tactic is in ${TACTIC_STEPS} stappen te scoren (${TACTIC_STEP_POINTS} punten per stap). Kies een leger hierboven om te zien of je tactics per leger anders uitpakken.</p>`;
    }
    if (withT.length < recs.length) {
      inner += `<p class="subtitle">${recs.length - withT.length} game(s) zonder vastgelegde tactics tellen hier niet mee.</p>`;
    }
    return section(`${icon("star", 18)} Battle tactics`, inner);
  }

  // ---------- 5. battleplans ----------
  function battleplanCard(recs) {
    const per = new Map();
    for (const rec of recs) {
      const key = rec.battleplan || "Zonder battleplan";
      if (!per.has(key)) per.set(key, []);
      per.get(key).push(rec);
    }
    const rows = [...per.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, set]) => {
        const r = record(set);
        return [esc(name), set.length, `${r.w}-${r.d}-${r.l}`, r.rate,
          fmt(avg(set.map((x) => x.totals.player))), fmt(avg(set.map((x) => x.totals.player - x.totals.enemy)))];
      });
    return section(`${icon("map", 18)} Battleplans`, table(["Battleplan", "Games", "W-G-V", "Winst%", "Gem. score", "Gem. saldo"], rows));
  }

  // ---------- 6. tegenstanders ----------
  function opponentCard(recs) {
    const group = (keyFn) => {
      const per = new Map();
      for (const rec of recs) {
        const key = keyFn(rec) || "Onbekend";
        if (!per.has(key)) per.set(key, []);
        per.get(key).push(rec);
      }
      return [...per.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    };
    const rows = (entries) => entries.map(([name, set]) => {
      const r = record(set);
      return [esc(name), set.length, `${r.w}-${r.d}-${r.l}`, r.rate, fmt(avg(set.map((x) => x.totals.player - x.totals.enemy)))];
    });

    const head = ["", "Games", "W-G-V", "Winst%", "Gem. saldo"];
    let inner = `<div class="subtitle">Per faction</div>`;
    inner += table(head, rows(group((r) => r.opponent?.faction)));
    inner += `<div class="subtitle" style="margin-top:10px">Per tegenstander</div>`;
    inner += table(head, rows(group((r) => r.opponent?.name)));
    return section(`${icon("users", 18)} Tegenstanders`, inner);
  }

  // ---------- 7. per leger ----------
  function armyCard(recs) {
    const per = new Map();
    for (const rec of recs) {
      const key = armyOf(rec);
      if (!per.has(key)) per.set(key, []);
      per.get(key).push(rec);
    }
    const rows = [...per.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, set]) => {
        const r = record(set);
        const steps = set.filter((x) => (x.tactics || []).length).map((x) => tacticSteps(x, "player"));
        return [esc(name), esc(set[0].player?.faction || ""), set.length, `${r.w}-${r.d}-${r.l}`, r.rate,
          fmt(avg(set.map((x) => x.totals.player))), fmt(avg(steps.map((s) => s * TACTIC_STEP_POINTS)))];
      });
    return section(`${icon("sword", 18)} Per leger`, table(["Leger", "Faction", "Games", "W-G-V", "Winst%", "Gem. score", "Gem. tacticpunten"], rows));
  }

  // ---------- 8. losse weetjes ----------
  function funCard(recs) {
    const chrono = [...recs].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const bestGame = [...recs].sort((a, b) => (b.totals.player - b.totals.enemy) - (a.totals.player - a.totals.enemy))[0];
    const worstGame = [...recs].sort((a, b) => (a.totals.player - a.totals.enemy) - (b.totals.player - b.totals.enemy))[0];

    const objTotal = sum(recs.map((x) => objPoints(x, "player")));
    const tacTotal = sum(recs.map((x) => tacticSteps(x, "player") * TACTIC_STEP_POINTS));
    const grand = sum(recs.map((x) => x.totals.player)) || 1;

    const underdogRounds = recs.flatMap((x) => x.rounds || []).filter((r) => r.underdog === "player").length;
    const anyUnderdog = recs.filter((x) => (x.rounds || []).some((r) => r.underdog === "player"));
    const endBonus = recs.filter((x) => x.endBonus);
    const endBonusMine = endBonus.filter((x) => x.endBonus.owner === "player");

    const tourn = recs.filter((x) => x.tournamentId), casual = recs.filter((x) => !x.tournamentId);

    let inner = statBlocks([
      ["punten uit objectives", pct(objTotal, grand)],
      ["punten uit tactics", pct(tacTotal, grand)],
      ["rondes als underdog", underdogRounds],
      anyUnderdog.length ? ["winst% met underdog-ronde", record(anyUnderdog).rate] : null,
      endBonus.length ? ["end bonus gepakt", pct(endBonusMine.length, endBonus.length)] : null,
      tourn.length ? ["winst% toernooi", record(tourn).rate] : null,
      casual.length ? ["winst% los", record(casual).rate] : null,
      ["eerste game", new Date(chrono[0].date).toLocaleDateString("nl-NL")],
    ]);
    if (bestGame) {
      inner += `<p class="subtitle">Grootste overwinning: <strong>${bestGame.totals.player}–${bestGame.totals.enemy}</strong> tegen ${esc(bestGame.opponent?.name || "?")} (${esc(bestGame.opponent?.faction || "?")}) met ${esc(armyOf(bestGame))}.</p>`;
    }
    if (worstGame && worstGame !== bestGame) {
      inner += `<p class="subtitle">Zwaarste nederlaag: <strong>${worstGame.totals.player}–${worstGame.totals.enemy}</strong> tegen ${esc(worstGame.opponent?.name || "?")} (${esc(worstGame.opponent?.faction || "?")}) met ${esc(armyOf(worstGame))}.</p>`;
    }
    return section(`${icon("skull", 18)} Losse weetjes`, inner);
  }

  // ---------- 9. tijdlijn ----------
  function timelineCard(recs) {
    const per = new Map();
    for (const rec of recs) {
      const d = new Date(rec.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!per.has(key)) per.set(key, []);
      per.get(key).push(rec);
    }
    const entries = [...per.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(...entries.map(([, s]) => s.length));
    const bars = entries.map(([key, set]) => {
      const r = record(set);
      const [y, m] = key.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("nl-NL", { month: "short", year: "2-digit" });
      return `<div class="tl-row">
        <span class="tl-lbl">${esc(label)}</span>
        <span class="tl-bar"><span style="width:${Math.round((set.length / max) * 100)}%"></span></span>
        <span class="tl-val">${set.length} · ${r.w}W</span>
      </div>`;
    }).join("");
    return section(`${icon("list", 18)} Games per maand`, `<div class="timeline">${bars}</div>`);
  }

  draw();
}
