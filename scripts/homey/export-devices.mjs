#!/usr/bin/env node
/**
 * Leest Homey Pro lokaal uit en schrijft de resultaten naar inventaris/export/.
 *
 * Vereist in .env:
 *   HOMEY_HOST=192.168.1.10        (IP, of homey-<id>.local)
 *   HOMEY_API_KEY=...              (Homey Web App -> Settings -> API Keys)
 *
 * Probeert automatisch meerdere routes: plain http, de https-route via
 * homeylocal.com, en mDNS. Geen dependencies; Node 18+ heeft fetch ingebouwd.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, "../..");
const EXPORT_DIR = resolve(ROOT, "inventaris/export");

function laadEnv() {
  try {
    const inhoud = readFileSync(resolve(ROOT, ".env"), "utf8");
    for (const regel of inhoud.split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const waarde = m[2].replace(/^["']|["']$/g, "").trim();
      if (!(m[1] in process.env)) process.env[m[1]] = waarde;
    }
  } catch {
    // geen .env: dan verwachten we echte omgevingsvariabelen
  }
}

const ENDPOINTS = {
  devices: "/api/manager/devices/device/",
  zones: "/api/manager/zones/zone/",
  flows: "/api/manager/flow/flow/",
  advanced_flows: "/api/manager/flow/advancedflow/",
  apps: "/api/manager/apps/app/",
  logic_variabelen: "/api/manager/logic/variable/",
};

const IS_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Mogelijke routes naar dezelfde Homey, in volgorde van waarschijnlijkheid. */
function basisUrls(host) {
  const urls = [`http://${host}`];
  if (IS_IPV4.test(host)) {
    // Athom's certificaat-truc: 192.168.2.174 -> 192-168-2-174.homey.homeylocal.com
    urls.push(`https://${host.replace(/\./g, "-")}.homey.homeylocal.com`);
  } else if (!host.endsWith(".local")) {
    urls.push(`http://${host}.local`);
  }
  return urls;
}

function oorzaak(err) {
  const code = err?.cause?.code ?? err?.code;
  const uitleg = {
    ECONNREFUSED: "verbinding geweigerd — er luistert niets op die poort",
    EHOSTUNREACH: "host onbereikbaar — ander netwerk of VLAN?",
    ENETUNREACH: "netwerk onbereikbaar",
    ETIMEDOUT: "time-out — geen antwoord",
    ENOTFOUND: "naam niet gevonden — DNS/mDNS lost dit adres niet op",
    ECONNRESET: "verbinding verbroken door de andere kant",
    CERT_HAS_EXPIRED: "certificaat verlopen",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificaat niet te verifiëren",
  };
  return code ? `${code}: ${uitleg[code] ?? "onbekende netwerkfout"}` : err.message;
}

