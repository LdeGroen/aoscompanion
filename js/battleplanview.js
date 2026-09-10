import { openModal } from "./modelview.js";
import { icon } from "./icons.js";

// Alles wat je over één battleplan wilt zien: het kaartje (klikbaar → schermvullend),
// de twist, de abilities en het scoreschema. Gedeeld door de companion (knop
// Battleplan in de topbar) en de toernooipagina, zodat je vooraf net zoveel ziet
// als tijdens het potje.

export function buildBattleplanDetail(bp, { el, esc }) {
  const body = el(`<div></div>`);
  if (!bp) {
    body.appendChild(el(`<p class="empty">Geen battleplan gekozen.</p>`));
    return body;
  }
  if (bp.card) {
    const img = el(`<img class="bp-card" src="${esc(bp.card)}" alt="${esc(bp.name)}" loading="lazy" />`);
    img.addEventListener("click", () => openModal(el(`<div class="bp-card-full"><img src="${esc(bp.card)}" alt="${esc(bp.name)}" /></div>`), el));
    body.appendChild(img);
  }
  if (bp.twist) body.appendChild(el(`<div class="card inner"><strong>Twist</strong><div class="muted-list">${esc(bp.twist)}</div></div>`));
  for (const ab of bp.abilities || []) {
    body.appendChild(el(`<div class="ability battleplan"><span class="aname">${esc(ab.name)}</span><div class="adesc">${esc(ab.description || "")}</div></div>`));
  }

  body.appendChild(el(`<h3>Scoren</h3>`));
  const sc = bp.scoring || {};
  for (const v of sc.variants || []) {
    const card = el(`<div class="card inner"><div class="card-header"><strong>Battleround ${(v.rounds || []).join(", ")}</strong></div><div data-opts></div></div>`);
    const opts = card.querySelector("[data-opts]");
    for (const o of v.options || []) opts.appendChild(el(`<div class="lore-entry"><span>${esc(o.label)}</span> <span class="lval">+${o.points}</span></div>`));
    body.appendChild(card);
  }
  if (sc.liferoot) body.appendChild(el(`<div class="muted-list">Liferoot points zijn cumulatief; aan het einde van je beurt geef je ze door.</div>`));
  if (sc.endBonus) body.appendChild(el(`<div class="card inner"><strong>Eindbonus</strong> <span class="lval">+${sc.endBonus.points}</span><div class="muted-list">${esc(sc.endBonus.label)}</div></div>`));
  if (!(sc.variants || []).length && !sc.endBonus) body.appendChild(el(`<p class="empty">Geen scoreschema bekend voor dit battleplan.</p>`));
  return body;
}

// Hetzelfde, maar meteen als popup met kop.
export function openBattleplanModal(bp, { el, esc }) {
  const wrap = el(`<div><h2>${icon("map")} Battleplan${bp ? " — " + esc(bp.name) : ""}</h2><div data-body></div></div>`);
  wrap.querySelector("[data-body]").appendChild(buildBattleplanDetail(bp, { el, esc }));
  return openModal(wrap, el);
}
