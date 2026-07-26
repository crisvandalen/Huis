# ADR 0002 — Waar draait de automatiseringslogica

**Status:** geaccepteerd
**Datum:** 2026-07-26

## Context

Er is een Homey Pro, een Somfy TaHoma en een Apple TV. De wens is om de
huisautomatisering zowel met code (Claude Code) als vanuit chat (Cowork) te
kunnen beheren.

De inventarisatie (25/26-07) wees uit:

- 30 apparaten, allemaal al aan Homey gekoppeld — Hue, Tado, Nuki, Ring,
  HomeWizard P1, Duux, sensoren.
- **De TaHoma-app zit al in Homey.** Het enige Somfy-apparaat (serre-scherm)
  is io-homecontrol, mét statusterugkoppeling. Op TaHoma zelf hangen geen
  andere apparaten.
- **De Apple TV-app zit al in Homey** (Apple TV & HomePod).
- De app **Zonnestanden** draait al: zonstand-triggers zijn beschikbaar.
- Er is geen always-on machine, en geen wens om er een te kopen.

## Opties

Zie `docs/02-architectuurkeuze.md`: (A) Homey blijft de baas, (B) Home
Assistant als brein met Homey als radio, (C) eigen orchestrator.

## Besluit

**Optie A: Homey blijft de baas.** Alle integraties die B of C zouden moeten
leveren, bestaan al in Homey. Migreren zou werk en hardware kosten zonder
nieuwe mogelijkheden op te leveren.

De rol van deze repo daarbij:

1. **Documentatie en specs zijn leidend.** Elke flow van betekenis heeft een
   spec in `automatiseringen/`; de flow in Homey is de uitvoering daarvan.
2. **De repo leest, Homey stuurt.** Scripts halen status en configuratie op
   via de lokale API (exports, dashboard). Schrijven/schakelen via de API doen
   we alleen bewust en na bevestiging.
3. **Flows exporteren we periodiek** (`make homey`) zodat wijzigingen in git
   zichtbaar zijn — het versiebeheer dat Homey zelf mist.

## Gevolgen

- Geen migratie, geen nieuwe hardware; direct door naar de automatiseringen.
- Complexe logica blijft beperkt tot wat advanced flows aankunnen. Blijkt dat
  te knellen, dan is HomeyScript de eerste uitwijk; pas daarna herzien we dit
  besluit (nieuwe ADR).
- De media-automatisering hangt af van de events die de Apple TV-app in Homey
  levert; `pyatv` blijft achter de hand als de app te weinig geeft.
- Automatiseringslogica in flows is minder goed testbaar dan code; de specs
  met randgevallen in `automatiseringen/` zijn daarvoor de compensatie.
