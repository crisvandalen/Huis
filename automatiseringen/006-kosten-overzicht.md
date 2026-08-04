# 006 — Kosten- & opbrengsten-overzicht

**Status:** gebouwd
**Draait op:** script (`scripts/homey/kosten-bijwerken.mjs`) + statische pagina `dashboard/kosten.html`

## Wat moet het doen

Bijhouden wat je stroom kost (afname × all-in FlexPrijs) en oplevert (teruglevering × terugleververgoeding), per dag en per maand, in een groeiend logboek.

## Waarom

"Energie nu" toont het moment; de simulator het hypothetische jaar. Wat ontbrak is de feitelijke tussenstand: wat heb ik werkelijk betaald en ontvangen. Handig om te zien of dynamisch gunstig uitpakt en straks of een batterij zich terugverdient.

## Trigger

Handmatig `make kosten` (of `node scripts/homey/kosten-bijwerken.mjs`). Kan ook in cron als je 't automatisch wil bijhouden.

## Actie

1. Leest je gemeten import/teruglevering uit Homey Insights (cumulatieve `meter_power.consumed` / `.returned`, delta per interval).
2. Haalt de EPEX-uurprijzen van die periode bij EnergyZero en rekent ze om naar all-in FlexPrijs (`markt + ENERGIEBELASTING + FLEX_OPSLAG_KWH`).
3. Rekent per interval kosten (afname × all-in) en opbrengst (teruglevering × `TERUGLEVER_KWH`), aggregeert per dag (Europe/Amsterdam).
4. Mergt in het groeiende logboek `inventaris/export/kosten-historie.csv` — recente dagen worden bijgewerkt, oude blijven bewaard, óók als Homey ze niet meer heeft.
5. Schrijft `dashboard/kosten-overzicht.json`; `kosten.html` toont totalen, staafjes per dag/maand, cumulatieve netto-lijn en een tabel.

## Ontsnapping

Puur uitlezen, stuurt niets aan. Logboek is een gewone CSV die je met de hand kunt corrigeren of leeggooien.

## Randgevallen

- **Homey-retentie** — Insights bewaart uurdata beperkt terug; daarom het persistente logboek. Draai periodiek om gaten te voorkomen.
- **Resolutie** — `last14Days` geeft uurdata (exacte prijskoppeling); `last31Days` geeft 6-uurs blokken (prijs = beginuur van het blok, iets grover).
- **Dubbel draaien op één dag** — geen probleem: de dag wordt herberekend en overschreven, niet opgeteld.
- **Prijs ontbreekt voor een uur** — dat interval telt wel in kWh mee, maar €0 kosten (zeldzaam; EnergyZero dekt normaal de hele dag).

## Testen

`node scripts/homey/kosten-bijwerken.mjs` moet "N dagen bijgewerkt" tonen en een periode-totaal. Open daarna `kosten.html` (via een http-server, bv. `make energie` draait er al één): totalen en grafiek vullen zich. Vergelijk het maandtotaal grofweg met je Vattenfall-overzicht.

## Openstaande vragen

- [ ] Automatisch bijwerken (dagelijkse cron op de Mac) of handmatig houden?
- [ ] Later gas meenemen (meter heeft `meter_gas.daily`)?
