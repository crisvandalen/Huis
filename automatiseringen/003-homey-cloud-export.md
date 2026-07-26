# 003 — Periodieke Homey-export via de cloud (op de VPS)

**Status:** gebouwd
**Draait op:** script (`scripts/homey/export-cloud.mjs`) + cron op de VPS

## Wat moet het doen

Elk uur de actuele Homey-toestand via de Athom-cloud ophalen en het dashboard
opnieuw bouwen, zodat er altijd een verse momentopname klaarstaat — ook als
niemand thuis achter de Mac zit.

## Waarom

De bestaande `export-devices.mjs` praat via de **lokale** Homey-API en werkt
alleen op het thuisnetwerk. De VPS ("het brein") staat buiten dat netwerk, dus
daar loopt de lokale export stuk (host onbereikbaar; de lokale key geeft 401
tegen de cloud). Zonder cloud-export zou het dashboard op de VPS bevriezen op de
laatste handmatige export vanaf de Mac.

## Trigger

Cron op de VPS, elk uur (`0 * * * *`). Bewust niet vaker: de cloud-API is niet
bedoeld voor hoge frequentie en het dashboard hoeft niet realtime te zijn.

## Actie

1. `node scripts/homey/export-cloud.mjs` — logt in via het opgeslagen OAuth2-
   refresh-token, haalt devices, zones, flows en advanced flows op, en schrijft
   `inventaris/export/homey-ruw.json` + `homey.json` (zelfde formaat als de
   lokale export).
2. `bouw_dashboard.py` (via `make dashboard`) bouwt `dashboard/index.html` uit
   die exports. Samen: `make cloud-dashboard`.

## Randgevallen

- **Token verlopen / cloud onbereikbaar** — script eindigt met exit-code 1 en
  laat de vorige export/dashboard onaangeroerd staan. Nooit een half bestand
  wegschrijven: de export wordt pas geschreven nadat de data binnen is.
- **Eén sectie faalt** (bv. `getAdvancedFlows` niet beschikbaar) — die sectie
  wordt leeg gelogd (`--`), de rest wordt gewoon geëxporteerd.
- **RTS-zonwering** — status blijft een aanname; de export toont alleen wat
  Homey teruggeeft. Geen automatisering hierop bouwen (zie CLAUDE.md).
- **Herstart VPS** — cron pakt de volgende hele-uur-run vanzelf weer op.

## Ontsnapping

Puur uitlezen, stuurt niets aan — er is niets te overrulen. Cron uitzetten:
regel weghalen uit `crontab -e`.

## Testen

Handmatig op de VPS: `make cloud-export` moet "29 apparaten" tonen en
`inventaris/export/homey.json` verversen; `make dashboard` bouwt daarna het
HTML. Controleer het tijdstempel `opgehaald_op` in `homey.json`.

## Openstaande vragen

- [ ] Wil je het dashboard ook serveren (nginx/Caddy op 80/443, staat al open)
      zodat je het van buiten kunt bekijken? Of blijft het een lokaal bestand?
- [ ] Later eventueel ook flows periodiek naar git committen (versiebeheer dat
      Homey zelf mist, ADR 0002) — dan heeft de VPS-deploykey schrijfrechten
      nodig.
