# ADR 0003 — Ring-camera's op het dashboard

**Status:** geaccepteerd
**Datum:** 2026-07-29

> **Update aug 2026:** verwijzingen naar de VPS hieronder zijn vervangen door
> linuxcris (zie ADR 0004); het besluit zelf verandert niet.

## Context

De drie Ring-camera's (Front, Backyard, Woonkamer) zitten al aan Homey
gekoppeld via de Amazon Ring-app (driver `com.amazon.ring:stickupcam`). Homey
geeft ze klasse `sensor`, waardoor ze op het dashboard onopvallend tussen de
andere sensoren stonden. Cris wil de camera's herkenbaar op het dashboard,
inclusief — indien mogelijk — live beeld.

De Homey Ring-app levert per camera alleen: `alarm_motion` (beweging),
`measure_battery` (accu; niet bij Woonkamer), `flood_light` (schijnwerper) en
`siren`. Er is **geen** capability voor een videostream. Het dashboard zelf is
bovendien een statische momentopname (`bouw_dashboard.py`), die elk uur opnieuw
wordt gebouwd en geserveerd — geen live-verbinding voor een videostream.

## Opties

1. **Status uit Homey tonen** — camera's herkennen aan de driver, eigen
   "Camera's"-blok met beweging/batterij/floodlight/sirene, plus 📷-icoon in de
   kamerlijsten en beweging/sirene als statusmelding.
   *Voor:* werkt binnen de bestaande pijplijn, geen nieuwe geheimen of
   diensten. *Tegen:* geen live beeld.
2. **Live videobeeld** — via `ring-mqtt` / `ring-client-api` met een 2FA-
   refresh-token een on-demand WebRTC/RTSP-stream opzetten en die in het
   dashboard embedden.
   *Voor:* echt live beeld. *Tegen:* apart, fors project; vereist een
   restream-relay (een extra draaiende dienst), Ring-inloggegevens met 2FA-
   token als nieuw geheim, en het botst met het statische, uurlijks-gebouwde
   karakter van het dashboard. Ring blokkeert bovendien regelmatig
   ongeofficiële clients.

## Besluit

Optie 1. Het dashboard toont de camerastatus uit de Homey Ring-app; live beeld
valt buiten deze pijplijn. Live video (optie 2) is bewust niet gebouwd en
wacht op een eigen spec + ADR als Cris het alsnog wil.

## Gevolgen

- `scripts/bouw_dashboard.py` herkent Ring-camera's aan `com.amazon.ring` in de
  driver (`is_ring()`), geeft ze het 📷-icoon, een eigen "Camera's"-blok met
  badges, en meldt live beweging + een loeiende sirene in de meldingenbalk.
- Werkt via `make dashboard` (met verse export: `make homey dashboard`). De
  uurlijkse cron op linuxcris gebruikt de repo-kopie van het script, dus een
  wijziging is pas zichtbaar ná `git pull` op linuxcris.
- Wil Cris later tóch live beeld: nieuwe spec in `automatiseringen/` + ADR die
  deze vervangt, met keuze voor een restream-aanpak en opslag van het Ring-
  token in `.env` (nooit in git).
