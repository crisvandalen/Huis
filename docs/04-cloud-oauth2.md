# Homey via de cloud (OAuth2) — voor de VPS

Status 26-07: **getest en werkend** — 29 apparaten, 14 zones via de cloud.

De lokale API-key (`HOMEY_API_KEY`) werkt alleen op het LAN; tegen de Athom-cloud
geeft hij HTTP 401. Remote besturing loopt daarom via OAuth2 met een eigen API
Client. Eenmalig instellen, daarna werkt het vanaf elke machine — dus ook de VPS.

## Eenmalige setup (al gedaan op de MacBook)

1. https://tools.developer.homey.app → **API Clients** → nieuwe client.
   - Callback URL: `http://localhost:8899/callback`
   - Scopes: zone/device/flow/logic/insights/energy (readonly) + device.control + flow.start
2. In `.env`: `HOMEY_CLOUD_CLIENT_ID`, `HOMEY_CLOUD_CLIENT_SECRET`,
   `HOMEY_CLOUD_REDIRECT_URI=http://localhost:8899/callback`.
3. `node scripts/homey/cloud-auth.mjs` — opent de browser, vangt de code zelf op
   en wisselt hem direct in (codes verlopen binnen seconden, dus niet handmatig
   kopieren). Token landt in `scripts/homey/.homey-cloud-token.json` (gitignored).
4. `node scripts/homey/cloud-test.mjs` — moet het aantal apparaten tonen.

## Gebruik in eigen code

```js
import { maakHomeyApi } from './scripts/homey/cloud-client.mjs';
const { homey, api } = await maakHomeyApi();
const devices = await api.devices.getDevices();
```

## Verhuizing naar de VPS

1. Repo clonen op de VPS, `npm install`.
2. `.env` en `scripts/homey/.homey-cloud-token.json` veilig meenemen (scp).
3. `node scripts/homey/cloud-test.mjs` als check.

Het refresh-token ververst zichzelf bij elk gebruik. Let op: het token-bestand en
`.env` zijn geheimen — nooit in git (staan in `.gitignore`).

## Bekende beperkingen

- `pyatv` (Apple TV) is LAN-only en draait dus niet op de VPS; Apple TV-status
  loopt via de Homey-app.
- De echte remoteUrl heeft de vorm
  `https://<homey-id>.homey.athom-prod-euwest1-001.homeypro.net`;
  niet zelf samenstellen, de library haalt hem op.
