# ADR 0004 — Always-on machine: linuxcris

**Status:** geaccepteerd
**Datum:** 2026-08-06

## Context

ADR 0002 (hub-keuze) ging uit van de aanname *"er is geen always-on machine, en
geen wens om er een te kopen"*. Die aanname klopt niet meer: sinds augustus 2026
draait **linuxcris**, een Ubuntu-server op de oude Windows-pc, 24/7 op het
thuisnetwerk (vast IP `192.168.2.196`, Tailscale `100.117.180.2`).

Tegelijk is de Hetzner-VPS ("het brein", `46.62.194.166`) opgezegd (5 aug 2026)
en is alles wat daarop draaide — het huis-dashboard en de periodieke
Homey-export — naar linuxcris verhuisd. Zie `docs/04-linuxcris.md` voor de
inrichting.

## Opties

1. **linuxcris als always-on host voor huis (GEKOZEN)** — dashboard + periodieke
   export draaien op linuxcris; scripts praten via de lokale Homey-API.
2. **Bij de VPS blijven** — vervalt, de VPS is opgezegd.
3. **Alleen op de Mac** — de Mac slaapt, dus geen 24/7 verse momentopname.

## Besluit

**Optie 1.** linuxcris is de always-on host voor dit project. Omdat hij op het
LAN zit, gebruikt de export weer de **lokale** Homey-API (`make homey`) in plaats
van de cloud-OAuth-route die de VPS nodig had.

**Belangrijk:** dit besluit gaat alleen over *waar* de always-on taken draaien.
Het heropent **niet** de hub-keuze uit ADR 0002 (Homey blijft de baas). Dat
linuxcris nu bestaat maakt optie B (Home Assistant als brein) technisch
haalbaarder, maar of we die kant op willen is een aparte afweging — pas oppakken
als `docs/02-architectuurkeuze.md` daarvoor opnieuw wordt ingevuld (fase-1-regel
uit CLAUDE.md).

## Gevolgen

- De cloud-export (`export-cloud.mjs`, `automatiseringen/003`) is niet meer nodig
  voor het dashboard; hij blijft als fallback bestaan voor een eventuele off-LAN
  situatie.
- Geen externe Caddy/basic-auth-laag meer: linuxcris serveert het dashboard op
  `:8765` achter LAN + Tailscale, geen poorten naar internet.
- Nieuw single point of failure: valt linuxcris of het huis-internet weg, dan
  staat het 24/7-deel stil. De data leeft nog in Homey en in back-ups op `/data`.
- ADR 0002 en 0003 zijn geannoteerd: hun VPS- en always-on-aannames verwijzen nu
  hiernaartoe.
