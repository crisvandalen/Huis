# 01 — Inventarisatie

Doel van deze fase: precies weten wat er in huis hangt, hoe het praat, en wat
je ermee wil. Pas daarna kiezen we een architectuur.

## Stappen

### 1. Homey uitlezen

1. Ga naar de Homey Web App → **Settings → API Keys → New API Key**.
2. Geef leesrechten op devices, zones en flows. Kopieer de key meteen — je
   kunt 'm later niet terugzien.
3. Zet `HOMEY_HOST` (het lokale IP van je Homey) en `HOMEY_API_KEY` in `.env`.
4. `make homey`

### 2. TaHoma uitlezen

Twee wegen. Begin met **cloud** — dat werkt altijd:

- `TAHOMA_MODE=cloud` + je gewone TaHoma-inloggegevens in `.env`.

Wil je later zonder internet werken, probeer dan **local**:

- In de TaHoma-app: developer mode aanzetten, daarna een token genereren.
- `TAHOMA_MODE=local`, `TAHOMA_LOCAL_HOST` (gateway-PIN als hostname of het IP)
  en `TAHOMA_LOCAL_TOKEN` in `.env`.
- Let op: lokaal krijg je géén scenario's en géén climate-apparaten. Somfy
  heeft developer mode bovendien op een deel van de gateways uitgezet.

`make tahoma`

### 3. Apple TV scannen

`make appletv` — noteer de `identifier` in `.env` als `APPLETV_ID`.

Daarna pairen (per protocol, `companion` is de belangrijkste voor
aan/uit en app-status):

```bash
.venv/bin/atvremote --id <identifier> --protocol companion pair
.venv/bin/atvremote wizard    # of laat de wizard alles doen
```

### 4. Overzicht bouwen

```bash
make dashboard && open dashboard/index.html
```

### 5. Handmatig aanvullen

Open `inventaris/apparaten.yaml` en vul in wat geen export kan weten:
waar hangt het, waar dient het voor, en vooral: **per zonwering het protocol
en de oriëntatie.**

## Wat je specifiek wil weten over de zonwering

Dit bepaalt wat er straks mogelijk is, dus doe dit zorgvuldig:

| Vraag | Waarom het uitmaakt |
| --- | --- |
| io-homecontrol of RTS? | RTS is eenrichtingsverkeer: de hub weet de stand niet, alleen wat hij zelf gestuurd heeft |
| Welke gevel / oriëntatie? | Zonsturing draait om zonstand ten opzichte van het raam |
| Screen, rolluik of markies? | Markiezen en uitvalschermen zijn windgevoelig, rolluiken niet |
| Zit er een wind- of zonsensor? | Zonder sensor moet je op weerdata sturen, wat trager en onbetrouwbaarder is |
| Handbediening aanwezig? | Automatisering moet handbediening altijd laten winnen |

## Openstaande vragen

- [ ] Welke Homey heb je precies (Pro 2019 / Pro 2023 / Pro Mini)? Dat bepaalt
      of de lokale API beschikbaar is.
- [ ] Welke TaHoma-gateway (TaHoma switch / Connectivity Kit / oude TaHoma)?
- [x] Draait er al iets always-on in huis (NAS, Pi, mini-pc)? **Ja — linuxcris, een Ubuntu-server op het thuisnetwerk (192.168.2.196). Zie `docs/04-linuxcris.md`.**
- [ ] Wat werkt nu níét goed? Dat is de beste startlijst voor automatiseringen.
