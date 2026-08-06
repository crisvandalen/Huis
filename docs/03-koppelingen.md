# 03 — Koppelingen: hoe praat je met wat

Naslag. Alle tokens horen in `.env`, nooit in een bestand dat in git staat.

## Homey Pro

**Lokale API**, met een API-key uit de Homey Web App (Settings → API Keys).

```bash
curl -H "Authorization: Bearer $HOMEY_API_KEY" \
  http://192.168.1.10/api/manager/devices/device/
```

Handige paden:

| Pad | Wat |
| --- | --- |
| `/api/manager/devices/device/` | alle apparaten met capabilities |
| `/api/manager/zones/zone/` | kamers/zones |
| `/api/manager/flow/flow/` | flows |
| `/api/manager/flow/advancedflow/` | advanced flows |
| `/api/manager/logic/variable/` | logic-variabelen |

Een capability zetten gaat via `PUT` op
`/api/manager/devices/device/<id>/capability/<capability>` met `{"value": ...}`.
**Doe dat pas na bevestiging** — je schakelt echt iets in huis.

Voor HTTPS bestaat de vorm `https://192-168-1-10.homey.homeylocal.com`.
Scripting binnen Homey zelf kan met HomeyScript (JavaScript).

## Somfy TaHoma (Overkiz)

Twee wegen:

**Cloud** — gebruikersnaam/wachtwoord, server `SOMFY_EUROPE`. Ondersteunt alles
inclusief scenario's, maar kent rate limits tijdens piekuren.

**Lokaal** — developer mode aanzetten in de TaHoma-app, dan een token
genereren. Endpoint: `https://<gateway>:8443/enduser-mobile-web/1/enduserAPI/`.
Sneller en werkt zonder internet, maar **geen scenario's en geen climate**.
Somfy heeft developer mode op een deel van de gateways (o.a. de Connectivity
Kit) uitgeschakeld — werkt het niet, gebruik dan cloud.

Python: `pyoverkiz`. Zie `scripts/tahoma/export_setup.py`.

**Belangrijk:** RTS-apparaten geven geen status terug. De hub weet alleen wat
hij zelf gestuurd heeft. io-homecontrol geeft wél terugkoppeling.

## Apple TV

Python: `pyatv`. Scannen met `atvremote scan`, daarna per protocol pairen:

```bash
atvremote --id <identifier> --protocol companion pair
atvremote --id <identifier> --protocol airplay pair
atvremote wizard          # interactief, doet alles
```

Protocollen die pairing nodig hebben: **companion**, **airplay**, **raop**.
Credentials worden vanaf 0.14.0 automatisch lokaal opgeslagen.

Bruikbaar:

```bash
atvremote --id <identifier> playing        # wat speelt er
atvremote --id <identifier> power_state    # aan/uit
atvremote --id <identifier> push_updates   # blijft luisteren naar wijzigingen
```

`push_updates` is de sleutel voor media-automatisering: je krijgt een event
zodra er iets start, pauzeert of stopt, zonder te pollen.

## Wat waar vandaan komt

| Signaal | Beste bron |
| --- | --- |
| Aanwezigheid | Homey (telefoons) |
| Zonstand en weer | berekening op locatie + weerdienst |
| Kijkt er iemand tv | Apple TV via pyatv push updates |
| Rolluik-/screenstand | TaHoma, maar alleen betrouwbaar bij io |
| Licht, sensoren, schakelaars | Homey |

## Homey via de cloud (fallback)

> **Sinds aug 2026 niet meer nodig voor het dashboard.** De vaste draai-omgeving
> is nu linuxcris, op het LAN, dus de lokale API-key werkt weer (`make homey`).
> Deze cloud-route blijft bewaard als fallback voor een eventuele off-LAN
> situatie; zie `docs/04-linuxcris.md`.

Getest 26-07: de lokale API-key wordt door de Athom-cloud geweigerd (HTTP 401)
en `<homey-id>.homey.eu-west-1.homeypro.net` lost niet op. Remote werkt dus
NIET met de lokale key, wel via de officiele OAuth2-flow:

1. API Client aanmaken op https://tools.developer.homey.app (redirect: `http://localhost`).
2. `HOMEY_CLIENT_ID` en `HOMEY_CLIENT_SECRET` in `.env`.
3. Eenmalig: `make cloud-auth` -> URL openen, inloggen, code kopieren,
   `node scripts/homey/cloud-auth.mjs <code>`.
4. Daarna altijd: `make cloud-test`, of in code `maakHomeyApi()` uit
   `scripts/homey/cloud-client.mjs`. Refresh-token staat in
   `scripts/homey/.homey-cloud-token.json` (gitignored). Volledige uitleg: `docs/archief/04-cloud-oauth2.md`.
