# AoS Companion

Companion app voor Warhammer Age of Sigmar.

**Live:** https://ldegroen.github.io/aoscompanion/

## Wat kan de app?

- **Set-up mode** — stel je leger samen: faction & subfaction, unieke models met volledige profielen (movement, health, control, save, wizard/priest level, champion/musician/standard bearer), ranged & melee attacks met conditionele bonussen, abilities gekoppeld aan phases (eigen én enemy varianten), spell/manifestation/prayer lores en faction/subfaction rules. Opgeslagen models komen als kaartjes in een bibliotheek en kun je hergebruiken in andere legers.
- **Companion mode** — speel een battle: per battleround kies je wie de eerste beurt heeft en met hoeveel command points je begint. Per phase zie je precies de juiste info (movement, weapon profielen, lores, control scores) plus alle abilities die in die phase gelden. Universal commands hebben afvinkhokjes die automatisch command points aftrekken.

## Techniek

- Pure statische webapp (HTML/CSS/JS, ES modules) — geen build-stap nodig.
- Data staat in `localStorage` op het apparaat zelf. Er is geen server: accounts en legers zijn dus **per apparaat**.
- Superadmin kan via Accountbeheer accounts aanmaken; gewone gebruikers loggen in met alleen hun naam.

## Lokaal draaien

Open `index.html` via een lokale webserver (ES modules werken niet via `file://`):

```
npx serve .
```

## Android app

In `android/` staat een minimaal Android Studio-project dat de GitHub Pages-site in een WebView laadt. Open de map in Android Studio en bouw de APK.
