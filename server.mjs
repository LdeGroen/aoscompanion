// Statische server voor de AoS Companion op de Pi, achter de Cloudflare-tunnel
// (https://aos.lucdegroen.nl). Pure Node.js, nul dependencies — zelfde filosofie
// als de andere Pi-apps. Géén basic auth: de app heeft z'n eigen login.
//
// Draaien:  PORT=3900 node server.mjs
// Deploy:   git pull in deze map (systemd herstart niet nodig voor statische bestanden).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = process.env.PORT || 3900;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".apk": "application/vnd.android.package-archive",
};

function resolvePath(urlPath) {
  let p = decodeURIComponent((urlPath || "/").split("?")[0]);
  if (p === "/" || p === "") p = "/index.html";
  const full = path.normalize(path.join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null; // pad-traversal weren
  return full;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    // Statische assets kort cachen; de service worker doet de rest (network-first).
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let full = resolvePath(req.url);
  if (!full) return send(res, 403, "Forbidden");
  fs.stat(full, (err, st) => {
    if (!err && st.isDirectory()) full = path.join(full, "index.html");
    fs.readFile(full, (err2, data) => {
      if (err2) {
        // Onbekend pad → val terug op index.html (single-page app).
        return fs.readFile(path.join(ROOT, "index.html"), (e3, html) =>
          e3 ? send(res, 404, "Not found") : send(res, 200, html, TYPES[".html"]));
      }
      send(res, 200, data, TYPES[path.extname(full).toLowerCase()] || "application/octet-stream");
    });
  });
});

server.listen(PORT, () => console.log(`AoS Companion static server op http://localhost:${PORT}`));
