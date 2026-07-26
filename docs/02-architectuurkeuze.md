# 02 — Architectuurkeuze (beslist: optie A)

**Besloten op 26-07: optie A, Homey blijft de baas.** Zie
`docs/adr/0002-hub-keuze.md` voor het besluit en de gevolgen. De rest van dit
document blijft staan als achtergrond bij die afweging.

## De vraag

Waar draait de automatiseringslogica: in Homey, in Home Assistant, of in een
eigen laag ertussen?

## Optie A — Homey blijft de baas

Homey doet alles; TaHoma en Apple TV koppelen via Homey-apps. De repo bevat
HomeyScript, flow-documentatie en API-scripts.

**Voor:** niets te migreren, alles blijft in één app, minst onderhoud.
**Tegen:** flows zijn slecht te versiebeheren en te testen; je bent afhankelijk
van wat community-apps ondersteunen; complexe logica wordt snel onoverzichtelijk.

## Optie B — Home Assistant als brein, Homey als radio

HA wordt de centrale hub. Homey blijft de Zigbee/Z-Wave/433-radio en levert
apparaten aan HA; TaHoma gaat rechtstreeks via Overkiz; Apple TV via de
ingebouwde integratie.

**Voor:** alles in tekstbestanden dus volledig in git, echte testbaarheid,
sterke Overkiz- en Apple TV-integraties, lokaal en zonder cloud.
**Tegen:** je onderhoudt twee systemen; er is een always-on machine nodig;
opzetwerk aan de voorkant.

## Optie C — Eigen orchestrator

Een eigen service die via de API's met alle drie praat.

**Voor:** maximale controle, precies jouw model van het huis.
**Tegen:** je bouwt en onderhoudt zelf wat anderen al af hebben. Alleen zinvol
als A en B écht niet passen.

## Beslisregels

Vul in na de inventarisatie:

- [ ] Hoeveel apparaten hangen aan Homey? (< 15 → Homey volstaat waarschijnlijk)
- [ ] Is de zonwering io of RTS? (RTS zonder terugkoppeling → logica moet
      toestand zelf bijhouden; dat pleit voor B)
- [ ] Wil je zonder internet kunnen draaien? (ja → B, met TaHoma local)
- [ ] Is er always-on hardware, of wil je die kopen? (nee → A)
- [ ] Hoeveel wil je in code doen versus klikken? (veel code → B)

## Voorlopige neiging

Zonder de cijfers is dit een gok, maar: **B** past het best bij "ik wil dit met
code én met Cowork kunnen benaderen", omdat de hele configuratie dan
tekstbestanden zijn die beide kunnen lezen en wijzigen. Homey weggooien is
daarbij niet nodig — die blijft prima als radio.

Beslis pas als de vinkjes hierboven staan.
