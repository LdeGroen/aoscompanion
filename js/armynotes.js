import { API_URL } from "./config.js";
import { icon } from "./icons.js";
import { openModal, buildModelPopupContent } from "./modelview.js";
import { abilityBodyHtml } from "./abilityview.js";
import { enhancementCategoryLabel } from "./factions.js";
import * as sharedb from "./sharedb.js";

// Notities uit de AoS Army Repository (https://aosarmies.lucdegroen.nl) over één army, in een
// popup. De posts staan in appsync (`aosarmies` / `army:<faction>`) en zijn openbaar te lezen.
// Verwijzingen in een post (`<a class="ref" data-ref="kind|faction|name">`) openen hier de
// warscroll/regel uit onze eigen database, net als op de site.

export const REPO_URL = "https://aosarmies.lucdegroen.nl";
export const repoArmyUrl = (faction) => `${REPO_URL}/#/army/${encodeURIComponent(faction)}`;

// Dezelfde vragen en volgorde als op de site (aosarmies/js/app.js).
const QUESTIONS = [
  ["watch", "What to watch out for when playing against them?"],
  ["heroes", "Key heroes to watch out for"],
  ["units", "Key units"],
  ["defeat", "How to defeat them: the fastest way to cripple the army"],
  ["lists", "Top lists"],
  ["other", "Other thoughts / remarks"],
];

// Zelfde opschoning als op de site: alleen eenvoudige opmaak en veilige links.
const ALLOWED = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A"]);
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  const clean = (node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === Node.TEXT_NODE) continue;
      if (c.nodeType !== Node.ELEMENT_NODE || ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(c.tagName)) { c.remove(); continue; }
      clean(c);
      if (!ALLOWED.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
      const ref = c.tagName === "A" ? c.getAttribute("data-ref") : null;
      const href = c.tagName === "A" ? c.getAttribute("href") : null;
      for (const a of [...c.attributes]) c.removeAttribute(a.name);
      if (c.tagName !== "A") continue;
      if (ref) { c.setAttribute("data-ref", ref); c.setAttribute("class", "ref"); c.setAttribute("href", "#"); }
      else if (href && /^https?:\/\//i.test(href)) { c.setAttribute("href", href); c.setAttribute("target", "_blank"); c.setAttribute("rel", "noopener noreferrer"); }
      else c.replaceWith(...c.childNodes);
    }
  };
  clean(root);
  return root.innerHTML;
}

// Posts en archetypes (builds) van één army. Gearchiveerde posts (`archivedAt`) tellen niet mee.
// Archetype "general" bestaat altijd; posts zonder archetype horen daarbij (zelfde regel als de site).
export const GENERAL = "general";
export async function loadArmyNotes(faction) {
  const res = await fetch(`${API_URL}/api?action=publicShared`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app: "aosarmies", key: `army:${faction}` }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || `HTTP ${res.status}`);
  const posts = (Array.isArray(j.data?.posts) ? j.data.posts : []).filter((p) => !p.archivedAt);
  const archetypes = Array.isArray(j.data?.archetypes) ? [...j.data.archetypes] : [];
  if (!archetypes.some((a) => a.id === GENERAL)) archetypes.unshift({ id: GENERAL, name: "General" });
  return { posts, archetypes };
}

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// Verwijzing → popup uit onze eigen (gedeelde) database.
async function openRef(refString, { el, esc }) {
  const [kind, faction, ...rest] = String(refString || "").split("|");
  const name = rest.join("|");
  let obj = null;
  try {
    if (faction === "Universal") {
      const uni = (await sharedb.loadUniversalDb()).db;
      obj = kind === "warscroll" ? (uni.models || []).find((m) => same(m.name, name)) : (uni.lores || []).find((l) => same(l.name, name));
    } else {
      const db = (await sharedb.loadFactionDb(faction)).db;
      if (kind === "warscroll") obj = (db.models || []).find((m) => same(m.name, name));
      else if (kind === "rule") obj = (db.factionRules || []).find((r) => same(r.name, name));
      else if (kind === "enhancement") obj = (db.enhancements || []).find((e) => same(e.name, name));
      else if (kind === "lore") obj = (db.lores || []).find((l) => same(l.name, name));
      else if (kind === "formation") { const f = Object.entries(db.subfactions || {}).find(([n]) => same(n, name)); obj = f ? { name: f[0], ...f[1] } : null; }
    }
  } catch { /* offline: melding hieronder */ }
  if (kind === "warscroll" && obj) { openModal(buildModelPopupContent(obj, { el, esc }), el); return; }
  const wrap = el(`<div><h2>${esc(name)}</h2><div data-body></div></div>`);
  const body = wrap.querySelector("[data-body]");
  const card = (r) => el(`<div class="ability faction"><span class="aname">${esc(r.name)}</span>${abilityBodyHtml(r, esc)}</div>`);
  if (!obj) body.appendChild(el(`<p class="empty">Niet gevonden in de database${kind === "aor" || kind === "ror" ? " — open de post op de site om deze verwijzing te bekijken" : ""}.</p>`));
  else if (kind === "rule") body.appendChild(card(obj));
  else if (kind === "enhancement") body.appendChild(el(`<div class="ability enhancement"><span class="asrc">${esc(enhancementCategoryLabel(obj.category))}</span>${abilityBodyHtml(obj, esc)}</div>`));
  else if (kind === "formation") for (const r of obj.rules || []) body.appendChild(card(r));
  else if (kind === "lore") for (const e of obj.entries || []) {
    if (!e.name && !e.description) continue;
    body.appendChild(el(`<div class="lore-entry"><div class="lore-head"><strong>${esc(e.name)}</strong>${e.value ? ` <span class="lval">${esc(e.value)}</span>` : ""}</div>${abilityBodyHtml({ description: e.description, keywords: e.keywords }, esc, { phases: false })}</div>`));
  }
  openModal(wrap, el);
}

