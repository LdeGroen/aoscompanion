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
- UI is mobile-first (gebruikt aan de speltafel). **Eén vast licht thema** (geïnspireerd op de
  Home Assistant-webapp: lichte achtergrond `--bg #f4f5f7`, witte kaarten met zachte schaduw,
  ronde hoeken, subtiele dividers) met **gouden accenten** (`--gold`/`--gold-bright`/`--gold-dark`
  voor koppen, primaire knoppen, chips). De vroegere donker/licht/systeem-schakelaar is
  verwijderd (geen `aoscomp_theme`, geen `body.theme-light` meer). Alle kleuren staan als
  CSS-variabelen op `:root` in styles.css — gebruik nooit hardgecodeerde kleuren, alleen de
  variabelen (incl. `--bg-input`, `--bg-card-2`, `--bg-reminder`, `--border-strong`, `--shadow`).
  ⚠️ De Android-app zet nog een donkere native achtergrond (tegen witte flits); die zou naar
  licht moeten bij een volgende APK-build.

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
  (key `gamedata` = `{battleplans, tactics, seasonalRules}`), bij eerste laden geseed met de
  12 Pitched Battles-battleplans (score-schema's als data: `scoring.variants` per battleround,
  `liferoot`, `endBonus`) en 6 battle tactics (3 opvolgende stappen). Bewerkbaar in de database
  (abilities met `underdogOnly` en `rounds`); score-schema's bewust niet via de UI.
  - De **12 General's Handbook 2026-27 battleplans** (Into the Fire t/m Power of the Realms) zijn
    geïmporteerd met `ko-import/seed-ghb-battleplans.mjs` (vervangt `gamedata.battleplans`). Per
    battleplan: `twist` (tekst), `abilities` (met timing→phases, `underdogOnly`, `rounds`), een
    `scoring.variants`-schema (3/3/4 VP per beurt, sommige rondeafhankelijk) en `card` (pad naar het
    kaartje). De **kaartjes** staan als `cards/battleplans/<1-12>.jpg` (uit de GHB-screenshots
    gecropt met `ko-import/crop-battleplans.ps1`; let op: de plan-*tekst*bestanden hadden 8/9
    omgewisseld, de kaart-bestanden niet) en zitten in de `sw.js` SHELL voor offline gebruik.
  - **Companion deployment-fase** (`renderDeployment`): toont het battleplan-kaartje (klikbaar →
    schermvullend via `.bp-card`/`.bp-card-full`), de twist en alle battleplan-regels. Tijdens het
    spel verschijnen de abilities in hun eigen phase (via `collectAbilities`).
  - De **6 General's Handbook battle tactics** (Blazing Onslaught, Siege of Ashes, Flanking
    Firestorm, Smokescreen, Burning Vengeance, Legend of the Parch) hebben elk 3 stappen met
    een eigen naam (`Affray: …` / `Strike: …` / `Domination: …`, elk 5 VP) + beschrijving;
    geïmporteerd met `ko-import/seed-ghb-tactics.mjs` (vervangt `gamedata.tactics`).
    ⚠️ **De GHB-data is niet tegen BSData/Sigdex te controleren**: BSData kent alleen "General's
    Handbook 2024-25", terwijl wij op 2026-27 zitten (geen fury/rage, geen Into the Fire e.d.).
    De **battleplan-namen** zijn wél verifieerbaar tegen de kaartjes in `cards/battleplans/*.jpg`
    (die staan als afbeelding in de repo); de twist/scoring-teksten staan daar niet op.
    `ko-import/audit-ghb.mjs` doet een interne kwaliteitscheck (typefouten, mojibake, afgekapte
    tekst, gaten in het scoreschema) en `fix-ghb.mjs` voert correcties door. Zo is "Seige of
    Ashes" → "Siege of Ashes" rechtgezet (met `migrateUserData` in app.js die de naam ook in
    bestaande legers/archief/toernooien bijtrekt) en zijn de "Keywords:"-regels van de seasonal
    rules naar het gestructureerde `keywords`-veld verplaatst.
  - **General's Handbook-sectie in de database**: pseudo-faction `GHB_VIEW` ("❖ General's
    Handbook") onderaan de factionlijst (naast RoR) toont **battle tactics, battleplans en
    seasonal rules** met bewerk-/toevoeg-knoppen (admin). `drawGeneralsHandbook` →
    `drawTactics`/`drawBattleplans`/`drawSeasonalRules`; deze staan niet meer onder elke faction.
    `seasonalRules` = nieuw `gamedata`-veld (rule-vorm: `buildRuleEditor`), seizoensregels die
    voor alle potjes gelden. De **5 GHB 2026-27 seasonal rules** (Raising the Heat, Simmering Rage,
    Active Place of Power, Eruption of Fury, Fight Through the Pain — fury level / rage dice) zijn
    geïmporteerd met `ko-import/seed-ghb-seasonal.mjs`. In **companion** worden ze bij de start van
    een potje in `game.seasonalRules` gesnapshot en via `collectAbilities` per phase getoond (bron
    "Seasonal rule"), net als faction rules.
  - **Fury-teller** (`renderFuryPanel` in companion.js, `game.fury = {role, level, rage}`): verschijnt
    alléén als de fury-seasonal-rules in dit potje actief zijn (`furyActive()` checkt op "fury level"
    in `game.seasonalRules`). In de **deployment**-fase kies je attacker/defender (suggereert fury
    level 1 of 2); bij **start of battleround** een knop "rage dice = fury level"; tijdens een
    **beurt** een compacte ± teller voor fury level (0-7) en rage dice. Alles handmatig te overrulen.
    Snelknoppen voor de samengestelde aanpassingen: **Ignite Fury** (+2 fury, +2 rage), **Fight
    Through the Pain** (−1 fury, −1 rage) en **Rage die uitgeven** (−1 rage).
  - De battleplan-editor (`buildBattleplanEditor`) **slaat automatisch op** (debounced
    `persistGamedataSoon`, geen Opslaan-knop): je bewerkt het echte object in-place
    (`openBattleplanEdit` zet `editing = {kind:"battleplan", target}`, geen kopie) en sluit met
    **Klaar** (`closeBattleplanEdit`, definitieve save). Een leeg, nieuw toegevoegd battleplan dat
    je zonder naam/abilities sluit, wordt weer verwijderd. Verwijderen kan met de knop in de editor.
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
  - **Archief-records zijn bewerkbaar**: in de archief-detail zet 'Scores bewerken' een
    werkkopie klaar (`editRec`) met per-ronde objective-punten (jij/tegenstander), tactics
    per ronde (klikbare R1-R5-chips → `scoredRounds`), endBonus-eigenaar en liferoot;
    `recomputeTotals(rec)` in scorecard.js herberekent `rec.totals` (zelfde formule als
    `calcSide`: som objectives + tactics×5 + endBonus). Opslaan vervangt het record in
    `gameArchive`. Liferoot is informatief (telt niet mee in het totaal).
