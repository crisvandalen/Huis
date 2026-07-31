#!/usr/bin/env node
/**
 * Leest een Tuya-airco (Qventi, USB-Tuya wifi-module) uit via de Tuya
 * OpenAPI (cloud) en schrijft inventaris/export/airco.json voor het dashboard.
 *
 * Vereist in .env:
 *   TUYA_ACCESS_ID=...        (Access ID / Client ID van je Tuya IoT-project)
 *   TUYA_ACCESS_SECRET=...    (Access Secret / Client Secret)
 *   TUYA_DEVICE_ID=...        (device-id van de airco; staat in het project bij
 *                              het gekoppelde Smart Life-apparaat)
 *   TUYA_REGION=eu            (eu | us | in | cn — vrijwel zeker eu)
 *
 * Draait óók op de VPS: dit is de cloud, geen thuisnetwerk nodig.
 *
 * Werkt in twee stappen, net als router-teltonika.mjs:
 *   1. Ruwe status altijd naar airco-ruw.json (zodat de DP-mapping bij te
 *      stellen is op wat het apparaat écht teruggeeft).
 *   2. Nette mapping naar airco.json. De DP-codes verschillen per model; de
 *      mapping hieronder dekt de gangbare airco-codes en is tolerant: wat niet
 *      gevonden wordt, blijft null i.p.v. een fout.
 *
 * Alleen uitlezen. Bedienen (aan/uit + temp) komt via POST /airco op de
 * ververs-backend — zie automatiseringen/004-airco.md.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXPORT_DIR = resolve(ROOT, "inventaris/export");

const HOSTS = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  in: "https://openapi.tuyain.com",
  cn: "https://openapi.tuyacn.com",
};

// Bekende DP-codes voor airco's (Tuya). Eerste die voorkomt wint.
const CODES = {
  aan: ["switch", "Power", "switch_1", "PowerSwitch"],
  doeltemp: ["temp_set", "TempSet", "settemp", "cold_temp_set"],
  huidige_temp: ["temp_current", "TempCurrent", "va_temperature", "upper_temp"],
  stand: ["mode", "Mode", "work_mode"],          // koelen/verwarmen/... (alleen tonen)
  ventilator: ["windspeed", "fan_speed_enum", "WindSpeed", "fan_speed"],
};

function laadEnv() {
  try {
    for (const regel of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const LEEG_BODY_HASH = sha256(""); // e3b0c442...

/**
 * Tuya-handtekening (v2). Voor de token-call is er nog geen access_token;
 * voor gewone calls wél. stringToSign = METHOD\nSHA256(body)\n\nURLpad.
 */
function teken({ clientId, secret, t, accessToken = "", method, pad }) {
  const stringToSign = `${method}\n${LEEG_BODY_HASH}\n\n${pad}`;
  const str = clientId + accessToken + t + stringToSign;
  return createHmac("sha256", secret).update(str, "utf8").digest("hex").toUpperCase();
}

async function tuyaGet(basis, pad, { clientId, secret, accessToken = "" }) {
  const t = Date.now().toString();
  const sign = teken({ clientId, secret, t, accessToken, method: "GET", pad });
  const headers = {
    client_id: clientId,
    sign,
    t,
    sign_method: "HMAC-SHA256",
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  const res = await fetch(`${basis}${pad}`, { headers, signal: AbortSignal.timeout(10000) });
  const json = await res.json().catch(() => ({}));
  return json;
}

function pak(statusList, kandidaten) {
  for (const code of kandidaten) {
    const hit = statusList.find((s) => s.code === code);
    if (hit) return hit.value;
  }
  return null;
}

async function main() {
  laadEnv();
  const clientId = process.env.TUYA_ACCESS_ID;
  const secret = process.env.TUYA_ACCESS_SECRET;
  const deviceId = process.env.TUYA_DEVICE_ID;
  const region = (process.env.TUYA_REGION || "eu").toLowerCase();
  const basis = HOSTS[region];

  if (!clientId || !secret || !deviceId) {
    console.error("TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_DEVICE_ID ontbreken in .env");
    process.exit(1);
  }
  if (!basis) {
    console.error(`Onbekende TUYA_REGION "${region}" (kies: ${Object.keys(HOSTS).join(", ")})`);
    process.exit(1);
  }

  // 1. Token halen.
  const tok = await tuyaGet(basis, "/v1.0/token?grant_type=1", { clientId, secret });
  const accessToken = tok?.result?.access_token;
  if (!accessToken) {
    console.error("Inloggen bij Tuya mislukt:", JSON.stringify(tok));
    console.error("Check: kloppen Access ID/Secret, is de regio goed (eu/us/in/cn), en");
    console.error("is het apparaat aan het Cloud-project gekoppeld (Smart Life gelinkt)?");
    process.exit(1);
  }

  // 2. Status ophalen.
  const st = await tuyaGet(basis, `/v1.0/iot-03/devices/${deviceId}/status`, {
    clientId, secret, accessToken,
  });
  if (!st?.success) {
    console.error("Status ophalen mislukt:", JSON.stringify(st));
    process.exit(1);
  }
  const statusList = Array.isArray(st.result) ? st.result : [];

  mkdirSync(EXPORT_DIR, { recursive: true });
  writeFileSync(resolve(EXPORT_DIR, "airco-ruw.json"),
    JSON.stringify({ opgehaald_op: new Date().toISOString(), status: statusList }, null, 1));

  // 3. Mapping (tolerant; stel bij op airco-ruw.json).
  const airco = {
    opgehaald_op: new Date().toISOString(),
    online: true,               // status ophalen lukte
    aan: pak(statusList, CODES.aan),
    doeltemp: pak(statusList, CODES.doeltemp),
    huidige_temp: pak(statusList, CODES.huidige_temp),
    stand: pak(statusList, CODES.stand),
    ventilator: pak(statusList, CODES.ventilator),
    // LET OP: Tuya geeft temperaturen soms ×10 (bijv. 210 = 21,0 °C). Vergelijk
    // doeltemp/huidige_temp met de Smart Life-app en zet zo nodig een deler.
  };
  writeFileSync(resolve(EXPORT_DIR, "airco.json"), JSON.stringify(airco, null, 1));

  console.log("Ruwe DP-codes van de airco:");
  for (const s of statusList) console.log(`  ${s.code} = ${JSON.stringify(s.value)}`);
  console.log("\nMapping (airco.json):");
  for (const [k, v] of Object.entries(airco)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log(`\nGeschreven: ${resolve(EXPORT_DIR, "airco.json")} (+ airco-ruw.json)`);
  console.log("Staat er null waar je een waarde verwacht, of lijkt temp ×10? Stuur de ruwe codes door.");
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
