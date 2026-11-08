import * as backend from "./backend.js";
import * as sharedb from "./sharedb.js";
import { AOS_FACTIONS, enhancementCategoryLabel } from "./factions.js";
import { abilityBodyHtml } from "./abilityview.js";
import { buildModelPopupContent, openModal } from "./modelview.js";
import { icon } from "./icons.js";

// Regelarchief: bij grote wijzigingen (nieuw boek, puntenupdate, nieuw GHB-seizoen, nieuwe
// editie) bewaart ko-import/rulesarchive.mjs eerst de oude regels. Elke game in het archief
// is gekoppeld aan een editie en een General's Handbook-seizoen (`rec.rules`), zodat je bij
// een game van vroeger, of met een army die niet meer bestaat, de regels van toen terugleest.
//
// Index: gedeelde blob "rulesarchive" = { current: {edition, ghb}, editions, ghbSeasons,
// versions: [{id, kind, subject, label, until, edition, ghb, key}] }. Een versie is de stand
// zoals die gold tót `until`; de inhoud staat in de gedeelde blob `key`.
//   kind "faction"  → {faction: <faction-blob>, armiesOfRenown: [...]}
//   kind "gamedata" → General's Handbook: {battleplans, tactics, seasonalRules}
//   kind "renown"   → {regimentsOfRenown, armiesOfRenown}
//   kind "universal"→ universele lores en manifestations

// Wat geldt als er (nog) geen index is, en voor games van vóór deze feature: AoS 4 met het
// GHB 2026-27 (Luc, 08-11-2026).
export const DEFAULT_RULES = { edition: "aos4", ghb: "ghb-2026-27" };
const FALLBACK_INDEX = {
  current: { ...DEFAULT_RULES },
  editions: [{ id: "aos4", name: "Age of Sigmar 4th edition" }],
  ghbSeasons: [{ id: "ghb-2026-27", name: "General's Handbook 2026-27", edition: "aos4" }],
  versions: [],
};

function normalize(obj) {
  const idx = obj || JSON.parse(JSON.stringify(FALLBACK_INDEX));
  idx.current = { ...DEFAULT_RULES, ...(idx.current || {}) };
  idx.editions = idx.editions || [];
  idx.ghbSeasons = idx.ghbSeasons || [];
  idx.versions = idx.versions || [];
  return idx;
}

let cache = null;
export async function loadRulesIndex() {
  if (cache) return cache;
  try { cache = (await sharedb.loadSharedBlob("rulesarchive", normalize)).db; }
  catch { cache = normalize(null); }
  return cache;
}
// Synchroon bruikbaar (bij het opslaan van een game): de laatst geladen index, anders de standaard.
export const currentRules = () => ({ ...(cache || FALLBACK_INDEX).current });

export const rulesOf = (rec) => ({ ...DEFAULT_RULES, ...(rec?.rules || {}) });
export const editionName = (idx, id) => idx.editions.find((e) => e.id === id)?.name || id;
export const ghbName = (idx, id) => idx.ghbSeasons.find((s) => s.id === id)?.name || id;

// De versie die gold op `date`: de eerste die ná die datum is gearchiveerd. Geen → de huidige regels.
function versionAt(idx, kind, subject, date) {
  return idx.versions
    .filter((v) => v.kind === kind && (v.subject || null) === (subject || null) && v.until > date)
    .sort((a, b) => a.until.localeCompare(b.until))[0] || null;
}