- **Toernooien** (route `tournament`, js/tournament.js, ★ Toernooi-knop op home):
  een toernooi is een reeks **volledige companion-games voor één leger**.
  `state.data.tournaments = [{id,name,armyId,days,rounds,games:[{id,name,game,done,archivedId}]}]`.
  Aanmaken: naam, formaat (presets 1d/3g · 2d/5g · 3d/8g of aangepast) en een army uit de
  lijst → genereert N games "`<naam> game i`". Een game speel je via **`state.tournamentRef =
  {tid,gid}`**: renderCompanion kiest dan een **game-host** die op het toernooi-game-slot werkt
  i.p.v. `army.game` (zelfde `newGame()`-vorm; `host.get/set/clear`). Bij game-over wordt het
  record getagd met `tournamentId`/`tournamentName`/`gameLabel`, het slot `done`+`archivedId`
  gezet, en `goBack()` gaat terug naar het toernooi i.p.v. home. ⚠️ Normaal potje: bij game-over
  "terug" moet `army.game` gewist worden (host.clear) — toernooi-game niet (afgeronde game blijft
  op het slot staan). Het archief groepeert getagde games per toernooi achter een uitvouw
  (`recCard` + `details.type-group`); losse games staan los bovenaan. Voorbije toernooien staan
  in de Toernooi-tab ook achter een uitvouw. Nieuw icoon `trophy` in icons.js.
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
  **Volgorde in het roster** (`renderRoster`): het regiment van de general staat altijd bovenaan
  (gesorteerd op `generalRid`), daaronder de overige gewone regiments, dan Auxiliary units,
  Faction terrain en als laatste de Regiments of Renown. **Max 1 RoR**: `addRoR` weigert een
  tweede (alert) en de toevoeg-knop verdwijnt zodra er één RoR in het leger zit.
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
  RoR-units, `inRoR`) zijn altijd 0.
  - **Terrein-companions** (`TERRAIN_COMPANIONS` in setup.js): sommige faction terrain-stukken
    brengen automatisch een warscroll mee die je níét los kunt kiezen — nu **Kharadron Overlords:
    Zontari Endrin Dock → Auto Endrin**. De companion wordt uit de faction-DB bijgeplaatst met
    `fromTerrain: true` en `points: 0`, staat ingesprongen onder z'n terrein in de roster, telt
    niet als auxiliary unit/drop, en verdwijnt zodra het terrein weg is. `pruneTerrainCompanions()`
    (synchroon, vóór het renderen) ruimt wezen én dubbelen op; `addTerrainCompanions()` (async, met
    `companionBusy`-vlag tegen dubbele adds bij gelijktijdige renders) plaatst ontbrekende bij —
    ook voor legers waar het terrein al in stond. `COMPANION_NAMES` filtert ze uit `pickModel`.
    Lookup gaat via genormaliseerde namen (`COMPANION_MAP`), dus spaties/hoofdletters maken niet uit. Geïmporteerd met `ko-import/driver-points.mjs` +
  `batch-merge-points.mjs` (match op naam; battle formations = de subfaction-namen uit factions.js).
  **Periodieke updates** uit de officiële core Battle Profiles-xlsx (punten + regiment-opties per
  warscroll) gaan via `ko-import/merge-battleprofiles.mjs` (REPORT/LOCAL/prod, backup
  `.bak-battleprofiles`): kolommen worden per faction-tabel dynamisch gedetecteerd (naam/points/
  regiment-opties verschuiven per faction), `✹`/`NEW`-prefixen en mee-gemergede unit-sizes (kale
  getallen in de naam) worden gestript, en `Scourge of Aqshy`-entries worden overgeslagen (nog geen
  warscrolls/tekst). Regiment-opties worden geparsed naar `{names,max}` (`0-N`→max N, `Any`→max 0,
  ` or ` splitst de namen); bij een cel-artefact (gedupliceerde/gemergede cel) wordt die hero's
  regiment-optie overgeslagen i.p.v. corrupte data te schrijven. Punten = leidende integer (negeert
  `(-20)`-delta's).
  **Lores kunnen ook punten kosten**: `lore.points` (op een spell/prayer/manifestation-lore, óók
  universal manifestation-lores) telt mee in `totalPoints` via `lorePoints()` (som van
  `army.spellLore/manifestationLore/prayerLore .points`). Geïmporteerd met
  `ko-import/batch-merge-lorepoints.mjs` (faction-blobs op kind+naam, universal-blob op naam;
  bron `lore-points.json`). Bewerkbaar in de lore-editor; in het roster-overzicht staat het puntental bij de lore.
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
- **Regiment-opties + hero-keywords uit het officiële Excel**: de PDF is door Luc naar
  Excel omgezet; dat parst wél schoon (nette kolommen). `ko-import/` parst het tot
  `excel-data.json` en `batch-merge-excel.mjs` zet per faction de **regiment-opties** op
  elke hero (autoritatief, incl. "0-1 X", "Any X", "X or Y", "non-Monster Skink") en de
  **hero-keywords** (`model.heroKeywords`, bijv. "Guild Officer", "Favoured Spawning") —
  afgeleid uit de notes ("This Hero can join an eligible regiment as a X"). Units krijgen
  hun keywords aangevuld met de RELEVANT KEYWORDS + de factienaam. Hierdoor matchen
  hero-specifieke opties ("0-1 Guild Officer") nu de juiste hero's.
- **Losse faction-update uit een Battle Profiles-xlsx** (bijv. nieuwe GHB-points/regiment-opties
  voor één faction): `ko-import/parse-hos-excel.mjs` leest een xlsx rechtstreeks (eigen mini
  zip+XML-parser, cross-platform: `unzip` op Linux/Pi, `Expand-Archive` op Windows) →
  `{heroes:[{name,points,options,granted}], units:[{name,points,keywords}]}`. `merge-hos-excel.mjs`
  zet daarmee **points**, **regimentOptions** + **heroKeywords** (heroes) en vult **keywords** aan
  (units) in de faction-blob. Match op genormaliseerde naam **met pre-komma-alias** (DB gebruikt
  korte vormen: "Dexcessa" ↔ xlsx "Dexcessa, the Talon of Slaanesh"). Modi: `DRY=1` (alleen parsen),
  `REPORT=1` (lezen+matchen, niet schrijven), `LOCAL=1` (login op :3100), of op de Pi (token uit
  db.json, backup `.bak-hosexcel`); `XLSX=<pad>` wijst het bestand aan. "Scourge of Aqshy"-varianten
  en Warhammer-Legends-units (Hellflayer/Hellstriders/Seeker Chariot) worden niet gematcht — die
  staan niet in BSData. Voor een andere faction: kopieer en pas de `FACTION`-constante + xlsx aan.
- **Scourge of Ghyran (SoG) verwijderd**: met het nieuwe General's Handbook vervielen de SoG-opties.
  Sigdex flagt SoG via een BSData-conditie (`condition instanceOf … childId="f079-501a-2738-6845"`,
  zie `parseIsSoG`). In onze DB kwam SoG uitsluitend voor als **warscrolls** met "(Scourge of Ghyran)"
  in de naam (38 stuks; geverifieerd 1:1 tegen die BSData-flag). Verwijderd met
  `ko-import/remove-sog.mjs` (REPORT/LOCAL/prod, backup `.bak-sog`). `investigate-sog.mjs` +
  `driver-sog-units.mjs` leiden de autoritatieve SoG-warscroll-lijst af uit BSData.
  **SoG-enhancements/battle formations/lores** zaten óók in de DB, maar onder hun gewone naam (geen
  "Ghyran" in de naam). Die zijn geïdentificeerd via de **core Battle Profiles-xlsx** (kolom NOTES =
  "Scourge of Ghyran" i.p.v. "Faction Pack: X"): `ko-import/parse-sog-enh.mjs` (TYPE=C, NAME=K,
  NOTES=U; faction uit kolom-A-titel) + `remove-sog-enh.mjs` matchen op genormaliseerde naam in
  `enhancements` (heroic/monstrous trait, artefact, mark, skyvessel upgrade, big name), `lores`
  (spell/prayer/manifestation) én `subfactions` (battle formations, gekeyd op naam). 107 entries
  verwijderd over alle facties, **Hedonites of Slaanesh overgeslagen** (net opnieuw geïmporteerd).
  Bestaande legers behouden hun kopie; SoG is alleen niet meer toe te voegen.
- **Scourge of Aqshy (SoA)**: de opvolger van SoG (zelfde mechaniek). In **3 batches** zijn nu
  **alle 23 faction-PDF's** ingevoerd met `ko-import/seed-soa.mjs` (+ `data-soa/<faction>.json` per
  faction): batch 1 = 7 Order-facties (Cities, Fyreslayers, Idoneth, Kharadron Overlords, Seraphon,
  Stormcast, Sylvaneth); batch 2 = 7 Chaos-facties (Blades of Khorne, Disciples of Tzeentch,
  Hedonites of Slaanesh, Helsmiths of Hashut, Maggotkin of Nurgle, Skaven, Slaves to Darkness);
  batch 3 = 9 Death/Destruction-facties (Flesh-eater Courts, Nighthaunt, Ossiarch Bonereapers,
  Soulblight Gravelords, Gloomspite Gitz, Ironjawz, Kruleboyz, Ogor Mawtribes, Sons of Behemat).
  Totaal **46 warscrolls** (2 per faction, naam met suffix " (Scourge of Aqshy)" zodat ze niet
  botsen met de basis-warscrolls), **123 enhancements** en enkele lores (o.a. Fyreslayers' Vulkyn
  Gifts, Gloomspite's Lore of the Little Waaagh!, Sons of Behemat's Brodd's Bellows). Het script
  hergebruikt de mapping van `parse-faction.mjs` (type/phases/abilities). Alles krijgt `soa: true`
  (idempotent: een herseed vervangt per faction eerdere SoA-entries — `getShared` → filter `!soa`
  → concat → `setShared`). PDF-tekst is uit de PDF gehaald via de Read-tool (die de-columniseert;
  `pdftotext -layout` interleavet de kolommen); punten uit de June Battle Profiles-xlsx (SoA-rows
  daar zijn gegarbled → raw-row lookups op "Scourge of Aqshy … 1 <points>"). De "unique
  enhancement"-types (bijv. Scars of War, Brazen Mutation, Noble Pursuit, Brutal Beasts) krijgen
  een `forTypes`-lijst (via `FORTYPE_MATCH` in de seed) zodat `enhancementFits` ze toont bij de
  juiste model-types/keywords; `forType` blijft het label. **Monster-only monstrous traits**
  (Ironjawz Brutal Beasts, Kruleboyz Kunnin' Creatures, Ogor Well-Fed Beasts, SoB Cracked Heels)
  gebruiken category `"other"` + `forType`→`["Monster"]` (matcht zowel non-hero monsters via type
  als hero-monsters via het MONSTER-keyword; category `"monstrousTrait"` zou non-hero monsters
  missen). Enkele SoA-units hebben **weaponOptions** (gestructureerde array, niet los tekstveld):
  Ironjawz Brutes' Gore-choppa (`optional`), Huskard on Thundertusk's 1-of-3 ranged (`grouped`).
  Modi: `REPORT=1` (dry), `LOCAL=1` (login op :3100), of op de Pi `node seed-soa.mjs` (token uit
  db.json, backup `.bak-soa-content`). Prod-seed = alleen de batch-json's + `seed-soa.mjs` naar
  `/tmp/soa3` scp'en, daar draaien, verifiëren via de live API, opruimen.
  - **SoA is compleet en geverifieerd tegen BSData** (de bron die Sigdex toont — sigdex.io zegt
    zelf "It only displays data from BSData"). BSData tagt SoA-content met de publicatie
    **`9e18-bb03-7b60-d4ff`** ("Scourge of Aqshy"), maar **inconsistent**: warscrolls herken je
    betrouwbaarder aan het naam-achtervoegsel "(Scourge of Aqshy)", enhancement-groepen aan de
    publicationId. `ko-import/audit-soa.mjs` (veld-voor-veld diff) en `audit-soa-complete.mjs`
    (compleetheid) doen die vergelijking; `seed-soa-missing.mjs` vulde de gaten aan.
    De 23 PDF-batches misten **Lumineth Realm-lords** en **Daughters of Khaine** (2 warscrolls +
    6 enhancements elk) — die zijn uit BSData bijgeplaatst. ⚠️ BSData heeft **geen punten voor
    SoA-enhancements**: die van Lumineth/DoK staan daarom op 0 en moeten nog uit de Battle
    Profiles-xlsx komen. Twee namen zijn gelijkgetrokken met BSData ("Kurnoth Hunters with
    **Kurnoth** Greatswords", "Infernal Enrapturess**, Herald of Slaanesh**"). Let op: BSData
    bevat ook echte fouten (OBR "Reaper**'** Blades" mist een s) — niet blind overnemen.
- **Nieuw battletome voor een BSData-faction** (bijv. Ogor Mawtribes, Aug 2026): als BSData
  (`age-of-sigmar-4th`) het nieuwe boek al heeft, ververs je de hele faction-blob met
  `ko-import/refresh-ogor.mjs` (kopieerbaar sjabloon per faction: zet de `FACTION`-constante).
  Het herbouwt warscrolls (`parse-faction`, punten/keywords/reinforce/unique/regiment-opties via
  `parseFactionUnits`, weapon-opties via `parseFactionWeaponOptions`), battle traits + battle
  formations + enhancements (`parseEnh`) en de lores (`parseLores`+`factionLoreNames`). Het
  **vervangt** de base-content maar **bewaart `soa:true`-entries** (SoA-warscrolls/enhancements)
  en sluit de BSData "(Scourge of Aqshy)"/"(Scourge of Ghyran)"-varianten uit. Big Names (de
  "other"-enhancements onder de Warlord) krijgen `forType`/`forTypes` "Hero". De **battle-formation-
  namen in `AOS_FACTIONS`** (factions.js) moeten mee bijgewerkt worden (anders matcht de auto-import
  bij subfaction-keuze niet). De **Armies of Renown** ververs je met `ONLY="<faction>" node
  driver-aor.mjs` — die filtert op die factie en **merget** in de bestaande `armiesofrenown`-blob
  (andere facties blijven staan). `loresBySuffix` matcht nu ook de nieuwere BSData-lorenaam-vorm
  "<Keyword> <Kind> Lore" (bv. "Alfrostun Prayer Lore") naast "<Kind> Lore: <AoR>". Modi/prod-flow
  als seed-soa (REPORT/LOCAL/Pi; backups `.bak-ogor-refresh` + `.bak-aor`). ⚠️ AoR-enhancements die
  via universele artefact/heroic-links lopen (geen eigen inline groep) worden niet opgepikt — geldt
  voor de meeste AoR's, geen boek-specifieke regressie.
- **Regiment-opties matching** (`canTakeInRegiment` in setup.js): een unit past als de
  optie-naam de hele keyword is (ook met spatie, bijv. `KHARADRON OVERLORDS`), óf — voor een
  compound van losse keywords — als alle woorden los in de keywords zitten, óf de exacte
  unit-naam matcht (named heroes). Heroes mogen alleen via een named-optie (max 1). Bij een
  overtreding verschijnt een waarschuwing in `rosterWarnings`. De regiment-opties zijn per
  warscroll bewerkbaar in de model-editor (lijst van keywords/unit-namen + max).
- **Regiments of Renown in de database**: de `regimentsofrenown`-blob heeft een eigen
  weergave in het database-scherm (`drawRoR`/`buildRoREditor` in database.js). RoR staan
  niet onder elke faction, maar onder een eigen pseudo-faction `ROR_VIEW` ("★ Regiments of
  Renown"), als laatste optie in de faction-keuzelijst — daar staan álle RoR bij elkaar.
  Kies je die optie, dan toont `drawInner` alleen die sectie (geen faction-blob nodig). Daar kun je RoR **bekijken, toevoegen, bewerken en verwijderen** (naam,
  punten, toegestane facties via checkboxes, units en de RoR-eigen **regels/abilities**).
  Units kies je via een **warscroll-picker** (`pickWarscroll` in database.js, faction naar
  keuze): die zet zowel `unit.name` als het volledige `unit.model` (warscroll met stats),
  zodat de RoR-units met stats in een leger belanden. Vrij een naam typen kan dus niet meer —
  een unit is altijd een gekoppelde warscroll. Eigenaarschap via `addedBy` zoals andere
  entries. De RoR-regels
  zijn uit BSData geïmporteerd (`Regiments of Renown.cat`, profiles met Timing/Declare/
  Effect/Keywords → `ko-import/batch-merge-ror-abilities.mjs`). In de list-builder is de
  RoR-kaart klikbaar (`showRoRRules`): dat opent een popup met de RoR-regel(s) — los van de
  warscroll-popups van de units. `addRoR` zet de abilities mee op `reg.ror` zodat de popup
  ook midden in een potje werkt.
- **Regiments of Renown**: vaste warbands uit BSData (`Regiments of Renown.cat` voor units +
  abilities, `Age of Sigmar 4.0.gst` voor punten + toegestane facties — gekoppeld via de
  forceEntry-id). Opgeslagen in de gedeelde blob **`regimentsofrenown`**
  (`{list:[{name, points, allowedArmies, units:[{name,count,model}]}]}`); de `model` is een
  volledige warscroll-kopie, opgelost uit de faction-DB's, zodat companion ze gewoon kan
  tonen. In de set-up kies je een RoR (gefilterd op faction); de units komen als een vast,
  niet-bewerkbaar regiment in het leger.
- **Armies of Renown**: een alternatieve manier om een faction te spelen — eigen faction
  rules (battle traits), eigen enhancements, eigen spell/prayer/manifestation-lores en een
  beperkte unit-keuze. Uit BSData: de per-faction extra `.cat`'s (bv. `Daughters of Khaine -
  Zainthar Kai.cat`), naast `<Faction>.cat` en `<Faction> - Library.cat` (Path to Glory /
  Big Waaagh! / [LEGENDS] / Allies worden overgeslagen of leveren niets op). Geïmporteerd met
  `ko-import/driver-aor.mjs` (zelfstandig: factienamen-lijst inline, lores uit de gedeelde
  `Lores.cat` op naam-suffix `… Lore: <AoR>`) naar de gedeelde blob **`armiesofrenown`**
  (`{list:[{faction, name, rules, enhancements, lores, units:[namen]}]}`). Battle traits =
  de Ability-profielen onder `Battle Traits: <naam>`; enhancements = de subgroepen
  `Artefacts of Power/Heroic Traits/Monstrous Traits: <naam>`; **units** = de entryLinks
  getagd met de ALL-CAPS army-categorie (substring-match op de AoR-naam, want de categorie
  mist vaak "The"/bezit-s). Twee Idoneth-AoR's taggen units anders → 0 units = "geen
  beperking" (alle faction-units toegestaan).
  - **Database**: de faction-keuze is een **uitklapbare lijst** (`renderDatabase` →
    `.faction-picker`, achter een `.faction-toggle`-knop). De lange lijst is **standaard
    ingeklapt** (`pickerOpen=false`) en toont alleen de huidige keuze; klik op de knop klapt
    'm uit en na het kiezen van een faction/AoR/RoR klapt 'ie weer dicht. Klik op een faction
    = standaard versie; klik op de chevron toont de Armies of Renown (+ "Standaard <faction>").
    Een AoR kiezen toont read-only z'n rules,
    enhancements, lores en toegestane units (`drawAoRView`, units opgelost uit de faction-DB,
    klikbaar naar de model-popup). RoR staat als pseudo-faction onderaan.
  - **Set-up**: bij een faction kun je een **Army of Renown** kiezen (`army.aor`,
    `applyArmyOfRenownDefaults`). Dan worden de faction rules vervangen door de AoR-battle-
    traits, is de enhancement-pool (`loadFactionEnhancements`) die van de AoR, biedt de
    lore-picker (`showLorePicker`) de AoR-lores, en is de unit-picker (`pickModel`) **strikt**
    beperkt tot de AoR-units (universal manifestations blijven kiesbaar). AoR en subfaction
    sluiten elkaar uit; van faction wisselen wist `army.aor`. Companion leest gewoon
    `army.factionRules` + `army.models`, dus AoR werkt daar automatisch.
- **Hedonites of Slaanesh = nieuw battletome (juni 2026)**: deze faction is níét uit BSData
  geïmporteerd maar uit het nieuwe boek (Word-transcriptie). `ko-import/parse-hos.mjs` bouwt een
  ordered-block model (paragrafen + tabellen) uit `word/document.xml`; `ko-import/driver-hos.mjs`
  parst dat naar battle traits (factionRules), battle formations (subfactions: Depraved Carnival,
  Godseeker Cavalcade, Artisans of Torment, Lurid Dreamers — ook bijgewerkt in `AOS_FACTIONS`),
  heroic traits + artefacts (enhancements), spell- + manifestation-lore en 28 models (25 warscrolls
  + 3 faction-manifestations). Stats komen uit de MOVE/HEALTH/SAVE/CONTROL- (of …/BANISHMENT voor
  manifestations) tabel, wapens uit de RANGED/MELEE WEAPONS-tabel, abilities uit timing-tabel +
  Declare/Effect/KEYWORDS. **Punten staan niet in het battletome** → per naam (tolerant: "of
  slaanesh"/"the" gestript) overgenomen uit de bestaande blob; nieuwe/hernoemde units hebben (nog)
  geen punten. Bij een nieuw boek voor een andere faction: dezelfde aanpak. De twee Hedonites
  Armies of Renown (The Decadent Host, Court of the Godlings) en twee Regiments of Renown
  (Mist-clad Revellers, The Accursed Reflection) uit het boek zijn met `driver-hos-aor.mjs`
  resp. `driver-hos-ror.mjs` in de `armiesofrenown`/`regimentsofrenown`-blobs gezet (roster-opties
  → unit-lijst via keywords; RoR-punten staan niet in het boek → 0, handmatig aan te vullen).
- **Warhammer Legends**: units die BSData tagt met de publicatie **`9dee-a6b2-4b42-bfee`**
  ("Warhammer Legends") krijgen `model.legends = true` en een rode **Legends-chip** in de
  model-popup, de database-kaart, de set-up-roster én de unit-picker (zoals Sigdex ze badget).
  Ze zijn niet legaal in matched play. Gezet door `ko-import/fix-broad.mjs` (54 units).
- **Brede data-audit tegen BSData**: `ko-import/audit-all.mjs` vergelijkt de hele gedeelde database
  met BSData (units, punten, stats, wapens, abilities, keywords, enhancements, faction rules,
  battle formations, Legends) en schrijft `/tmp/audit-all-out.json`; `fix-broad.mjs` voert de
  eenduidige correcties door (backup `.bak-broadfix`). ⚠️ Let op bij het interpreteren: veel
  "ontbrekende" units zijn in werkelijkheid **korte namen bij ons** (DB "Dexcessa" vs BSData
  "Dexcessa, the Talon of Slaanesh"); die niet blind hernoemen, want `canTakeInRegiment` matcht
  named heroes op de exacte naam. BSData bevat ook echte fouten (OBR "Reaper' Blades",
  HoS "Bestial Onslaughted"/"Blissbrew Homonculus").
  **Korte namen zijn inmiddels gelijkgetrokken** met `ko-import/rename-shortnames.mjs` (8 stuks:
  Dexcessa, Sigvald, Synessa, Syll'Esske, Glutos Orscollion, Infernal Enrapturess, Brokk Grungsson,
  Skragrott) — het script plakt alléén het BSData-achtervoegsel achter ónze schrijfwijze, zodat
  bv. de krullende apostrof in "Syll’Esske" behouden blijft, en slaat SoG/SoA-varianten over.
  Daarvóór is `canTakeInRegiment` (+ de AoR-unitfilters in setup.js/database.js) tolerant gemaakt
  via `nameAlias()`, dat ook op het deel vóór de komma vergelijkt — anders breken regiment-opties
  die de korte vorm gebruiken. ⚠️ **Hernoemen kan duplicaten maken** als de volledige naam al
  bestond; `ko-import/dedupe-models.mjs` ruimt dubbele warscrolls op (houdt de versie die het best
  bij BSData past) en vond ook al langer bestaande dubbelen (Trugg, Kragnos).
  ⚠️ **Ward is een vals alarm in de audit**: `parse-faction.mjs` leest ward uit een
  `Ward (X+)`-categoriekeyword, maar BSData modelleert 'm bij veel units anders — Sigdex tóónt de
  ward wel (Shalaxi Helbane: Control 5 · 5+ · Save 4+). Onze ward-waarden zijn dus correct en moeten
  **niet** naar BSData "gecorrigeerd" worden.
  **Verouderde warscrolls** zijn bijgewerkt met `ko-import/fix-warscrolls.mjs` (15 units, expliciete
  lijst, backup `.bak-warscrolls`): het vervangt alleen wapens + abilities uit BSData en laat stats,
  punten, keywords, regiment-opties en flags staan. Twee details die dat script bewust doet:
  (1) bij een gelijke genormaliseerde naam houdt het **onze** schrijfwijze aan — BSData gebruikt
  rechte apostrofs en Title Case ("Master Of The Revels", "Commander's Rifle"), wat anders als
  nep-wijziging binnenkomt; (2) abilities in `KEEP_ABILITIES` (nu "Beast", onze eigen conventie voor
  het Beast-keyword) blijven behouden.
  Wat ná die ronde nog als verschil binnenkomt is allemaal **verklaard en bewust zo**: BSData-typo's
  ("Reaper' Blades", "Bestial Onslaughted", "Blissbrew Homonculus"), onze "Beast"-abilities, de
  SoA-Gatebreaker (Longshanks/Son of Behemat staan bij BSData elders), en twee FEC-abilities
  ("A Majestic Menagerie", "Banishing Liturgy") die wél in BSData staan maar op een andere entry —
  `parseFaction` slaat namelijk dubbele unit-namen (loadout-varianten) over.
- **Paragon-keyword**: warscrolls met het `Paragon`-keyword (Hedonites of Slaanesh) krijgen op hun
  kaartjes een opvallende paarse **Paragon-chip** (`.chip.paragon`) — in de model-popup
  (`modelview.js`), de database-kaart (`drawModels`) en de set-up-roster (`modelRow`). Detectie:
  `m.keywords` bevat "paragon".
- **Weapon options** (`js/weaponoptions.js`): sommige warscrolls hebben een `m.weaponOptions`-array
  (uit BSData, geport van Sigdex' `parseModels`): per optie `{ name, type:'optional'|'grouped', max,
  replaces:[wapennamen], group, modelGroup, groupSize }`. **optional** = los maximum (`max`, ×2 bij
  reinforced), vervangt een default-wapen; **grouped** = kies binnen een groep (budget = `groupSize`,
  ×2 reinforced). De keuze van de speler staat op `m.weaponLoadout = { [optienaam]: aantal }`.
  In **set-up** is er per unit een **Wapenopties**-knop (`showWeaponOptions` in `setup.js`) met
  +/−-tellers (grouped-keuzes delen één budget). In **companion** + de model-popup filtert
  `filterWeapons(weapons, m)` (in `modelview.js` + `companion.js`): een optiewapen met aantal 0 wordt
  verborgen, gekozen opties krijgen een `count` (getoond als "N× wapen"); default/basiswapens blijven
  altijd staan. Zónder ingestelde loadout blijft alles staan (achterwaarts compatibel).
  Geïmporteerd met `ko-import/parse-weaponoptions.mjs` + `driver-weaponoptions.mjs` (DRY-validatie) en
  `batch-merge-weaponoptions.mjs` (match op naam; DRY/LOCAL/prod). 4e editie heeft weinig opties
  (~34 units over alle facties).
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
- **Wie mag de database wijzigen**: alleen de **superadmin** (Luc) en door hem **aangewezen
  db-editors** kunnen de gedeelde database aanpassen (toevoegen/bewerken/verwijderen). De lijst
  editors staat in de gedeelde blob **`dbeditors`** (`{editors:[namen]}`). In database.js
  wordt `dbEdit = user.isAdmin || dbeditors.includes(user.name)` berekend; bij `false` is het
  database-scherm read-only (geen bewerk/verwijder/toevoeg-knoppen, wel "Naar dit leger").
  In **Accountbeheer** (app.js, alleen superadmin) staat per account een schakelaar "Mag de
  database bewerken" die de `dbeditors`-blob bijwerkt. (Het oudere `addedBy`/`canEditEntry`-
  eigenaarschapsmodel is hierdoor vervangen voor het database-scherm; `addedBy` blijft alleen
  als herkomst-label.) Entries zonder `addedBy` (van vóór deze feature): alleen admin.
- **Auto-import bij (sub)faction-keuze**: kies je in set-up een faction, dan worden de
  faction rules en álle enhancements van die faction uit de gedeelde database in het
  leger gekopieerd (vervangt wat er stond; `m.enhancementIds` worden geleegd). Idem voor
  subfaction rules bij subfaction-keuze. Verse legers laden de defaults bij de eerste
  keer openen (flag `army.dbDefaultsLoaded`). Daarna lokaal aanpasbaar.
  Oudere data wordt bij het openen van setup/companion in-place gemigreerd
  (ontbrekende velden krijgen defaults).

## Set-up: importeren + personaliseren (geen DB-bewerken)
In de set-up bewerk je de gedeelde database **niet** meer; je importeert items zoals ze in de
database staan. Bij elke warscroll, enhancement, faction rule, subfaction rule en lore in je
leger staat een **"Personaliseren"**-knop die de volledige editor opent op de **kopie in jouw
leger** (warscroll → `buildModelEditor` via `personalizeModal`+`commit`; enhancement/rule/lore →
de inline editor met `onChange: saveData`). Aanpassingen gelden alleen voor dat leger; de
gedeelde database verandert niet. De oude "Deel in database"-knoppen zijn uit de set-up
verwijderd (het dode `renderModelEditor`/`renderLibraryPicker`-pad is onbereikbaar — `editing`
wordt nooit op een model gezet). Nieuwe content komt nu via het database-scherm.

**Database doorzoeken**: bovenaan het database-scherm staat een zoekveld (`drawSearchResults` in
database.js) dat models, enhancements, lores, faction- en subfaction-rules, universal
manifestations/lores en RoR doorzoekt op naam (+ beschrijving/lore-entries). Twee scopes: **"Alleen
<faction>"** (alleen de huidige blob) of **"Alle facties"** — die laadt alle faction-blobs eenmalig
in `allData` (`loadAllData`, cache) en zoekt overal. Ook **ability-namen** (en -beschrijvingen)
tellen mee: een warscroll/RoR wordt gevonden op een van zijn `abilities`, een lore op een van zijn
`entries` — het resultaat toont dan het item met `· ability: <naam>` erbij (`pushModel`/`pushLore`/
`abHit`). Een resultaat **opent het kaartje zelf** in een popup (`openSearchResult`): warscrolls
via `buildModelPopupContent`, en enhancement/faction-rule/lore/RoR via een detail-popup (`otype` +
`obj` worden per resultaat meegegeven). Het springt dus niet meer naar de faction-database. ⚠️ Itereren over blob-lijsten gaat via een `arr()`-guard (`Array.isArray`), want niet
elke faction-blob heeft elk veld als array (een `factionRules` kan een object zijn → `for…of` crasht
anders alleen bij "alle facties").

**Auto-opslaan** (hele database): alle database-editors (warscrolls, enhancements, lores, faction-/
subfaction-rules, battle tactics, seasonal rules, battleplans, Regiments of Renown) bewerken het
échte object **in-place** en slaan **automatisch** op (debounced `editSaveSoon` → `rawSaveFor` kiest
de juiste blob op basis van de editing-context; `closeEdit` doet een definitieve save). Er zijn geen
"Opslaan in de database"-knoppen meer — je sluit met **Klaar**. `startEdit` maakt geen kopie meer;
`editing.wasBlank` onthoudt of een vers toegevoegde entry leeg gesloten wordt (dan weer verwijderd).
De model-velden in `buildModelEditor` zijn nu live (`syncFromForm` op input/change) zodat ook die
auto-opslaan. (Set-up gebruikt nog steeds zijn eigen `saveData`/Personaliseren-flow.)

**Toevoegen in de database** (alleen db-editors, zie permissies): elk categorie-blok in het
database-scherm heeft een "+ Toevoegen"-knop (models, de vier enhancement-categorieën, de drie
lore-soorten, faction- en subfaction-rules; RoR had die al). Toevoegen pusht een blanco entry
en opent de editor; **annuleren** van een nog-naamloze entry haalt hem weer weg (`cancelEdit`).

## Set-up: lijst exporteren + battle tactic cards
- **Exporteren** (knop in de set-up-topbar, `showExport`/`buildExportText` in setup.js): genereert
  de lijst als platte tekst in GW-app-stijl en toont die in een modal met een **"Kopieer naar
  klembord"**-knop (`navigator.clipboard.writeText`, met textarea-select + `execCommand`-fallback).
  Formaat: `"<naam> <punten>/2000 pts"`, dan faction, battle formation (`army.aor || army.subfaction`),
  `Drops: <n>` (= regiments + RoR + auxiliary units), de spell/prayer/manifestation-lores
  (`<Soort> Lore - <naam>`), `Battle Tactic Cards: a, b`, dan **General's Regiment** eerst en daarna
  `Regiment 1..N` (leider eerst), elke unit als `<naam> (<pointsOf>)` met `•`-bullets voor General /
  Reinforced / enhancements, gevolgd door Auxiliary Units, Regiment of Renown en Faction Terrain.
- **Battle tactic cards bij de lijst**: `army.battleTactics` (max 2 namen), gekozen via een picker in
  de set-up (`renderBattleTactics`/`showTacticPicker`, tactics uit `loadGamedata().db.tactics`),
  gepositioneerd **direct onder faction/subfaction**. Zowel in de gekozen-weergave als in de picker
  kun je op een tactic klikken om de opvolgende **stappen** te zien (`showTacticSteps`).
  Omdat de tactics nu in de lijst zitten, kies je in **companion mode** je eigen tactics niet meer
  per potje: de battle set-up toont jouw tactics read-only uit `army.battleTactics` (en `game.tactics`
  wordt daaruit afgeleid); je kiest daar alleen nog de 2 tactics van de tegenstander
  (`game.enemyTactics`). Companion heeft een eigen `showTacticSteps` voor dezelfde stappen-popup.

## Companion: topbar-knoppen + enhancement-volgorde
- **Battle tactics-knop** in de companion-topbar (naast Tegenstander): `showTacticsMenu` toont jouw
  battle tactics (bovenaan, uit `game.tactics`) en die van de tegenstander (`game.enemyTactics`),
  elk klikbaar voor de stappen (`showTacticSteps`).
- **Spells-knop** (`showSpellsMenu`): toont in een modal altijd je spell-/prayer-/manifestation lore +
  de spells van je models (hergebruikt `renderLoresDisplay`).
- **Rules-knop** (`showRulesMenu`): toont je faction rules, subfaction rules (`army.subfactionRules`)
  en seasonal rules — naam, once-per-battle, phases (`phaseLabel`) en beschrijving.
- **Enhancements-knop** (`showEnhancementsMenu`): alle enhancements op je actieve models, gegroepeerd
  per model (via `eff(m).enhancements`), met categorie, stat-mods (`modLabel`) en beschrijving; de
  modelkop is klikbaar naar de popup.
- **Ability-keywords (core actions) + CP-chips**: een ability kan `keywords: ["Core","Move"]` hebben
  (uit de BSData-characteristic `Keywords`). `abilityTagsHtml()` in factions.js rendert ze als chips
  onder de ability — **core actions** (`CORE_ACTION_KEYWORDS`: Core, Move, Attack, Charge, Shoot,
  Fight, Retreat, Deploy) in goud, de rest (Rampage, Spell, Prayer, Unbind, faction-eigen tags als
  Blood Tithe/Delusion/Tidal) neutraal, plus een chip met `cpCost`. Gebruikt in de model-popup
  (modelview.js) en in companion mode (`abilityCard`). Zo toont Sigdex het ook.
  ⚠️ **De importer las `Keywords` nooit en `Cost` verkeerd**: BSData zet in `Cost` een kaal getal
  ("1"), terwijl de oude regex `(\d+)\s*CP` zocht — daardoor stonden er maar 4 CP-kosten in de hele
  database (BSData heeft er 36). Beide gefixt in `parse-faction.mjs` (`keywordList`/`cpCostOf`),
  `parse-enh.mjs` en `driver-aor.mjs`. `ko-import/merge-ability-tags.mjs` zet keywords+cpCost op de
  bestaande database (REPORT/LOCAL/Pi, backup `.bak-abilitytags`) en migreert een handmatig
  ingevoerde "Keywords: …"-regel uit de beschrijving (SoA) naar het veld.
- **Regiments-knop** (`showRegimentsMenu`, icoon `layers`, naast Units/Einde spel): snel overzicht van
  wie in welk regiment zit. Groepeert `army.models` op `regimentId` tegen `army.regiments` — het
  regiment van de general eerst, de leider (`isLeader`) bovenaan met ★ + General-chip, daarna de
  units; daarna Regiments of Renown (`reg.ror`), Auxiliary units (geen `regimentId`) en Faction
  terrain (incl. `fromTerrain`-companions). Elke unit is klikbaar naar de model-popup.
- **Tegenstander-enhancements**: in de battle set-up heeft elke tegenstander-unit een
  **Enhancements**-knop (`openOpponentEnhPicker`) die de enhancements van hun faction uit de
  gedeelde DB toont; gekozen enhancements komen als volledig object op `m.enhancements` van het
  tegenstander-model. In `showOpponentMenu` staan ze als klikbare chips onder de unit (→ `enhDetail`
  popup met categorie, stat-mods en tekst) en ze verschijnen ook in de model-popup (die leest
  `model.enhancements` via `effectiveModel`, ongeacht army).
- **Battleplan-knop** (`showBattleplanMenu`, icoon `map`): toont het battleplan-kaartje (klikbaar
  schermvullend), de twist, de battleplan-abilities en een **scoren-overzicht** (per
  `scoring.variants`: battlerounds + objective-opties met punten, plus liferoot/eindbonus). Leest
  `game.battleplan`.
- **Battle tactics kunnen abilities hebben** (`tactic.abilities`, zoals de Hideout-setup van Blazing
  Onslaught): die worden in de game gesnapshot (`snap` neemt `abilities` mee) en via
  `collectAbilities` per phase getoond — voor **zowel jouw tactics als die van de tegenstander**
  (bron "Battle tactic" / "Battle tactic (tegenstander)"). Zo verschijnt de Hideout-ability in de
  deployment-fase als jij óf je tegenstander Blazing Onslaught heeft. Twee kaarten hebben zo'n
  deployment-ability: **Blazing Onslaught** (Hideout) en **Burning Vengeance** (Fugitive). Beide
  `showTacticSteps` (companion + setup) tonen `tactic.abilities` bovenaan de stappen-popup (met een
  "Deployment"-chip) — geen eigen scorestap, maar wel zichtbaar op het kaartje. Geseed via
  `ko-import/seed-ghb-tactics.mjs`.
- **Enhancement-picker** (`showEnhancementPicker` in setup.js): de passende enhancements zijn
  gesorteerd op categorie — Artefacts of Power, dan Heroic Traits, dan de rest (monstrousTrait,
  other), binnen een categorie op naam. Stale/al-gekozen-maar-niet-passende staan er nog achter.

## Companion: Passives & blijvende effecten (buffs)
Onderaan het turn-scherm staat een uitschuifbaar blad **"Passives & blijvende effecten"**
(`renderPassivePanel`, `.passive-sheet`):
- **Passives**: alle army-brede passive abilities (faction-/subfaction-rules, seasonal rules,
  battleplan- en battle-tactic-abilities) waarvan de beschrijving met `[Passive]` begint
  (`isPassiveAb` → `collectPassives`). Ze worden uit de per-phase abilitylijst gefilterd, zodat ze
  niet elke fase tussen de rest staan, maar altijd hier te vinden zijn.
- **Actieve effecten (buffs)**: abilities waarvan de tekst "for the rest of the turn" /
  "rest of the battle round" / "until the start of your next turn" bevat (`buffDuration`) krijgen op
  hun kaart een knop **"Actief gegaan"** (`attachBuff`). Aangevinkt komen ze in `game.activeBuffs` en
  verschijnen ze in dit blad met hun duur + een **"Afgelopen"**-knop. `pruneBuffs` ruimt
  "deze beurt"-buffs op aan het einde van de beurt en alles bij een nieuwe battleround; handmatig
  weghalen kan altijd.

## Companion: volledige modus vs score-modus
In companion mode kun je via de topbar wisselen tussen **volledige modus** (alles zoals het
was: phases, abilities, commands, CP, scoren) en **score-modus** (`renderScoreMode` in
companion.js): één compact scherm per battleround met "wie gaat eerst" + beide beurten
(eigen + tegenstander) met hun scorekaart, lopende stand en battleround-navigatie. Bedoeld
om snel tussen beurten het scoren te overzien. De modus is een **apparaat-voorkeur**
(`localStorage` `aoscomp_companion_mode`, synct bewust niet, net als het thema) en vervangt
alleen de `roundSetup`- en `turn`-stages — battle set-up en game-over blijven gelijk. Je kunt
**midden in een potje** wisselen: een snelle wissel zonder te navigeren hervat de volledige
modus exact (stage/turn/phase blijven staan); navigeer je in score-modus naar een andere
battleround, dan zet dat de stage op `roundSetup` van die ronde. `renderScoringCard(owner,
{endBonus})` wordt door beide modi gebruikt; de eindbonus-vlag wordt expliciet doorgegeven
(in plaats van uit `game.turnIndex` afgeleid) zodat score-modus beide beurten kan tonen.

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
- **Superadmin-wachtwoord staat NIET in de code.** Met backend bepaalt de server het
  (als salted hash in `config.json` op de Pi — `admin_password_hash`, zie appsync). Je wijzigt
  het via **Accountbeheer → "Mijn superadmin-wachtwoord wijzigen"** (`backend.setAdminPassword`
  → server hasht + schrijft config.json, verwijdert plain `admin_password`). In de **lokale
  modus** (zonder backend) staat het per apparaat in `localStorage`
  (`storage.getLocalAdminPassword`/`setLocalAdminPassword`); is het nog niet ingesteld, dan mag
  de eerste login en stel je het daarna in. `storage.SUPERADMIN` bevat alleen nog de naam.

## Deploy
**Pushen naar `main` = deployen.** Twee hosts serveren dezelfde repo-root (statisch, geen build):
- **Eigen URL op de Pi: https://aos.lucdegroen.nl** (de canonieke URL). De Pi draait een
  zero-dependency static server (`server.mjs`, poort 3900, SPA-fallback, `.apk`-MIME, geen auth)
  als systemd-service `aoscompanion.service`, achter de Cloudflare-tunnel `energie`
  (`/etc/cloudflared/config.yml` → `aos.lucdegroen.nl` → `localhost:3900`; DNS gemaakt met
  `cloudflared tunnel route dns energie aos.lucdegroen.nl`). De repo staat als git-clone in
  `/home/luc/aoscompanion`. **Auto-deploy**: een user-cron (`crontab -l`) doet elke 2 min
  `git pull --ff-only` (log: `~/aoscompanion-deploy.log`) — een push naar main is dus binnen
  ~2 min live, zonder handmatige stap. De systemd-service + cloudflared-ingress zijn eenmalig
  met sudo opgezet (sudo kan niet non-interactief vanaf de pc — die stappen zijn aan Luc gegeven).
- **GitHub Pages** (https://ldegroen.github.io/aoscompanion/) blijft als fallback bestaan;
  serveert de repo-root direct, live binnen ~1 min.
- **App-versie/APK**: `version.json` (repo-root) bevat `versionCode`/`versionName`/`url` en wordt
  op `aos.lucdegroen.nl/version.json` geserveerd. De APK staat op de Pi in `downloads/`
  (**gitignored**, dus git pull raakt 'm niet) → `aos.lucdegroen.nl/downloads/aoscompanion.apk`.
  **Nieuwe app-release**: bump `versionCode` in `android/app/build.gradle.kts` én `version.json`,
  bouw de APK, scp naar `/home/luc/aoscompanion/downloads/aoscompanion.apk`, commit+push
  (version.json gaat mee via de cron). Bestaande installs zien dan de update-balk.

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
- Minimaal Kotlin WebView-project: laadt de live-URL **`https://aos.lucdegroen.nl/`** (`APP_URL`
  in MainActivity), `domStorageEnabled` (localStorage!), **licht thema** (`app_background`
  `#f4f5f7` + `windowLightStatusBar` — geen flits op het lichte web-thema), lichte offline-
  foutpagina, terugknop navigeert in de WebView.
- **Updatecheck**: bij het opstarten haalt `checkForUpdate()` `aos.lucdegroen.nl/version.json`
  op (achtergrond-thread) en vergelijkt `versionCode` met `BuildConfig.VERSION_CODE` (daarvoor
  staat `buildFeatures { buildConfig = true }` in build.gradle.kts). Is de gepubliceerde versie
  hoger, dan verschijnt bovenaan een gouden **update-balk** met een "Updaten"-knop die de APK-URL
  in de browser opent (download + installeer; debug-signed, dus installeert over de bestaande app
  heen). Zie de Deploy-sectie voor het release-proces (version.json + downloads/apk).
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
