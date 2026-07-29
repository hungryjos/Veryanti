# Veryanti

Een userscript dat anti-adblock muren onschadelijk maakt — die schermen die zeggen
"schakel je adblocker uit om verder te kijken". Standaard geconfigureerd voor
**xadultflix.com**, maar zo opgezet dat je er in één regel extra sites bij zet.

Het script vervangt je adblocker niet: het zorgt ervoor dat een site niet
merkt dat je er een gebruikt.

## Installeren

1. Installeer een userscript-manager:
   [Violentmonkey](https://violentmonkey.github.io/) (aanbevolen, open source),
   [Tampermonkey](https://www.tampermonkey.net/) of Greasemonkey.
2. Open [`veryanti.user.js`](veryanti.user.js) in raw-weergave — de manager
   biedt automatisch aan om te installeren.
   Of: maak in de manager een nieuw script en plak de inhoud van het bestand.
3. Herlaad de site. Zet je adblocker gewoon aan laten staan.

## Extra sites toevoegen

Bovenaan het script staat het `@match`-blok:

```js
// @match        *://xadultflix.com/*
// @match        *://*.xadultflix.com/*
```

Voeg per site een regel toe, bijvoorbeeld `// @match *://voorbeeld.com/*`.
Wil je het overal laten draaien, vervang het hele blok dan door:

```js
// @match        *://*/*
```

Dat werkt breed, maar kan op sommige sites layout- of playerlogica raken —
zie *Als iets stukgaat* hieronder.

## Hoe het werkt

Zes onafhankelijke lagen; faalt er één, dan blijven de andere werken.

| Laag | Wat het doet |
| --- | --- |
| **Lokaas zichtbaar maken** | Detectors maken een `<div class="ad-banner">` en kijken of je blocker die verbergt. `offsetHeight`, `clientHeight`, `getBoundingClientRect()` en `getComputedStyle()` liegen voor precies zulke elementen — en alleen daarvoor. |
| **Detector-stubs** | `FuckAdBlock`, `BlockAdBlock`, `sniffAdBlock` en verwanten worden vervangen door namaakversies die altijd "geen adblocker" melden. De echte versie van de site kan ze niet meer overschrijven. Vlaggen als `canRunAds` staan vast op de goede waarde. |
| **Probe-spoofing** | Een request naar `doubleclick.net` of `/ads.js` dat je blocker afkapt, wordt omgeleid of afgevangen zodat de site een geslaagd antwoord ziet in plaats van een netwerkfout. Geldt voor `<script src>`, `<img src>`, `fetch()` en `XMLHttpRequest`. |
| **Timerfilter** | `setTimeout`/`setInterval`-callbacks waarvan de broncode over adblock-detectie gaat, worden niet uitgevoerd. Zo stopt de lus die het scherm steeds opnieuw toont. |
| **DOM-opruiming** | Overlays met adblock-teksten (NL/EN/DE/FR/ES/IT) worden verwijderd, inclusief de donkere achtergrondlaag, en `overflow: hidden` / `position: fixed` / blur op `<body>` wordt teruggedraaid zodat je weer kunt scrollen. |
| **Tekstscan** | Zoekt de melding op de woorden zelf ("Please consider disabling your ad blocker") en gooit het vakje eromheen weg — ook als de klassenaam nergens naar verwijst. Loopt omhoog tot de balk of dialoog, maar stopt vóór de player en vóór grote stukken pagina. |
| **Popup-blokkade** | `window.open()` zonder echte klik erachter wordt geweigerd (popunders), en `onbeforeunload` wordt genegeerd. |

## Bijstellen per site

Onderin de configuratie staat `SITE_RULES`. Per host kun je selectors opgeven
en losse opties overschrijven:

```js
const SITE_RULES = {
    'xadultflix.com': {
        remove: ['#adblock-overlay', '.please-disable-adblock'],
        unhide: ['#player', '.video-holder'],
        options: { blockPopups: true },
    },
};
```

* `remove` — selectors die altijd weggegooid worden
* `unhide` — elementen die de site verstopt in plaats van een modal te tonen
  (typisch de player) en die geforceerd zichtbaar worden gemaakt
* `options` — elke sleutel uit `CONFIG`, alleen voor deze host

Zet `debug: true` in `CONFIG` om in de console te zien wat er verwijderd wordt;
dan lees je zo de echte selectors af. Tijdens het tunen is `window.__veryanti`
beschikbaar in de console:

```js
__veryanti.sweep()     // handmatig opruimen
__veryanti.removed     // aantal verwijderde elementen
__veryanti.settings    // actieve configuratie voor deze host
__veryanti.installed   // lagen die draaien
__veryanti.failed      // lagen die bij het opstarten stukliepen
```

Bestaat `window.__veryanti` niet, dan draait het script helemaal niet op die
pagina — controleer je `@match`-regels en of het script aanstaat in je manager.

## Als iets stukgaat

Zet de lagen één voor één uit in `CONFIG` om te zien welke de boosdoener is:

* **Player of layout kapot** → `fakeBaitVisibility: false`.
  Sites die zelf hun layout meten kunnen struikelen over de nepafmetingen.
* **Legitieme popup opent niet** (login, betaling) → `blockPopups: false`.
* **Een knop of menu doet niets meer** → `filterTimers: false`.
* **Er verdwijnt tekst die je wilde lezen** (bijvoorbeeld een pagina die zelf
  over adblockers gaat) → `textScan: false`.
* **Er verdwijnt te veel** → `cleanDom: false`, of laat
  `aggressiveOverlayRemoval` op `false` staan (standaard). Aan zetten verwijdert
  álle schermvullende lagen met een hoge z-index, ook echte lightboxen.

## Test

Er zit een geautomatiseerde test bij die een nepsite met zeven veelgebruikte
detectietechnieken opzet en controleert dat de muur verdwijnt:

```bash
node test/run.mjs
```

Vereist [Playwright](https://playwright.dev/) met Chromium. De test draait de
fixture eerst zonder het script (de muur moet verschijnen) en daarna met het
script (alles moet schoon zijn).

## Beperkingen

* Sites veranderen. Werkt een detectie na een update toch weer, zet dan
  `debug: true` aan en voeg de nieuwe selector toe aan `SITE_RULES`.
* Server-side muren (waarbij de server de video simpelweg niet uitlevert) kan
  een userscript niet omzeilen — dit script werkt alleen tegen detectie in de
  browser.
* In `<iframe>`s van derden draait het script alleen als je manager
  frame-injectie toestaat.

## Licentie

MIT.
