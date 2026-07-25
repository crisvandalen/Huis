#!/usr/bin/env node
/**
 * Leest Homey Pro lokaal uit en schrijft de resultaten naar inventaris/export/.
 *
 * Vereist in .env:
 *   HOMEY_HOST=192.168.1.10
 *   HOMEY_API_KEY=...   (Homey Web App -> Settings -> API Keys)
 *
 * Geen dependencies; Node 18+ heeft fetch ingebouwd.
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
      const waarde = m[2].replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = waarde;
    }
  } catch {
    // geen .env: dan verwachten we echte omgevingsvariabelen
  }
}

// Endpoints die we proberen. Niet elke Homey/firmware heeft ze allemaal.
const ENDPOINTS = {
  devices: "/api/manager/devices/device/",
  zones: "/api/manager/zones/zone/",
  flows: "/api/manager/flow/flow/",
  advanced_flows: "/api/manager/flow/advancedflow/",
  apps: "/api/manager/apps/app/",
  logic_variabelen: "/api/manager/logic/variable/",
};

async function haal(host, key, pad) {
  const url = `http://${host}${pad}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Compacte samenvatting: naam, zone, class, capabilities. */
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

async function main() {
  laadEnv();
  const host = process.env.HOMEY_HOST;
  const key = process.env.HOMEY_API_KEY;

  if (!host || !key) {
    console.error("HOMEY_HOST en/of HOMEY_API_KEY ontbreken. Vul .env in.");
    process.exit(1);
  }

  mkdirSync(EXPORT_DIR, { recursive: true });

  const resultaat = { host, opgehaald_op: new Date().toISOString(), data: {} };

  for (const [naam, pad] of Object.entries(ENDPOINTS)) {
    try {
      resultaat.data[naam] = await haal(host, key, pad);
      const n = Object.keys(resultaat.data[naam] ?? {}).length;
      console.log(`  ok   ${naam.padEnd(18)} ${n} items`);
    } catch (err) {
      resultaat.data[naam] = null;
      console.log(`  --   ${naam.padEnd(18)} ${err.message}`);
    }
  }

  const ruwPad = resolve(EXPORT_DIR, "homey-ruw.json");
  writeFileSync(ruwPad, JSON.stringify(resultaat, null, 2));

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
  const samenvattingPad = resolve(EXPORT_DIR, "homey.json");
  writeFileSync(samenvattingPad, JSON.stringify(samenvatting, null, 2));

  console.log(`\n${samenvatting.apparaten.length} apparaten, ${samenvatting.flows.length} flows`);
  console.log(`Geschreven: ${samenvattingPad}`);
  console.log(`Ruwe data:  ${ruwPad}`);
}

main().catch((err) => {
  console.error("Mislukt:", err.message);
  console.error("Check: staat de Mac op hetzelfde netwerk als Homey? Klopt het IP?");
  process.exit(1);
});
