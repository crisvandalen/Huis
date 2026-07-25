# ADR 0002 — Waar draait de automatiseringslogica

**Status:** voorstel (bewust nog niet beslist)
**Datum:** 2026-07-25

## Context

Er is een Homey Pro, een Somfy TaHoma en een Apple TV. De wens is om de
huisautomatisering zowel met code (Claude Code) als vanuit chat (Cowork) te
kunnen beheren. Dat vraagt om configuratie die als tekst in git leeft.

Voordat er iets gemigreerd wordt, moet duidelijk zijn hoeveel apparaten er
hangen, welk protocol de zonwering gebruikt, en of er always-on hardware is.
Zie `docs/01-inventarisatie.md`.

## Opties

Uitgewerkt in `docs/02-architectuurkeuze.md`: (A) Homey blijft de baas,
(B) Home Assistant als brein met Homey als radio, (C) eigen orchestrator.

## Besluit

*Nog niet genomen. Invullen zodra de inventarisatie rond is.*

## Gevolgen

*Invullen bij het besluit.*
