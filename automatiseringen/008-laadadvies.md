# 008 — Laadadvies-agent (goedkoopste/negatieve uren)

**Status:** gebouwd
**Draait op:** script (`scripts/homey/laadadvies.mjs`) + pagina `dashboard/laadadvies.html`

## Wat moet het doen

Dagelijks adviseren wanneer je de Mini's het best laadt: het goedkoopste aaneengesloten venster, een nacht-alternatief, en de uren met negatieve marktprijs — met een schatting van het voordeel. **Stuurt niets aan.**

## Waarom

Je laadt ~880 kWh/maand tegen dynamische prijzen. Het basisdeel (nachtladen) doe je al goed, maar de exacte goedkoopste uren wisselen per dag, en op zonnige dagen zijn er negatieve-markt-uren (all-in ~€0,09) die je met laden/zon kunt benutten. Een dagelijks advies pakt dat mee zonder risico van aansturing.

## Trigger

Handmatig `make laadadvies`, of dagelijks via cron ná ~13:00 (dan staan de prijzen van morgen online).

## Actie

1. Haalt de EPEX-uurprijzen van vandaag + morgen op (EnergyZero) en rekent ze om naar all-in FlexPrijs (markt + belasting + opslag).
2. Bepaalt het goedkoopste aaneengesloten venster van `LAADUREN` uur (globaal én binnen 22:00–08:00), de negatieve-markt-uren, en het goedkoopste uur.
3. Schat het voordeel t.o.v. lukraak laden (`LAAD_PER_DAG_KWH` × prijsverschil).
4. Schrijft `dashboard/laadadvies.json`; `laadadvies.html` toont advies, tegels en een prijsgrafiek met het venster (groen) en negatieve uren (rood). De console-regel is bruikbaar als melding.

### .env (optioneel, met defaults)

```
LAADUREN=5             # uren die je per nacht nodig hebt
LAAD_PER_DAG_KWH=29    # typische dagelijkse laadhoeveelheid (voor de besparing-schatting)
```

### Dagelijks draaien

Cron op linuxcris (of de Mac):

```
15 13 * * *  cd ~/projects/huis && node scripts/homey/laadadvies.mjs >> ~/laadadvies.log 2>&1
```

(Of laten meelopen met de `make energie`-poller — vraag Claude om het erin te hangen.)

## Ontsnapping

Puur advies; er valt niets te overrulen. Cron/target weglaten = klaar.

## Randgevallen

- **Prijzen van morgen nog niet beschikbaar** (vóór ~13:00) — dan gebruikt 'ie alleen de resterende uren van vandaag; nette melding.
- **Negatieve all-in prijs** bestaat praktisch niet (energiebelasting zit er altijd op); "negatief" slaat op de **markt**prijs — dan is all-in het laagst (~€0,09).
- **Auto overdag weg** — het nacht-venster is er als alternatief; het globale venster kan overdag vallen (bij zon/negatieve prijs).

## Testen

`make laadadvies` → toont het goedkoopste venster, nacht-venster en eventuele negatieve uren. Open `laadadvies.html`: advies + grafiek vullen zich, met het venster groen en negatieve uren rood gemarkeerd.

## Openstaande vragen

- [x] Dagelijkse melding via **push** naar de iPhone gekoppeld — zie `automatiseringen/009-laadadvies-push.md` (`scripts/homey/laadadvies-push.mjs`).
- [ ] Later koppelen aan aansturing (auto-API / 50five) — aparte automatisering, vereist spec + bevestiging.
