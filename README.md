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

## Versies en automatisch bijwerken

Elke versie staat in [`CHANGELOG.md`](CHANGELOG.md) en krijgt in GitHub een
tag `vX.Y.Z` plus een release met het script als bijlage. Dat gaat vanzelf:
zodra `@version` in `veryanti.user.js` verandert op de standaardbranch, maakt
[`.github/workflows/release.yml`](.github/workflows/release.yml) de tag en de
release aan. Versiegeschiedenis vind je onder *Releases* in de repository.

Het script wijst met `@updateURL` en `@downloadURL` naar:

```
https://raw.githubusercontent.com/hungryjos/Veryanti/HEAD/veryanti.user.js
```

`HEAD` betekent "de standaardbranch", dus die link blijft kloppen als je later
van branchnaam wisselt.

> **Voorwaarde: de repository moet public staan.** Een script manager haalt die
> URL op zonder jouw GitHub-login; bij een private repo krijgt hij een 404 en
> gebeurt er niets. Zet de repo public via *Settings → General → Danger Zone →
> Change visibility*. Wil je hem privé houden, dan is een **secret gist** het
> alternatief: onvindbare URL, maar wel zonder login bereikbaar. Zet de
> `@updateURL` en `@downloadURL` dan op de raw-URL van die gist.

Installeer het script in je manager **via de URL**, niet met kopiëren en
plakken — alleen dan weet de manager waar hij later moet kijken. Voor een
handmatig geplakt script staat er geen bron geregistreerd en gebeurt er nooit
een update.

Update-gedrag verschilt per manager. Tampermonkey en Violentmonkey vergelijken
periodiek `@version` via `@updateURL` en halen bij een hoger nummer het bestand
van `@downloadURL`. Kleinere of nieuwere managers — waaronder wBlock — doen dat
niet altijd; ik kan hier niet nagaan wat jouw versie ondersteunt. Kijk in de
instellingen van de manager of bij het script zelf naar een optie in de trant
van "check for updates". Zit die er niet, dan is het script opnieuw toevoegen
via dezelfde URL genoeg: dat haalt de laatste versie op. Aan de kant van dit
script is alles wat nodig is in elk geval aanwezig.

## Extra sites toevoegen

Bovenaan het script staat het `@match`-blok:

```js
// @match        *://xadultflix.com/*
// @match        *://*.xadultflix.com/*
```

Voeg per site een regel toe, bijvoorbeeld `// @match *://voorbeeld.com/*`.
Wil je het overal laten draaien, vervang het hele blok dan door één regel die
alle hosts dekt. Dat werkt breed, maar kan op sommige sites layout- of
playerlogica raken — zie *Als iets stukgaat* hieronder.

> **Let op:** elke regel tussen `// ==UserScript==` en `// ==/UserScript==`
> moet een `// @sleutel waarde`-paar zijn. Zet er geen uitleg, streepjeslijn
> of lege `//`-regel tussen: strenge parsers stoppen daar met lezen, waardoor
> je `@match`-regels wegvallen en het script nergens meer draait. `npm test`
> controleert dit.

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

## Draait het wel?

Bij elke pagina zet Veryanti één regel in de console:

```
[Veryanti] v1.1.1 on xadultflix.com — active: fakeBaitVisibility, stubDetectors, …
```

Zie je die niet, controleer dan in de console (F12) deze twee dingen:

| `document.documentElement.dataset.veryanti` | `window.__veryanti` | Wat is er aan de hand |
| --- | --- | --- |
| versienummer | object | Alles in orde. |
| versienummer | `undefined` | Je manager draait het script in een sandbox (meestal door de CSP van de site). De DOM-opruiming werkt dan nog, maar het onderscheppen van paginacode niet. Violentmonkey heeft hier minder last van dan Tampermonkey. |
| `undefined` | `undefined` | Het script start niet. Klopt de host in je `@match`? Staat het script aan in het dashboard? Draait je manager in privévensters? En: staat er geen losse tekstregel in het metadatablok (zie hierboven)? |

Verschijnt er wel een regel maar staan er lagen achter `failed:`, stuur die
melding dan door — dan weet ik precies welke laag klapt.

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