// De popup met alle posts over één army, per vraag. `archetype` = de build die je tegenstander
// speelt (id); bovenaan kun je wisselen tussen de archetypes van die army.
export async function openArmyNotes(faction, { el, esc, archetype = GENERAL } = {}) {
  const wrap = el(`<div class="army-notes">
    <h2>${icon("book")} ${esc(faction)}</h2>
    <p class="subtitle">Uit de <a href="${repoArmyUrl(faction)}" target="_blank" rel="noopener">AoS Army Repository</a> — daar schrijf je ook zelf mee.</p>
    <div data-arch></div>
    <div data-body><p class="empty">Laden…</p></div>
  </div>`);
  openModal(wrap, el);
  const body = wrap.querySelector("[data-body]");
  const archBox = wrap.querySelector("[data-arch]");
  let notes;
  try {
    notes = await loadArmyNotes(faction);
  } catch (e) {
    body.innerHTML = "";
    body.appendChild(el(`<p class="empty">Kon de notities niet laden (${esc(e.message)}). Offline?</p>`));
    return;
  }
  let cur = notes.archetypes.some((a) => a.id === archetype) ? archetype : GENERAL;
  const drawArch = () => {
    archBox.innerHTML = "";
    if (notes.archetypes.length < 2) return;
    const row = el(`<div class="chips arch-switch"></div>`);
    for (const a of notes.archetypes) {
      const n = notes.posts.filter((p) => (p.a || GENERAL) === a.id).length;
      const c = el(`<button class="chip${a.id === cur ? " active" : ""}">${esc(a.name)} (${n})</button>`);
      c.addEventListener("click", () => { cur = a.id; drawArch(); draw(); });
      row.appendChild(c);
    }
    archBox.appendChild(row);
    const desc = notes.archetypes.find((a) => a.id === cur)?.description;
    if (desc) archBox.appendChild(el(`<p class="subtitle">${esc(desc)}</p>`));
  };
  const draw = () => {
    body.innerHTML = "";
    const posts = notes.posts.filter((p) => (p.a || GENERAL) === cur);
    if (!posts.length) {
      body.appendChild(el(`<p class="empty">Nog geen notities${notes.archetypes.length > 1 ? " voor dit archetype" : ""} over ${esc(faction)}. <a href="${repoArmyUrl(faction)}" target="_blank" rel="noopener">Schrijf de eerste op de site.</a></p>`));
      return;
    }
    // Lege vragen klappen dicht; vragen met posts staan open.
    for (const [key, title] of QUESTIONS) {
      const qs = posts.filter((p) => p.q === key).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const det = el(`<details class="type-group" ${qs.length ? "open" : ""}><summary>${esc(title)} <span class="count">(${qs.length})</span></summary><div data-p></div></details>`);
      const box = det.querySelector("[data-p]");
      for (const p of qs) {
        const d = new Date(p.createdAt);
        box.appendChild(el(`<article class="army-note">
          <div class="post-content">${sanitize(p.html)}</div>
          <div class="subtitle">${esc(p.author || "?")}${Number.isNaN(d.getTime()) ? "" : " · " + d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}</div>
        </article>`));
      }
      body.appendChild(det);
    }
  };
  drawArch();
  draw();
  body.addEventListener("click", (e) => {
    const a = e.target.closest("a.ref");
    if (!a) return;
    e.preventDefault();
    openRef(a.dataset.ref, { el, esc });
  });
}