// Per game: welke regels golden er toen, en welke daarvan zijn niet meer de huidige?
// Geeft [{kind, title, sub, version|null, current:boolean, missing:boolean}].
export function sourcesForGame(rec, idx) {
  const r = rulesOf(rec);
  const date = rec.date || "";
  const out = [];
  out.push({ kind: "edition", title: `Editie: ${editionName(idx, r.edition)}`, sub: "", version: null, current: r.edition === idx.current.edition });
  const ghbVersion = r.ghb === idx.current.ghb ? null
    : idx.versions.filter((v) => v.kind === "gamedata" && v.ghb === r.ghb).sort((a, b) => b.until.localeCompare(a.until))[0] || null;
  out.push({ kind: "gamedata", title: ghbName(idx, r.ghb), sub: "battleplans, battle tactics en seasonal rules", version: ghbVersion, current: r.ghb === idx.current.ghb, missing: r.ghb !== idx.current.ghb && !ghbVersion });
  const facties = [...new Set([rec.player?.faction, rec.opponent?.faction].filter(Boolean))];
  for (const f of facties) {
    const v = versionAt(idx, "faction", f, date);
    const bestaat = !!AOS_FACTIONS[f];
    const wie = [rec.player?.faction === f ? "jouw army" : "", rec.opponent?.faction === f ? "tegenstander" : ""].filter(Boolean).join(" en ");
    out.push({ kind: "faction", subject: f, title: f, sub: `${wie}${bestaat ? "" : " · bestaat niet meer"}`, version: v, current: !v && bestaat, missing: !v && !bestaat });
  }
  // RoR's en AoR's tellen alleen als een in deze game gespeelde AoR/RoR zelf veranderd is, of
  // niet meer mag bij de army van die kant. `changed`/`removedArmies` op de versie komen van
  // `rulesarchive.mjs diff`; zonder die gegevens telt elke gespeelde AoR/RoR als mogelijk oud.
  // Teruglezen kan altijd.
  const rv = versionAt(idx, "renown", null, date);
  if (rv) {
    const gespeeld = [];
    for (const [kant, list] of [[rec.player, rec.list], [rec.opponent, rec.opponentList]]) {
      if (kant?.aor) gespeeld.push({ naam: kant.aor, key: `aor:${kant.faction}/${kant.aor}`, faction: kant.faction });
      for (const x of list?.ror || []) gespeeld.push({ naam: x.name, key: `ror:${x.name}`, faction: kant?.faction });
    }
    const oud = gespeeld.filter((g) => !rv.changed || rv.changed.includes(g.key) || (rv.removedArmies?.[g.key] || []).includes(g.faction));
    const sub = !gespeeld.length ? "niet gespeeld in deze game"
      : `in deze game: ${gespeeld.map((g) => g.naam).join(", ")}${oud.length ? ` · sindsdien veranderd: ${oud.map((g) => g.naam).join(", ")}` : " · ongewijzigd"}`;
    out.push({ kind: "renown", title: "Regiments en Armies of Renown", sub, version: rv, current: !oud.length });
  }
  const uv = versionAt(idx, "universal", null, date);
  if (uv) out.push({ kind: "universal", title: "Universele lores en manifestations", sub: "", version: uv, current: false });
  return out;
}
export const hasOldRules = (sources) => sources.some((s) => !s.current);

