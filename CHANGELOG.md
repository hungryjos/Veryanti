# Changelog

De versie bovenaan dit bestand moet gelijk zijn aan `@version` in
`veryanti.user.js` — `npm test` controleert dat.

## 1.4.0

* Bredere matchregels: naast `*://` staan er nu ook expliciete `https://`
  varianten en twee `@include`-patronen. Managers die het `*://`-schema of
  `@match` niet volledig ondersteunen — zoals sommige mobiele apps — herkennen
  de site daardoor alsnog.

## 1.3.0

* `@updateURL` en `@downloadURL` wijzen nu naar `github.com/.../raw/...` in
  plaats van `raw.githubusercontent.com`. Die eerste vorm loopt over github.com
  en gebruikt dus je sessie, waardoor bijwerken ook op een **private**
  repository werkt; `raw.githubusercontent.com` kent geen sessie-login en geeft
  daar altijd 404.

## 1.2.0

* `@updateURL` en `@downloadURL` toegevoegd, zodat script managers zelf een
  nieuwe versie ophalen. Werkt zodra de repository public staat.
* Elke wijziging van `@version` op de standaardbranch maakt nu automatisch een
  git-tag en een GitHub-release, met het script als bijlage.
* De metadatatest bewaakt dat header, `VERSION` in de code en dit changelog
  hetzelfde versienummer noemen.

## 1.1.1

* Metadatablok gerepareerd: er stonden vijf regels tussen de
  `==UserScript==`-markers die geen `// @sleutel waarde`-paar zijn (twee
  streepjeslijnen, een uitlegregel en twee lege `//`-regels). Strenge parsers
  stoppen daar met lezen, waardoor de `@match`-regels wegvielen en het script
  nergens draaide. De niet-standaard regex-`@include` is vervangen door gewone
  match-patronen.
* `test/meta.mjs` toegevoegd: leest het metadatablok zoals een script manager
  dat doet en keurt directives, match-patronen en versienummer.
* Levensteken: één console-regel per pagina met de actieve lagen, plus
  `data-veryanti` op `<html>`. Dat attribuut is er ook als de manager het
  script in een sandbox draait, wat "start niet" onderscheidt van "start wel,
  maar zonder toegang tot de paginacode".

## 1.1.0

* De DOM-opruiming werd nooit geïnstalleerd: op `document-start` bestaat
  `document.documentElement` soms nog niet, waardoor het injecteren van de CSS
  een `TypeError` gooide en de observer én de sweep-lus meesleurde. DOM-werk
  wacht nu op `<html>`.
* Tekstscan: nagschermen worden gevonden op hun bewoording en het omliggende
  vakje wordt verwijderd, ook zonder verklappende klassenaam. Stopt vóór de
  player en vóór grote stukken pagina.
* De browsertest draait de fixture nu op `https://xadultflix.com/` zodat de
  hostregels meedoen, kent een scenario waarin de muur geforceerd opengaat, en
  faalt als een laag bij het opstarten stukloopt.

## 1.0.0

* Eerste versie: zes lagen — lokaas zichtbaar maken, detector-stubs,
  probe-spoofing, timerfilter, DOM-opruiming en popup-blokkade — met regels per
  host en een browsertest.