async function haal(basis, key, pad, timeoutMs = 15000) {
  const res = await fetch(`${basis}${pad}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const fout = new Error(`HTTP ${res.status} ${res.statusText}`);
    fout.status = res.status;
    throw fout;
  }
  return res.json();
}

/** Zoekt een route die daadwerkelijk antwoordt. 401 telt ook: dan is Homey
 *  bereikbaar en klopt alleen de key niet. */
async function kiesBasis(host, key) {
  const problemen = [];
  for (const basis of basisUrls(host)) {
    process.stdout.write(`  proberen ${basis} ... `);
    try {
      await haal(basis, key, ENDPOINTS.devices, 8000);
      console.log("werkt");
      return { basis, ok: true };
    } catch (err) {
      if (err.status) {
        console.log(`bereikbaar, maar ${err.message}`);
        return { basis, ok: false, status: err.status };
      }
      console.log(oorzaak(err));
      problemen.push(`${basis} → ${oorzaak(err)}`);
    }
  }
  return { basis: null, problemen };
}

function vatDevicesSamen(devices, zones) {
  const zoneNaam = (id) => (zones && zones[id] ? zones[id].name : null);
  return Object.values(devices ?? {})
    .map((d) => ({
      id: d.id,
      naam: d.name,
      zone: zoneNaam(d.zone),
      klasse: d.class,
      merk: d.driverId ?? d.driverUri ?? null,
      beschikbaar: d.available,
      capabilities: d.capabilities ?? [],
    }))
    .sort((a, b) => `${a.zone}${a.naam}`.localeCompare(`${b.zone}${b.naam}`));
}

function adviesBijGeenVerbinding(host, problemen) {
  console.error("\nGeen enkele route naar Homey werkte:");
  for (const p of problemen) console.error(`  - ${p}`);
  console.error("\nLoop dit na:");
  console.error(`  1. ping -c2 ${host}`);
  console.error("     Geen antwoord? Dan klopt het IP niet, of je Mac zit op een");
  console.error("     ander netwerk (gastnetwerk, andere VLAN, VPN aan).");
  console.error("  2. Het juiste IP vind je in de Homey-app: Instellingen → Algemeen.");
  console.error("     Of probeer: ping -c2 homey.local");
  console.error("  3. Werkt ping wel maar dit script niet? Dan luistert de API niet op");
  console.error("     poort 80. Homey Pro Mini en de Cloud-varianten hebben géén");
  console.error("     lokale API — die moeten via de Web API van Athom.");
}

function adviesBijStatus(status) {
  if (status === 401 || status === 403) {
    console.error("\nHomey antwoordt, maar wijst de key af.");
    console.error("  - Is de key gemaakt in de Web App (my.homey.app) → Settings → API Keys?");
    console.error("  - Heeft hij leesrechten op devices, zones én flows?");
    console.error("  - Staat hij volledig in .env, zonder aanhalingstekens of spaties?");
  } else {
    console.error(`\nHomey antwoordt met HTTP ${status}. Controleer het pad en de key.`);
  }
}

async function main() {
  laadEnv();
  const host = process.env.HOMEY_HOST;
  const key = process.env.HOMEY_API_KEY;

  if (!host || !key) {
    console.error("HOMEY_HOST en/of HOMEY_API_KEY ontbreken. Vul .env in.");
    process.exit(1);
  }

  console.log(`Homey zoeken op '${host}' ...`);
  const gekozen = await kiesBasis(host, key);

  if (!gekozen.basis) {
    adviesBijGeenVerbinding(host, gekozen.problemen);
    process.exit(1);
  }
  if (!gekozen.ok) {
    adviesBijStatus(gekozen.status);
    process.exit(1);
  }

  mkdirSync(EXPORT_DIR, { recursive: true });
  const resultaat = {
    basis: gekozen.basis,
    opgehaald_op: new Date().toISOString(),
    data: {},
  };

  console.log("");
  for (const [naam, pad] of Object.entries(ENDPOINTS)) {
    try {
      resultaat.data[naam] = await haal(gekozen.basis, key, pad);
      const n = Object.keys(resultaat.data[naam] ?? {}).length;
      console.log(`  ok   ${naam.padEnd(18)} ${n} items`);
    } catch (err) {
      resultaat.data[naam] = null;
      console.log(`  --   ${naam.padEnd(18)} ${err.status ? err.message : oorzaak(err)}`);
    }
  }

  writeFileSync(resolve(EXPORT_DIR, "homey-ruw.json"), JSON.stringify(resultaat, null, 2));

  const samenvatting = {
    bron: "homey",
    opgehaald_op: resultaat.opgehaald_op,
    apparaten: vatDevicesSamen(resultaat.data.devices, resultaat.data.zones),
    zones: Object.values(resultaat.data.zones ?? {}).map((z) => ({
      id: z.id,
      naam: z.name,
      ouder: z.parent,
    })),
    flows: Object.values(resultaat.data.flows ?? {}).map((f) => ({
      id: f.id,
      naam: f.name,
      aan: f.enabled,
      map: f.folder ?? null,
    })),
  };
  writeFileSync(resolve(EXPORT_DIR, "homey.json"), JSON.stringify(samenvatting, null, 2));

  console.log(`\n${samenvatting.apparaten.length} apparaten, ${samenvatting.flows.length} flows`);
  console.log(`Geschreven: ${resolve(EXPORT_DIR, "homey.json")}`);
}

main().catch((err) => {
  console.error("Mislukt:", oorzaak(err));
  process.exit(1);
});
