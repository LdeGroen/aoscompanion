# CLAUDE.md — AoS Companion

Context voor Claude Code bij het werken aan dit project. Lees dit eerst.
**Geen secrets in dit bestand of in de repo** (zie [Beveiliging](#beveiliging)).

## Wat is dit
Companion app voor Warhammer Age of Sigmar van Luc de Groen-Schram. Twee modussen:
- **Set-up mode**: leger samenstellen — faction/subfaction, models met volledige profielen
  (type, movement, health, control, save, ward save, wizard/priest level,
  champion/musician/standard bearer), ranged/melee attacks met range en conditionele
  bonussen, abilities per phase, enhancements (artifacts of power / heroic traits /
  other enhancements met stat improvements en/of een ability),
  spell/manifestation/prayer lores (3 entries elk) en faction/subfaction rules.
  Models, enhancements, rules en lores kunnen gedeeld worden in de **gedeelde
  faction-database** (zichtbaar voor alle accounts); herbruikbare kaartjes haal je
  daar ook weer vandaan.
- **Companion mode**: een battle spelen — per battleround kies je wie eerst gaat en je
  command points; per phase zie je de juiste info, abilities en universal commands
  (afvinken trekt CP af). Once-per-battle abilities krijgen een gebruik-knop en blijven
  daarna doorgestreept zichtbaar.

**Live:** https://ldegroen.github.io/aoscompanion/ · Een Android WebView-app (in `android/`)
laadt dezelfde URL.

## Stack & ontwerpkeuzes
- **Pure statische webapp**: vanilla JS met ES modules, géén build-stap, géén dependencies.
- Bestanden: `index.html` · `css/styles.css` · `js/app.js` (router, login, home, accountbeheer)
  · `js/setup.js` (set-up mode) · `js/companion.js` (spelmodus) · `js/factions.js` (data + phases
  + model types/wards/stat-mod-definities) · `js/enhancements.js` (mod-logica: effectiveModel e.d.)
  · `js/editors.js` (herbruikbare model/enhancement/rule/lore-editors, gebruikt door setup én database)
  · `js/icons.js` (inline SVG-iconen, lucide-stijl — gebruik `${icon("naam")}` in templates,
  geen emoji's in knoppen: die renderen per toestel anders)
  · `js/modelview.js` (gedeelde model-popup + weaponTable, gebruikt door companion én database)
  · `js/battleplans.js` (battleplan/tactic-seeds + gamedata-blob + puntentelling)
  · `js/scorecard.js` (game-record, eindscherm, tekst/PNG-export) · `js/archive.js` (archiefscherm)
  · `js/database.js` (gedeelde-database-scherm) · `js/sharedb.js` (laden/opslaan/delen faction-db)
  · `js/storage.js` (localStorage) · `js/backend.js` (sync-client) · `js/config.js` (API_URL).
- UI is mobile-first (gebruikt aan de speltafel). **Thema's**: donker (default), licht of
  systeem — knop op het home-scherm, apparaat-instelling in localStorage (`aoscomp_theme`,
  synct bewust niet). Licht thema = CSS-variabele-overrides onder `body.theme-light`;
  gebruik dus nooit hardgecodeerde kleuren in styles.css, alleen de variabelen
  (incl. `--bg-input` en `--bg-reminder`).

## Datamodel — de dingen die niet voor de hand liggen
- **Phases bestaan dubbel**: `own-<phase>` en `enemy-<phase>` (bijv. `own-hero` vs `enemy-hero`),
  want een ability kan in jouw beurt, de beurt van de tegenstander, of beide gelden.
  Uitzonderingen (enkelvoudig): `deployment` (alleen vóór battleround 1) en `startOfRound`
  (Start of Battleround — getoond op het battleround-setup-scherm, vóór de eerste beurt).
- **Spelstatus** staat op het leger zelf (`army.game`) en synct mee, zodat verversen of
  wisselen van apparaat midden in een potje kan. `usedCommands` reset per beurt;
  `usedAbilities` (once per battle) blijft de hele battle staan. "Einde spel" wist `army.game`.
  Een game duurt **altijd 5 battlerounds** (`LAST_ROUND` in companion.js); na battleround 5
  volgt het game-over-scherm (stage `"gameOver"`).
- **Battleplans & battle tactics** (js/battleplans.js): game-brede gedeelde blob
  (key `gamedata`), bij eerste laden geseed met de 12 Pitched Battles-battleplans
  (score-schema's als data: `scoring.variants` per battleround, `liferoot`, `endBonus`)
  en 6 battle tactics (3 opvolgende stappen). Bewerkbaar in de database (abilities met
  `underdogOnly` en `rounds`); score-schema's bewust niet via de UI.
- **Battle-flow**: nieuw potje start met stage `"battleSetup"` (tegenstander naam +
  faction/subfaction + zijn unieke models uit de database (`game.opponent.models`,
  snapshots — tijdens de game in te zien via de **Tegenstander-knop** in de topbar),
  battleplan, **2 eigen tactics + de 2 van de tegenstander** — als
  **snapshot** in `game` (`tactics`/`enemyTactics`), zodat db-wijzigingen lopende potjes
  niet raken). Vanaf ronde 2 kies je per ronde de underdog (`game.underdog[round]`);
  de CP-default per ronde is 4, of 5 als jij de underdog bent. Met de terugknop in de
  onderbalk kun je terug door phases, beurten en battlerounds (vanaf game-over terug
  verwijdert het auto-gearchiveerde record weer). Model-abilities kunnen een **spell**
  zijn (`isSpell` + `castingValue` — verschijnen bij de spells in de hero phase) en/of
  **CP kosten** (`cpCost` — afvinken in companion trekt het van de teller af; bij
  once-per-battle verrekent de gebruik-knop de CP). CP-kosten kunnen op **alle**
  ability-soorten (model, faction/subfaction rule, enhancement, battleplan —
  gedeeld blok `cpCostHtml`/`wireCpCost` in editors.js); spell alleen op model-abilities.
  Scoren gebeurt in de End of Turn-phase per beurt-eigenaar
  (`game.scores[side][round][optKey]`); tactics van de actieve speler aan het einde van
  diens eigen beurt, max 1 stap per tactic per beurt (5 punten/stap, `scoredRounds`).
  Lopende stand in `.scoreline`; puntentelling in `calcScores`.
- **Scrollgedrag**: rerender/draw in companion, setup en database behouden de
  scrollpositie; alleen echte navigatie (phase/stage-wissel, editor openen/sluiten,
  laden) geeft `rerender(true)`/`draw(true)` mee voor naar-boven-scrollen.
- **Scorekaart & archief**: js/scorecard.js bouwt het game-record, het eindscherm,
  tekst-export en PNG-export (handgetekend canvas — geen dependencies). Afgeronde
  games met battleplan worden automatisch in `state.data.gameArchive` gezet
  (synct mee); js/archive.js is het archiefscherm (route `archive`).
- Models in een army hebben een eigen `id`. Herbruikbare kaartjes komen uit de
  **gedeelde database** (picker "Kaartje uit de database" in set-up: faction-kaartjes +
  universal manifestations). `modelLibrary` in de userdata is **legacy** — wordt niet
  meer gevuld of gelezen, alleen nog genormaliseerd in storage.js voor oude data.
- **List-building (set-up)**: de set-up is een echte list-builder (2000 pt). Warscrolls in
  de DB dragen `points`, `reinforceable`, `unique`, `keywords` en `regimentOptions`
  (geïmporteerd uit BSData — zie hieronder). Een leger bestaat uit **regiments**:
  `army.regiments = [{id}]` (of `{id, ror:{name,points}}` voor een Regiment of Renown), en
  elk model in `army.models` heeft `regimentId` (""=auxiliary/terrain/manifestation),
  `isLeader`, `isGeneral`, `reinforced` en `inRoR`. Effectieve punten = `points ×
  (reinforced?2:1)`; manifestaties en faction terrain gratis; een RoR telt zijn vaste
  `ror.points` (de RoR-units zelf hebben `inRoR:true` → 0 pt). Pragmatische validatie
  (≤2000, 1 general, unique 0-1) als waarschuwingen. Companion leest gewoon de platte
  `army.models` — regiments zijn puur metadata. Toevoegen via de database-picker
  (`pickModel` in setup.js); manifestaties blijven lore-gedreven.
- **Regiment-opties** (welke units een hero in zijn regiment mag): geïmporteerd uit BSData
  (Battle-Profiles-sectie van de faction-`.cat`: `modifier add/category/force` → `affects`-id
  → keyword óf specifieke named unit). Per warscroll opgeslagen als `regimentOptions:
  [{names:[...], max}]`. De unit-picker in een regiment filtert hierop
  (`canTakeInRegiment`, geport van Sigdex' `matchesRegimentOption`): keyword-opties gelden
  voor niet-heroes, heroes alleen via een specifieke named-optie (max 1). Geen opties bekend
  → alles toestaan (pragmatisch). Een checkbox "Toon alle units (negeer regiment-opties)"
  in de picker laat de filter los. De import is geport van AjSchaff/Sigdex; scripts in
  `ko-import/` (`parse-regiments.mjs`, `driver-regiments.mjs`, `batch-merge-regiments.mjs`).
- **Punten op meer dan units**: `model.points` (warscrolls), `enhancement.points` (betaalde
  artefacts/heroic/monstrous traits) en `subfaction.points` (battle formations) zijn allemaal
  bewerkbaar in de database-editors. De list-builder telt ze mee: `pointsOf` voegt
  enhancement-punten per model toe (×2 geldt alleen voor de unit-punten, niet voor
  enhancements), en `subfactionPoints` (op het leger als `army.subfactionPoints`, gevuld vanuit
  de DB-subfaction, bewerkbaar in de set-up) telt apart mee. **Faction terrain kán punten kosten**
  (bijv. Zontari Endrin Dock 20) en telt dus mee op `m.points`; alleen `Manifestation` (en
  RoR-units, `inRoR`) zijn altijd 0. Geïmporteerd met `ko-import/driver-points.mjs` +
  `batch-merge-points.mjs` (match op naam; battle formations = de subfaction-namen uit factions.js).
- **Punten geijkt op de officiële Battle Profiles (April 2026)**: de BSData-import is
  vergeleken met de officiële GW Battle Profiles-PDF. De hero/unit-tabellen in die PDF
  zijn visueel opgemaakt (verticaal gecentreerde cellen) en laten zich niet betrouwbaar
  regel-voor-regel uit tekst parsen — daarom is per faction met `pdftotext -table` +
  faction-scoping + multi-kandidaat-matching vergeleken (scripts in `ko-import/`, output
  naar `$TEMP`). Dat leverde **44 echte puntcorrecties** op (vooral Cities of Sigmar,
  Daughters of Khaine en Sylvaneth — nieuwe battletomes; toegepast met
  `batch-apply-points.mjs`). De schone TYPE/NAME/POINTS-tabellen onderaan elke faction
  parsen wél betrouwbaar en zijn gebruikt voor enhancement-categorie + punten
  (`batch-merge-enhtypes.mjs`, incl. de 12 Monstrous Traits). **Regiment-opties staan in
  die PDF in dezelfde ongriijpbare cellen en komen dus uit BSData** (de gestructureerde
  transcriptie); per-warscroll bewerkbaar in de model-editor.
- **Regiment-opties matching** (`canTakeInRegiment` in setup.js): een unit past als de
  optie-naam de hele keyword is (ook met spatie, bijv. `KHARADRON OVERLORDS`), óf — voor een
  compound van losse keywords — als alle woorden los in de keywords zitten, óf de exacte
  unit-naam matcht (named heroes). Heroes mogen alleen via een named-optie (max 1). Bij een
  overtreding verschijnt een waarschuwing in `rosterWarnings`. De regiment-opties zijn per
  warscroll bewerkbaar in de model-editor (lijst van keywords/unit-namen + max).
- **Regiments of Renown**: vaste warbands uit BSData (`Regiments of Renown.cat` voor units +
  abilities, `Age of Sigmar 4.0.gst` voor punten + toegestane facties — gekoppeld via de
  forceEntry-id). Opgeslagen in de gedeelde blob **`regimentsofrenown`**
  (`{list:[{name, points, allowedArmies, units:[{name,count,model}]}]}`); de `model` is een
  volledige warscroll-kopie, opgelost uit de faction-DB's, zodat companion ze gewoon kan
  tonen. In de set-up kies je een RoR (gefilterd op faction); de units komen als een vast,
  niet-bewerkbaar regiment in het leger.
- **Model types & ward**: `m.type` ∈ Hero/Named hero/Infantry/Cavalry/Beast/Monster/
  Warmachine/Faction terrain/Manifestation; `m.ward` is `""` (geen) of `"6+"`…`"2+"`.
- **Manifestaties zijn lore-gedreven**: je voegt ze niet los toe aan je leger, maar bij
  het importeren van een manifestation-lore (database → "Naar dit leger") worden de
  bijbehorende warscrolls automatisch in `army.models` gezet (`fromLore: true`); een
  andere lore kiezen of de lore verwijderen haalt ze weer weg. De koppeling komt uit de
  lore-entries ("Summon X" → warscroll "X", tolerante naam-match). De model-pickers
  weren type Manifestation. In de database staan manifestaties in twee aparte groepen
  (**Faction manifestations** / **Universal manifestations**, die laatste standaard
  ingeklapt) en zijn alleen ter inzage (geen "Naar dit leger"-knop).
- **Manifestations** zijn pas "in het spel" na summonen: `game.summoned[modelId]` wordt
  gezet via de Manifestations-sectie in beide hero phases. Niet-gesummende manifestations
  zijn onzichtbaar in alle stats- en ability-weergaven (helper `isActive`/`activeModels`
  in companion.js); gesummende krijgen overal een 💥 Destroyed-knop die ze weer uit het
  spel haalt tot de volgende summon. Daarnaast kan íéder model via het **units-menu**
  (topbar in companion) uit/aan de battle gezet worden (`game.disabled[modelId]`);
  `isActive` combineert beide. Extra velden (alleen bij dit type): `m.banishment`
  (score, getoond in beide hero phases) en `m.universal` — universal manifestations
  worden bij delen ge-upsert in de **universal-blob** (`models`-lijst, naast de universal
  lores) en zijn in de database bij iedere faction zichtbaar. Bij een universal
  manifestation lore kies je de spells uit die universal manifestation-models
  (picker in buildLoreEditor via `manifestationOptions`).
- Wapen-`attacks` is vrije tekst, net als damage/move: "2", "D3", "D6+1" enz.
  (`addToValue` in enhancements.js telt er netjes bij op).
- Beschrijvingen (abilities, rules, commands) respecteren regeleinden via
  `white-space: pre-line` in de CSS — geen <br>-injectie nodig.
- **Enhancements** zitten als volledig object op het model zelf (`model.enhancements`),
  toegevoegd vanuit de database in de model-editor (de pool komt uit `db.enhancements`
  van de faction). Er is géén `army.enhancements`-lijst meer (oude data wordt door
  `migrateModelEnhancements` omgezet: `m.enhancementIds` → `m.enhancements`, en
  `army.enhancements` verwijderd). In de database hebben enhancements geen "Naar dit
  leger"-knop meer. Categorieën artifact / heroicTrait / other (met `forType`).
  Je voegt enhancements toe via een **snelle picker-modal** per army-model
  (`showEnhancementPicker` in setup.js, knop "Enhancements (N)" in het overzicht) —
  niet meer in de model-editor (die is puur warscroll-velden). Models voeg je aan een
  leger toe **uit de database** ("Model toevoegen uit database"); nieuwe warscrolls
  maken vanuit een leger kan niet meer (alle warscrolls staan in de database).
- **Lores** kies je ook uit de database (`showLorePicker` in setup.js): spell/prayer uit
  de faction-blob, manifestation uit faction + universal. Zelf een blanco lore maken in
  een leger kan niet meer. Een manifestation-lore kiezen synct meteen de warscrolls
  (`syncArmyManifestations`, `fromLore`).
  Categorieën: artifact / heroicTrait / **monstrousTrait** / other. `enhancementFits`
  (enhancements.js) bepaalt geschiktheid op basis van het model-type én de keywords:
  een hero draagt naast "Hero" ook zijn eigen keyword-type (Infantry/Monster/…).
  Artifacts & heroic traits → elke "Hero" (Named heroes niet). **Monstrous traits → een
  "Hero" die ook het MONSTER-keyword heeft** (hero-monsters). "Other" geldt voor één of
  meer types: `enh.forTypes` (lijst; legacy `forType` wordt gemigreerd) — matcht op het
  model-type én op de keywords, zodat dezelfde enhancement voor meerdere unit-types kan
  gelden. De enhancement-editor heeft daarvoor type-checkboxes.
  Artifacts/heroic traits mogen alleen naar type "Hero" (Named heroes bewust niet — zo
  werken de spelregels). Stat improvements (`statMods`) worden in companion mode live
  verwerkt via `effectiveModel()` en gemarkeerd met ✦; bibliotheek-kaartjes en gedeelde
  kaartjes krijgen altijd `enhancementIds: []` mee (enhancements zijn leger-gebonden).
- **Gedeelde faction-database**: per faction één blob op de backend
  (`getShared`/`setShared`, key `faction:<naam>`), voor alle accounts lees- én schrijfbaar.
  Structuur: `{factionRules, subfactions: {<naam>: {rules}}, models, enhancements, lores}` —
  uitbreidbaar. Upsert op naam (case-insensitive; lores op kind+naam); localStorage als
  offline-cache.
- **Lores**: `LORE_KINDS` in factions.js koppelt kind (spell/manifestation/prayer) aan het
  army-veld. Gedeelde lores krijgen een `kind`-veld. **Universal manifestation lores**
  (`lore.universal`) staan in een aparte gedeelde blob (key `universal`) en zijn in de
  database bij iedere faction zichtbaar/kiesbaar; spell, prayer en faction manifestation
  lores horen bij de faction-blob.
- **Eigenaarschap in de database**: iedere gedeelde entry heeft `addedBy` (gebruikersnaam).
  Bewerken/verwijderen/overschrijven mag alleen door die persoon of de superadmin —
  frontend-handhaving (canEditEntry in sharedb.js), passend bij het lichte
  beveiligingsmodel. Entries zonder `addedBy` (van vóór deze feature): alleen admin.
- **Auto-import bij (sub)faction-keuze**: kies je in set-up een faction, dan worden de
  faction rules en álle enhancements van die faction uit de gedeelde database in het
  leger gekopieerd (vervangt wat er stond; `m.enhancementIds` worden geleegd). Idem voor
  subfaction rules bij subfaction-keuze. Verse legers laden de defaults bij de eerste
  keer openen (flag `army.dbDefaultsLoaded`). Daarna lokaal aanpasbaar.
  Oudere data wordt bij het openen van setup/companion in-place gemigreerd
  (ontbrekende velden krijgen defaults).

## Accounts & backend
- Backend = **AppSync** (repo `LdeGroen/appsync`), draait op de Raspberry Pi `energiepi`,
  publiek als `https://apps.lucdegroen.nl`. `js/config.js → API_URL` staat daarop;
  **leeg = puur lokale modus** (localStorage, accounts per apparaat).
- Superadmin "Luc" logt in met wachtwoord (validatie op de server; het wachtwoord staat in
  `config.json` op de Pi). Gewone gebruikers loggen in met **alleen hun naam** — bewust simpel.
- Sync: serverdata is leidend bij login; localStorage is cache/offline-vangnet. Schrijven
  gaat debounced (800 ms). ⚠️ De debounced push legt het token vast bij het inplannen en
  wordt geannuleerd bij uitloggen — anders kon data van de vorige gebruiker onder het
  account van de volgende belanden (echte bug geweest, niet opnieuw introduceren).
- `js/storage.js` bevat nog een hardcoded superadmin-wachtwoord voor de lokale modus
  (zonder backend). Met backend actief wordt dat pad niet gebruikt.

## Deploy
**Pushen naar `main` = deployen.** GitHub Pages serveert de repo-root direct (legacy build,
geen Actions, geen build-stap). Live binnen ~1 minuut; check bijv.
`curl https://ldegroen.github.io/aoscompanion/js/config.js`.

## Lokaal draaien & testen
```
npx serve -l 5179 .        # ES modules werken niet via file://
```
⚠️ **De app praat ook lokaal met de productie-backend** (API_URL staat erin). Test daarom
nooit met het echte Luc-account of echte gebruikersdata: maak een wegwerp-testaccount aan
en verwijder dat na afloop weer via Accountbeheer. Wil je helemaal los van productie testen:
draai appsync lokaal (`node server.mjs` in die repo, poort 3100) en zet API_URL tijdelijk op
`http://127.0.0.1:3100` — **terugzetten vóór commit**.

## Android-app (`android/`)
- Minimaal Kotlin WebView-project: laadt de live-URL, `domStorageEnabled` (localStorage!),
  donker thema (geen witte flits), offline-foutpagina, terugknop navigeert in de WebView.
- ⚠️ De WebView heeft een **WebChromeClient** nodig — zonder die toont Android geen
  JavaScript-dialogen: `confirm()` "annuleert" dan stilletjes (einde spel/verwijderen
  deed niets) en `alert()`-meldingen verdwijnen. Niet weghalen dus.
- Bouwen op de Windows-pc van Luc:
  ```
  cd android
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio2\jbr"
  .\gradlew.bat assembleDebug
  ```
  APK verschijnt in `android/app/build/outputs/apk/debug/`.
- ⚠️ De Android Studio-installaties op Lucs pc wisselen nogal eens; per 2026-06 heeft
  alleen **"Android Studio2"** een werkende JBR (de andere missen jvm.cfg). Check bij
  een kapotte build welke installatie `jbr\lib\jvm.cfg` heeft. AGP 8.9.0 + gradle 8.11.1,
  compileSdk 35, minSdk 26.
- targetSdk 35 dwingt edge-to-edge af; MainActivity zet daarom de systeembalk-insets
  als padding op een FrameLayout-wrapper rond de WebView (anders valt de app onder de
  statusbalk van Android).
- Nog **debug-signed**: prima om te sideloaden, niet voor de Play Store. Release-keystore
  bestaat nog niet voor deze app.
- `local.properties` (sdk.dir) staat bewust niet in git; maak hem aan op een nieuwe machine.

## Iconen
Eén ontwerp (goud zwaard, 45°, op #1f212b): Android adaptive icon
(`android/.../drawable/ic_launcher_foreground.xml`), browser-SVG (`icons/favicon.svg`),
PNG's (`icons/*.png`, gegenereerd met PowerShell System.Drawing) en `manifest.webmanifest`
voor "toevoegen aan startscherm". Wijzig je het ontwerp, werk dan al deze varianten bij.

## Beveiliging
- Geen wachtwoorden of tokens in deze repo committen of in chats/logs printen.
- Het admin-wachtwoord van de backend staat alleen op de Pi (`~/appsync/config.json`).
- Het beveiligingsmodel is bewust licht (hobby-app): wie een gebruikersnaam kent, kan bij
  de data van die gebruiker. Geen gevoelige data in legers opslaan dus.

## PWA / offline
`sw.js` (root) cachet de app-shell: **network-first met cache-fallback** voor same-origin
GET — online dus altijd vers (push = deploy blijft direct zichtbaar), offline start de
app uit de cache op. Backend-calls (ander origin) worden niet onderschept.
⚠️ Nieuw bestand toegevoegd aan de app? Ook opnemen in de `SHELL`-lijst in sw.js.
In companion mode staat de volgende-stap-knop in een vaste onderbalk (`.bottombar`,
fixed; #app heeft daarvoor extra padding-bottom). Vrijwel alle rijen/kaarten met een
model zijn klikbaar (`makeClickable`) en openen de model-popup. Die popup zit in de
gedeelde module **`js/modelview.js`** (`buildModelPopupContent` + `openModal` +
`weaponTable`) en wordt zowel door companion als door het database-scherm gebruikt —
in companion met `army` mee zodat enhancements verwerkt worden (✦), in de database
zonder (ruwe kaartjes-stats). Modal hangt in document.body, dus overleeft rerenders.

## Ideeën voor later
Release-signing voor de Android-app; conflictdetectie bij gelijktijdig bewerken op
twee apparaten.
