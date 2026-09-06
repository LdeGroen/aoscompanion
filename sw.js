// Service worker: zorgt dat de app offline opstart (bijv. aan de speltafel).
//
// Strategie: network-first met cache-fallback voor same-origin GET-requests.
// - Online: altijd de nieuwste versie (pushen naar main = direct deployen),
//   en het antwoord wordt in de cache bijgewerkt.
// - Offline: de laatst gecachete versie. Legerdata staat toch in localStorage,
//   dus de app is dan volledig bruikbaar (alleen sync/database vereisen internet).
// API-calls naar de backend (ander origin) worden bewust niet onderschept.

const CACHE = "aoscomp-shell";

// De app-shell wordt bij installatie alvast gecachet, zodat offline opstarten
// ook werkt als je nog niet alle schermen bezocht hebt.
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/archive.js",
  "js/backend.js",
  "js/battleplans.js",
  "js/companion.js",
  "js/config.js",
  "js/damage.js",
  "js/damagemath.js",
  "js/database.js",
  "js/editors.js",
  "js/enhancements.js",
  "js/factions.js",
  "js/icons.js",
  "js/modelview.js",
  "js/scorecard.js",
  "js/setup.js",
  "js/sharedb.js",
  "js/stats.js",
  "js/storage.js",
  "js/tournament.js",
  "js/weaponoptions.js",
  "icons/favicon.svg",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  ...Array.from({ length: 12 }, (_, i) => `cards/battleplans/${i + 1}.jpg`),
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  // `cache: "reload"` slaat de HTTP-cache van de browser/WebView over. Nodig omdat
  // Cloudflare de bestanden met `max-age=14400` naar de client stuurt (onze eigen
  // server zegt `no-cache`): zonder dit bleef de Android-app uren op een oude
  // versie hangen terwijl de webversie al bijgewerkt was.
  // Alleen voor code en pagina's: afbeeldingen mogen wél uit de HTTP-cache komen,
  // die veranderen niet en hoeven niet elk potje opnieuw over de lijn.
  const isCode = e.request.mode === "navigate" || /\.(js|mjs|css|html|webmanifest)$/i.test(url.pathname);
  const req = isCode ? new Request(e.request, { cache: "reload" }) : e.request;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request, { ignoreSearch: true });
        if (cached) return cached;
        // Navigaties zonder cache-hit: val terug op de app-shell
        if (e.request.mode === "navigate") {
          const shell = await caches.match("index.html");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
