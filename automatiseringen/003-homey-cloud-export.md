# 003 — Periodieke Homey-export (op linuxcris)

**Status:** gebouwd — aug 2026 terug van cloud-export (VPS) naar lokale export op linuxcris
**Draait op:** linuxcris — cron, elk uur `git pull` + `make homey dashboard`

## Wat moet het doen

Elk uur de actuele Homey-toestand ophalen en het dashboard opnieuw bouwen, zodat
er altijd een verse momentopname klaarstaat — ook als niemand thuis achter de Mac
zit.

## Waarom

Het dashboard moet 24/7 vers zijn. linuxcris staat altijd aan; de Mac slaapt.

## Lokaal vs. cloud

linuxcris zit op het thuis-LAN, dus de **lokale** Homey-API werkt (snel, geen
internet nodig). Standaard is daarom `make homey` (`export-devices.mjs`).

Historie: op de opgezegde Hetzner-VPS ("het brein") kon dit niet — die stond
buiten het LAN, dus daar liep het via de Athom-cloud (`export-cloud.mjs`, OAuth2).
Die cloud-route blijft als **fallback** bestaan voor een eventuele off-LAN
situatie; zie `docs/archief/04-cloud-oauth2.md`. Voor het dashboard op linuxcris
is hij niet nodig.

## Trigger

Cron op linuxcris, elk heel uur (`0 * * * *`):
`cd ~/huis && git pull && make homey dashboard >> ~/cron-huis.log 2>&1`.

## Actie

1. `make homey` -> `export-devices.mjs` leest via de lokale API devices, zones,
   flows en advanced flows en schrijft `inventaris/export/homey-ruw.json` +
   `homey.json`.
2. `make dashboard` -> `bouw_dashboard.py` bouwt `dashboard/index.html` uit die
   exports. De systemd-service `huis-dashboard` (serveer.py, `:8765`) serveert het.

## Randgevallen

- **Homey onbereikbaar** — de export eindigt met een fout en laat de vorige
  export/dashboard onaangeroerd staan; nooit een half bestand wegschrijven.
- **Eén sectie faalt** (bv. advanced flows) — die sectie wordt leeg gelogd (`--`),
  de rest wordt gewoon geëxporteerd.
- **RTS-zonwering** — status blijft een aanname; de export toont alleen wat Homey
  teruggeeft. Geen automatisering hierop bouwen (zie CLAUDE.md).
- **Herstart linuxcris** — de cron én de systemd-service komen vanzelf weer op.

## Ontsnapping

Puur uitlezen, stuurt niets aan. Cron uitzetten: regel weghalen uit `crontab -e`
op linuxcris.

## Testen

Op linuxcris: `cd ~/huis && make homey` moet het aantal apparaten tonen en
`inventaris/export/homey.json` verversen (check `opgehaald_op`); `make dashboard`
bouwt daarna het HTML.

## Openstaande vragen

- [ ] Later eventueel flows periodiek naar git committen (versiebeheer dat Homey
      zelf mist, ADR 0002).
