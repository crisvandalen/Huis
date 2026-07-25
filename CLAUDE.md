# Instructies voor Claude (Code én Cowork)

Dit is het domotica-project van Cris. Nederlands is de voertaal, ook in code-
commentaar en commit messages.

## Rolverdeling

- **Claude Code (terminal)**: scripts schrijven en draaien, exports maken,
  refactoren, git.
- **Cowork (chat)**: documentatie bijwerken, automatiseringen bedenken en
  specificeren, dashboards genereren, samenvatten. Cowork draait in de cloud en
  kan het thuisnetwerk **niet** bereiken — draai netwerkscripts daarom lokaal
  (via `device_bash` op de Mac) of laat Cris ze draaien.

## Vaste regels

1. **Geen geheimen in git.** Tokens horen in `.env`. Zie je een token in een
   bestand dat wél in git zit: meld het en haal het eruit.
2. **Elke automatisering krijgt eerst een spec** in `automatiseringen/`
   (kopieer `TEMPLATE.md`) voordat er code of een flow gebouwd wordt. Zonder
   spec is niet te zien waarom iets doet wat het doet.
3. **Beslissingen leggen we vast als ADR** in `docs/adr/`. Kort: context,
   opties, keuze, gevolgen.
4. **De inventaris is de bron van waarheid.** `inventaris/apparaten.yaml` is
   handgeschreven en leidend; `inventaris/export/` is machine-output en mag
   overschreven worden.
5. **Niets aansturen zonder te vragen.** Uitlezen mag altijd. Een apparaat
   schakelen, een flow wijzigen of een scenario verwijderen: eerst bevestigen.
6. **Fase 1 = inventariseren.** Stel geen hub-migratie voor tot
   `docs/02-architectuurkeuze.md` is ingevuld.

## Commando's

```bash
make setup        # venv + dependencies
make inventaris   # alle exports draaien (Homey, TaHoma, Apple TV)
make homey        # alleen Homey
make tahoma       # alleen TaHoma
make appletv      # alleen Apple TV scannen
make dashboard    # dashboard/index.html genereren uit exports
```

## Context die je moet kennen

- **Homey Pro** praat lokaal via een API-key: `http://<ip>/api/manager/...`
  met `Authorization: Bearer <key>`.
- **TaHoma** kan via de cloud (Overkiz, gebruikersnaam/wachtwoord) of lokaal
  (developer mode + token, poort 8443). Lokaal ondersteunt géén scenario's.
  Somfy heeft developer mode op sommige gateways uitgezet — controleer eerst.
- **Apple TV** via `pyatv`. Pairing is per protocol (companion, airplay, raop)
  en de credentials worden lokaal opgeslagen.
- RTS-zonwering geeft **geen** statusterugkoppeling. Positie is altijd een
  aanname; bouw daar geen automatisering op die exacte stand nodig heeft.
