# 004 — Qventi-airco: uitlezen én bedienen op het dashboard

**Status:** gespecificeerd
**Draait op:** Homey (officiële Tuya-app `com.tuya2`) → mee in de bestaande
Homey-export (uitlezen) + een backend-endpoint `POST /airco` op de ververs-
server dat via de Homey-API stuurt (bedienen)

## Wat moet het doen

De Qventi-airco op het dashboard tonen (aan/uit, doel- en huidige temperatuur)
én 'm vanaf datzelfde dashboard kunnen aan/uit zetten en de temperatuur
wijzigen. Scope bewust klein: **aan/uit + temperatuur**, geen stand/ventilator.

## Waarom

De airco hangt nu los van de rest: alleen te bedienen via de Tuya/Smart Life-app
op de telefoon. Op het dashboard staat al alles bij elkaar (klimaat, energie,
beveiliging); daar hoort de airco ook thuis, en bij warm weer wil je 'm kunnen
starten zonder de app te zoeken.

## Situatie

- De airco heeft de **USB-Tuya wifi-module** en staat in de **Smart Life / Tuya-
  app**. Zit (nog) niet in Homey.
- Het dashboard is nu een **statische momentopname**, elk uur herbouwd op
  linuxcris (`make homey dashboard` via cron) en geserveerd op `:8765`
  (systemd `huis-dashboard`) achter LAN + Tailscale. Bedienen kan daarop
  meeliften via het ververs-endpoint van serveer.py (`/ververs`), op dezelfde
  poort.

## Route-keuze

Drie opties bekeken (Cris: "zeg jij maar", daarna gekozen):

**A. Eigen Tuya-cloud-script.** Zou zelfstandig zijn, maar vraagt een Tuya IoT
Cloud-project. In de praktijk liep dat vast: een **gratis Tuya-account mag maar
één Cloud-project**, en de console duwt je richting een (onnodig) enterprise-
account. Geparkeerd — het scriptje `scripts/tuya/airco.mjs` blijft in de repo
staan voor als we ooit tóch de directe route willen, maar wordt nu niet gebruikt.

**B. Via Homey (GEKOZEN).** Sinds december 2025 is er een **officiële Tuya-app
voor Homey** (`com.tuya2`) waarin je met je **gewone Smart Life-account** inlogt
— géén developer-account. De airco verschijnt dan als Homey-device en komt
**vanzelf mee in de bestaande `cloud-export`** (uitlezen is dus "gratis").
Bedienen gaat via de Homey-API, dezelfde route die de export al gebruikt. Nadeel
van vroeger (de oude, onderhouden-loze Tuya-app) vervalt: dit is de officiële.

> Let op: de *oude* Tuya-app (`com.tuya.cloud`) werkt niet meer voor nieuwe
> gebruikers (Tuya trok de API-toegang in). Het moet de nieuwe `com.tuya2` zijn.

> Dit raakt niet aan de openstaande architectuurkeuze (Homey vs. Home Assistant);
> de airco hangt gewoon aan Homey zoals de rest.

## Trigger

- **Uitlezen:** cron op linuxcris, elk uur, mee in de bestaande dashboard-bouw
  (`make homey dashboard`). Geen nieuw script nodig.
- **Bedienen:** de mens klikt op een knop/slider in het dashboard.

## Actie

**Uitlezen** (bestaande pijplijn):

1. Airco staat in Homey (via `com.tuya2`) → `export-devices.mjs` haalt 'm mee op in
   `homey-ruw.json` / `homey.json`, net als elk ander Homey-device.
2. `bouw_dashboard.py` herkent de airco (op klasse, vermoedelijk `thermostat`/
   airco, of op de Tuya-driver) en toont een **Klimaat/Airco-kaart** op Overzicht
   plus een eigen blokje (aan/uit, huidige temp, doeltemp).

**Bedienen** (`POST /airco` op de backend):

3. Dashboardknoppen posten `{ commando, waarde }` naar `/airco` op serveer.py
   (zelfde poort 8765 als het dashboard en de ververs-knop).
4. De backend zet via de **Homey-API** de capability
   (`onoff` of `target_temperature`) van de airco, leest daarna vers uit en
   herbouwt het dashboard, zodat de knop meteen de nieuwe stand toont.
   Aandachtspunt: de Homey-key die de export gebruikt moet **schrijfrechten**
   hebben (device control) — de lokale key heeft die (maakt al flows aan).

## Ontsnapping

De Tuya/Smart Life-app, de fysieke afstandsbediening én de Homey-app blijven
werken en winnen; het dashboard is maar één van de bedieningen. Het dashboard
toont de laatst gelezen stand, dus na een handmatige wijziging elders loopt het
maximaal één uur (of één ververs) achter.

## Randgevallen

- **Airco offline** (stekker eruit / wifi weg) — Homey geeft `available:false`;
  kaart toont "offline" en de knoppen worden gedisabled i.p.v. blind sturen.
- **Homey-cloud onbereikbaar / token verlopen** — bestaande export laat de
  vorige `homey.json` staan (zelfde regel als 003). Bedienen faalt netjes met
  een melding.
- **Capabilities wijken af van de aanname** — eerst de airco één keer laten
  exporteren en de echte capability-namen aflezen vóór de mapping/bediening vast
  ligt (bron van waarheid = de export).
- **Dubbel bedienen** (app én dashboard) — laatste commando wint; het dashboard
  leest na elk commando vers en corrigeert zichzelf.
- **Bedienen werkt alleen over http(s)** — op de lokale `file://`-kopie draait
  geen backend, dus daar zijn de knoppen verborgen (net als de ververs-knop).

## Testen

- **Uitlezen:** na pairing `make homey` → airco staat in `homey.json`;
  huidige temp klopt met de app. Daarna `make dashboard`: kaart verschijnt.
- **Bedienen:** eerst een dry-run in de backend die het Homey-commando logt maar
  niet stuurt; daarna één echte test (doeltemp +1°) en in de app controleren dat
  de airco meebeweegt.

## Openstaande vragen

- [ ] **Handmatige stap Cris:** de officiële **Tuya-app (`com.tuya2`)** op Homey
      installeren, inloggen met het Smart Life-account, de airco laten
      verschijnen en 'm een **ruimte** geven. Daarna `make cloud-export` (of de
      uurlijkse cron). Cowork kan dit niet zelf (Homey-app + thuisnetwerk).
- [ ] Na de export: exacte capabilities aflezen (onoff, target_temperature,
      measure_temperature, klasse/driver) → mapping in `bouw_dashboard.py`.
- [ ] Heeft de lokale Homey-key schrijfrechten voor device-control? Waarschijnlijk
      wel (hij maakt al advanced flows aan); bij bediening verifiëren.
- [ ] In welke ruimte hangt de airco? (voor de kaart en `apparaten.yaml`)
