# 007 — Laadpaal (50five) in het kostenoverzicht

**Status:** gebouwd
**Draait op:** script (`scripts/50five/laadpaal_import.py` + `scripts/homey/kosten-bijwerken.mjs`) + pagina `dashboard/kosten.html`

## Wat moet het doen

Laadsessies van de 50five-laadpaal uitsplitsen in het kostenoverzicht en per sessie de werkelijke (dynamische) kosten tonen naast de vaste vergoeding — inclusief de marge.

## Waarom

De laadpaal is de grootste post in de afname (2 EV's, ~880 kWh in juli). Die zat verstopt in het totale huisverbruik. Bovendien wordt geladen tegen een vaste vergoeding (~€0,375/kWh) terwijl de stroom dynamisch wordt ingekocht — grotendeels 's nachts, goedkoop. Het verschil is echte marge die je wil zien.

## Trigger

Handmatig `make laadpaal` na het neerzetten van een nieuwe 50five-export.

## Actie

1. Exporteer je laadsessies in het 50five-portaal (Excel) en zet het bestand in `inventaris/import/50five/`.
2. `laadpaal_import.py` leest alle `.xlsx` daar, ontdubbelt op sessie-ID, en schrijft `inventaris/export/laadpaal-sessies.csv` (id, start, eind, kWh, kaart, vergoeding).
3. `kosten-bijwerken.mjs` smeert elke sessie evenredig uit over de uren die 'ie beslaat, prijst die tegen de dynamische FlexPrijs (EnergyZero + belasting + opslag), en berekent per sessie de kosten, de vergoeding en de marge. Per dag komt er `laad_kwh` + `laad_kosten` bij.
4. `kosten.html` toont een **Laden kWh**-kolom in de dagtabel en een **Laadsessies & marge**-blok (per sessie: auto, kWh, duur, dynamische kosten, vergoeding, marge).

## Aannames / randgevallen

- **Uitsmeren** — we kennen de totale kWh per sessie en start/eind, niet de exacte laadcurve. De kWh worden gelijkmatig over de uren verdeeld. Bij een sessie die vroeg klaar is maar laat wordt afgekoppeld, is dat een benadering (meestal klein effect; het meeste laden is 's nachts tegen vlakke lage prijs).
- **Auto's** — de twee laadkaarten (`NL-ENE-…` en `NL-TCE-…`) worden gemapt op "Auto 1" / "Auto 2" in `kosten.html` (`CAR_NAMES`). Pas die namen aan naar smaak.
- **Vergoeding** — komt als "Te ontvangen" uit de export (vast ~€0,375/kWh). Verandert 50five het tarief, dan volgt de export vanzelf mee.
- **Marge conservatief** — dynamische kosten worden op de volledige FlexPrijs gerekend, ook voor het deel dat eventueel uit zon kwam; de echte marge is dan iets hoger.
- **Dubbel importeren** — geen probleem, ontdubbeling op sessie-ID.

## Ontsnapping

Puur data; stuurt niets aan. Logboek is een gewone CSV.

## Testen

`make laadpaal` → moet "N sessies in logboek" en daarna een laadpaal-regel met kWh/kosten/vergoeding/marge tonen. Open `kosten.html`: de Laden-kolom en het sessies-blok vullen zich. Vergelijk het maandtotaal kWh met het 50five-portaal.

## Openstaande vragen

- [ ] Namen van de twee auto's invullen in `CAR_NAMES`.
- [ ] Later automatiseren via de (onofficiële) Shell Recharge-API i.p.v. handmatige export?
- [ ] Zon-overschot laden en slim laden op prijs (aparte automatisering, vereist aansturing).
