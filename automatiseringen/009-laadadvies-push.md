# 009 — Pushbericht naar de iPhone (laadadvies doorsturen)

**Status:** gebouwd
**Draait op:** linuxcris — `scripts/homey/push.mjs` (generiek) +
`scripts/homey/laadadvies-push.mjs` (laadadvies) + dagelijkse cron

## Wat moet het doen

Een kort pushbericht naar de Homey-app op de iPhone kunnen sturen, en dat
gebruiken om het **dagelijkse laadadvies** (008) door te sturen: goedkoopste
laadvenster, goedkoopste uur en eventuele negatieve-markturen.

## Waarom

Het laadadvies stond tot nu toe alleen op de dashboardpagina en in de console
(open punt in 008). Een dagelijks duwtje op de telefoon is handiger: je ziet 's
middags meteen wanneer je vanavond/vannacht het best laadt, zonder een pagina te
openen.

## Hoe (mechaniek)

Homey kan een melding naar de app op de telefoon duwen via een
**timeline-notificatie**. Lokaal (op het LAN) gaat dat met een POST naar
`http://<HOMEY_HOST>/api/manager/notifications/notification/` met body
`{ "excerpt": "<tekst>" }` en de Bearer-API-key. Dit is dezelfde soort melding
als de meldingskaart in de nachtslot-flow (003), maar dan rechtstreeks vanuit een
script.

- `push.mjs` is de generieke bouwsteen: `stuurPush(tekst)` + CLI
  `node scripts/homey/push.mjs "tekst"`.
- `laadadvies-push.mjs` roept `maakLaadadvies()` uit 008 aan (verse prijzen),
  maakt er een korte melding van en stuurt die via `stuurPush()`.

**Belangrijk:** dit is een LAN-actie. Cowork (cloud) kan het thuisnetwerk niet
bereiken, dus dit draait op **linuxcris** (of lokaal op de Mac), niet vanuit een
chatsessie. Zie `docs/04-linuxcris.md`.

## Trigger

Dagelijks via cron op linuxcris, 13:15 — ná ~13:00 staan de prijzen van morgen
online (zelfde timing als 008):

```
15 13 * * *  cd ~/huis && node scripts/homey/laadadvies-push.mjs >> ~/laadadvies-push.log 2>&1
```

## Actie

1. `laadadvies-push.mjs` -> `maakLaadadvies({ stil: true })` haalt de EPEX-prijzen
   op en bepaalt venster/uur/negatieve uren/besparing (schrijft ook
   `dashboard/laadadvies.json`, net als 008).
2. Formatteert een korte NL-melding, bv.:
   *"⚡ Laadadvies — goedkoopst di 11:00–di 16:00 (gem €0,248/kWh, ~€1,63 voordeel).
   Goedkoopste uur: di 13:00 (€0,236/kWh)."*
3. `stuurPush(tekst)` POST't de melding naar Homey; die verschijnt in de
   Homey-app op de iPhone.

## Randgevallen

- **Homey onbereikbaar / verkeerde key** — script eindigt met een nette fout
  (HTTP-status wordt gelogd), stuurt niets half.
- **Prijzen van morgen nog niet online** (vóór ~13:00) — `maakLaadadvies` gebruikt
  dan alleen de resterende uren van vandaag; de melding klopt nog steeds.
- **Notificatie-API pusht niet naar de telefoon** — sommige Homey-instellingen
  duwen timeline-meldingen niet door. Zie *Openstaande vragen* voor de fallback
  (een kleine Homey-flow met meldingskaart, via de API getriggerd).
- **RTS/aansturing** — n.v.t., dit stuurt niets aan; puur een melding.

## Ontsnapping

Puur een melding, er valt niets te overrulen. Stoppen = de cronregel weghalen.

## Testen

Op linuxcris (op het LAN):

```bash
cd ~/huis
make push MSG="Test vanuit linuxcris"     # of: node scripts/homey/push.mjs "Test"
make laadadvies-push                        # berekent + stuurt het echte advies
```

Verschijnt de melding in de Homey-app op de iPhone? Zo ja: cron toevoegen. Zo
niet: check de gelogde HTTP-status en zie de fallback hieronder.

## Openstaande vragen

- [ ] **Bevestigen dat de timeline-notificatie ook echt naar de iPhone pusht.**
      Zo niet: fallback = een Homey-flow "Stuur pushmelding" (meldingskaart
      `homey:manager:notifications`) die we via de API starten; dan gaat de push
      gegarandeerd via de app-notificaties. (Aanpak zoals `maak-nachtslot-flow.mjs`.)
- [ ] Eventueel alleen pushen als er iets bijzonders is (bv. negatieve uren of
      besparing boven een drempel), i.p.v. elke dag.