// ---------- Weergave ----------
const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`; };

// Kaart voor de detailweergave van een archief-game.
export function rulesSectionEl(rec, idx, { el, esc }) {
  const sources = sourcesForGame(rec, idx);
  const old = hasOldRules(sources);
  const wrap = el(`<div class="card">
    <h3>${icon("book", 18)} Regels van deze game</h3>
    <p class="subtitle">${old ? "Deze game is (deels) met andere regels gespeeld dan de huidige. Open de regels van toen:" : "Gespeeld met de huidige regels."}</p>
    <div class="rules-src"></div>
  </div>`);
  const box = wrap.querySelector(".rules-src");
  for (const s of sources) {
    const status = s.current ? `<span class="chip tag">huidig</span>`
      : s.version ? `<span class="chip legends">gold tot ${esc(fmtDate(s.version.until))}</span>`
      : s.missing ? `<span class="chip tag">niet gearchiveerd</span>` : "";
    const row = el(`<div class="rules-src-row">
      <div><b>${esc(s.title)}</b> ${status}${s.sub ? `<div class="subtitle">${esc(s.sub)}</div>` : ""}</div>
      ${s.version ? `<button class="small">${icon("book")} Regels van toen</button>` : ""}
    </div>`);
    const btn = row.querySelector("button");
    if (btn) btn.addEventListener("click", () => openSnapshot(s.version, rec, { el, esc }));
    box.appendChild(row);
  }
  return wrap;
}

async function openSnapshot(version, rec, { el, esc }) {
  const content = el(`<div><div class="ws-head"><h2>${esc(version.label)}</h2>
    <div class="chips"><span class="chip legends">Gold tot ${esc(fmtDate(version.until))}</span></div></div>
    <div data-body><p class="subtitle">Laden…</p></div></div>`);
  openModal(content, el);
  const body = content.querySelector("[data-body]");
  let data = null;
  // Niet in de localStorage-cache (een RoR-snapshot is al gauw een halve MB); zonder backend
  // alleen wat daar toevallig wél staat (lokaal testen).
  try {
    if (backend.hasBackend() && backend.getToken()) data = await backend.getShared(version.key);
    else data = JSON.parse(localStorage.getItem("aoscomp_shared_" + version.key) || "null");
  } catch {
    body.innerHTML = `<p class="empty">De regels van toen konden niet geladen worden (offline?).</p>`;
    return;
  }
  body.innerHTML = "";
  if (!data) { body.appendChild(el(`<p class="empty">Deze versie is niet (meer) te vinden.</p>`)); return; }
  const render = { faction: renderFaction, gamedata: renderGamedata, renown: renderRenown, universal: renderUniversal }[version.kind];
  if (render) render(body, data, rec, { el, esc }, version);
}

const ruleHtml = (r, esc) => `<div class="ability"><span class="aname">${esc(r.name)}</span>${abilityBodyHtml(r, esc)}</div>`;
function section(el, esc, title, inner, open = false) {
  return el(`<details class="type-group"${open ? " open" : ""}><summary>${esc(title)}</summary><div>${inner}</div></details>`);
}

function renderFaction(body, data, rec, { el, esc }) {
  const f = data.faction || data;
  const rules = f.factionRules || [];
  if (rules.length) body.appendChild(section(el, esc, `Battle traits (${rules.length})`, rules.map((r) => ruleHtml(r, esc)).join(""), true));
  const forms = Object.entries(f.subfactions || {});
  if (forms.length) body.appendChild(section(el, esc, `Battle formations (${forms.length})`,
    forms.map(([naam, v]) => `<h4>${esc(naam)}</h4>${(v.rules || []).map((r) => ruleHtml(r, esc)).join("")}`).join("")));
  const enh = f.enhancements || [];
  if (enh.length) {
    const perCat = new Map();
    for (const e of enh) { const k = enhancementCategoryLabel(e.category) || e.category; if (!perCat.has(k)) perCat.set(k, []); perCat.get(k).push(e); }
    body.appendChild(section(el, esc, `Enhancements (${enh.length})`, [...perCat].map(([k, l]) => `<h4>${esc(k)}</h4>${l.map((e) => `<div class="ability"><span class="aname">${esc(e.name)}</span>${parseInt(e.points) ? ` <span class="chip tag">${esc(String(e.points))} pts</span>` : ""}${abilityBodyHtml(e, esc)}</div>`).join("")}`).join("")));
  }
  const lores = f.lores || [];
  if (lores.length) body.appendChild(section(el, esc, `Lores (${lores.length})`,
    lores.map((l) => `<h4>${esc(l.name)} <span class="subtitle">${esc(l.kind || "")}${parseInt(l.points) ? ` · ${esc(String(l.points))} pts` : ""}</span></h4>${(l.entries || []).map((e) => `<div class="ability"><span class="aname">${esc(e.name)}</span>${e.value ? ` <span class="chip tag">${esc(String(e.value))}</span>` : ""}${abilityBodyHtml(e, esc)}</div>`).join("")}`).join("")));
  const models = f.models || [];
  if (models.length) {
    const det = section(el, esc, `Warscrolls (${models.length})`, `<div class="chips" data-ws></div>`);
    const box = det.querySelector("[data-ws]");
    for (const m of [...models].sort((a, b) => a.name.localeCompare(b.name))) {
      const b = el(`<button class="small">${esc(m.name)}${parseInt(m.points) ? ` · ${esc(String(m.points))}` : ""}</button>`);
      b.addEventListener("click", () => openModal(buildModelPopupContent(m, { el, esc }), el));
      box.appendChild(b);
    }
    body.appendChild(det);
  }
  const aor = data.armiesOfRenown || [];
  if (aor.length) body.appendChild(section(el, esc, `Armies of Renown (${aor.length})`, aor.map((a) => aorHtml(a, esc)).join(""),
    aor.some((a) => a.name === rec?.player?.aor || a.name === rec?.opponent?.aor)));
}

const aorHtml = (a, esc, chip = "") => `<h4>${esc(a.name)}${chip}</h4>${(a.rules || []).map((r) => ruleHtml(r, esc)).join("")}
  ${(a.enhancements || []).map((e) => `<div class="ability enhancement"><span class="aname">${esc(e.name)}</span> <span class="asrc">— ${esc(enhancementCategoryLabel(e.category))}</span>${abilityBodyHtml(e, esc)}</div>`).join("")}
  ${(a.units || []).length ? `<p class="subtitle">Units: ${esc(a.units.join(", "))}</p>` : ""}`;

function renderGamedata(body, data, rec, { el, esc }) {
  const sr = data.seasonalRules || [];
  if (sr.length) body.appendChild(section(el, esc, `Seasonal rules (${sr.length})`, sr.map((r) => ruleHtml(r, esc)).join(""), true));
  const bps = data.battleplans || [];
  if (bps.length) body.appendChild(section(el, esc, `Battleplans (${bps.length})`,
    bps.map((b) => `<h4>${esc(b.name)}${b.name === rec?.battleplan ? ` <span class="chip legends">deze game</span>` : ""}</h4>${b.twist ? `<p class="subtitle">${esc(b.twist)}</p>` : ""}${(b.abilities || []).map((r) => ruleHtml(r, esc)).join("")}`).join(""),
    bps.some((b) => b.name === rec?.battleplan)));
  const t = data.tactics || [];
  if (t.length) body.appendChild(section(el, esc, `Battle tactics (${t.length})`,
    t.map((x) => `<h4>${esc(x.name)}</h4>${(x.steps || []).map((s) => `<div class="ability"><span class="aname">${esc(s.name)}</span><div class="subtitle">${esc(s.description || "")}</div></div>`).join("")}`).join("")));
}

// Per AoR/RoR: nog geldig, veranderd, of niet meer toegestaan (uit `rulesarchive.mjs diff`).
function statusChip(version, key, faction, esc) {
  if (!version?.changed) return "";
  if (version.changed.includes(key)) return ` <span class="chip legends">sindsdien veranderd</span>`;
  const weg = version.removedArmies?.[key] || [];
  if (faction && weg.includes(faction)) return ` <span class="chip legends">niet meer voor ${esc(faction)}</span>`;
  return ` <span class="chip tag">nog geldig</span>`;
}

function renderRenown(body, data, rec, { el, esc }, version) {
  const facties = [rec?.player?.faction, rec?.opponent?.faction].filter(Boolean);
  if (version?.changed) body.appendChild(el(`<p class="subtitle">De stand van vóór ${esc(fmtDate(version.until))}. Alleen wat "sindsdien veranderd" heeft, is anders dan nu; de rest geldt nog precies zo.</p>`));
  const aor = (data.armiesOfRenown || []).filter((a) => !facties.length || facties.includes(a.faction));
  if (aor.length) body.appendChild(section(el, esc, `Armies of Renown van ${facties.join(" en ")} (${aor.length})`, aor.map((a) => aorHtml(a, esc, statusChip(version, `aor:${a.faction}/${a.name}`, null, esc))).join(""),
    aor.some((a) => a.name === rec?.player?.aor || a.name === rec?.opponent?.aor)));
  const ror = (data.regimentsOfRenown || []).filter((r) => !facties.length || facties.some((f) => (r.allowedArmies || []).includes(f)));
  if (ror.length) body.appendChild(section(el, esc, `Regiments of Renown voor ${facties.join(" en ")} (${ror.length})`,
    ror.map((r) => `<h4>${esc(r.name)}${statusChip(version, `ror:${r.name}`, facties.find((f) => (r.allowedArmies || []).includes(f)), esc)} <span class="subtitle">${esc(String(r.points || 0))} pts · ${esc((r.units || []).map((u) => `${u.count || 1}× ${u.name}`).join(", "))}</span></h4>${(r.abilities || []).map((a) => ruleHtml(a, esc)).join("")}`).join("")));
}

function renderUniversal(body, data, rec, { el, esc }) {
  const lores = data.lores || [];
  body.appendChild(section(el, esc, `Universele manifestation lores (${lores.length})`,
    lores.map((l) => `<h4>${esc(l.name)}${parseInt(l.points) ? ` <span class="subtitle">${esc(String(l.points))} pts</span>` : ""}</h4>${(l.entries || []).map((e) => `<div class="ability"><span class="aname">${esc(e.name)}</span>${abilityBodyHtml(e, esc)}</div>`).join("")}`).join(""), true));
}
