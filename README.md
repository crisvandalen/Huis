# Huis — domotica-project

Eén plek voor alles rond de huisautomatisering: inventarisatie, koppelingen,
automatiseringen en documentatie. Te benaderen via **Claude Code** (terminal) én
via **Cowork** (chat op desktop/telefoon).

## Wat staat hier

| Map | Inhoud |
| --- | --- |
| `docs/` | Documentatie: inventarisatie, koppelingen, architectuurkeuze, ADR's |
| `inventaris/` | De feitelijke huisdata: kamers, apparaten, machine-exports |
| `scripts/` | Werkende scripts om Homey, TaHoma en Apple TV uit te lezen |
| `automatiseringen/` | Specs per automatisering (wat moet het doen, en waarom) |
| `dashboard/` | Gegenereerd overzichtsscherm |

## Hardware nu in huis

- **Athom Homey Pro** — hub voor Zigbee / Z-Wave / 433 / Matter
- **Somfy TaHoma** — zonwering en rolluiken (io-homecontrol / RTS)
- **Apple TV** — media, en bruikbaar als aanwezigheids-/activiteitssensor

## Fase 1: inventariseren (waar we nu staan)

De architectuurkeuze (blijft Homey de baas, of komt Home Assistant erbij?) is
bewust **nog niet** gemaakt. Eerst weten we precies wat er in huis hangt.

```bash
cp .env.example .env      # vul je tokens in
make setup                # python venv + dependencies
make inventaris           # leest Homey, TaHoma en Apple TV uit
make dashboard            # bouwt dashboard/index.html uit de exports
```

Daarna: `docs/01-inventarisatie.md` aanvullen met wat een machine niet kan weten
(waar hangt het, wat wil je ermee), en vervolgens `docs/02-architectuurkeuze.md`
invullen.

## Werken met Claude

Lees `CLAUDE.md` — dat is de instructie die zowel Claude Code als Cowork oppikt.

## Veiligheid

Tokens staan **alleen** in `.env` (git-ignored). Exports in
`inventaris/export/` kunnen device-ID's en je gateway-PIN bevatten; die map is
daarom ook git-ignored. Wat je wél wil bewaren zet je in
`inventaris/apparaten.yaml`, met de gevoelige velden eruit.
