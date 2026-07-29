#!/usr/bin/env node
/**
 * Verkenning vóór het automatisch aanmaken van flows.
 *
 * Haalt op en schrijft naar inventaris/export/flow-structuur.json:
 *   1. alle flow-kaarten (triggers/condities/acties) van de relevante apps:
 *      KNMI, Zonnestanden, TaHoma, Logic, datum & tijd
 *   2. één volledige advanced flow als structuurvoorbeeld
 *
 * Alleen lezen; er wordt niets gewijzigd.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UIT = resolve(ROOT, "inventaris/export/flow-structuur.json");

function laadEnv() {
  try {
    for (const regel of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}

// kaarten van deze eigenaren bewaren we (de rest is ruis voor dit doel)
const RELEVANT = ["knmi", "sunevents", "tahoma", "logic", "cron", "date", "flow"];

function relevantOwner(kaart) {
  const owner = `${kaart.ownerUri ?? ""} ${kaart.uri ?? ""} ${kaart.id ?? ""}`.toLowerCase();
  return RELEVANT.some((r) => owner.includes(r));
}

async function haal(basis, key, pad) {
  const res = await fetch(`${basis}${pad}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${pad} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  laadEnv();
  const basis = `http://${process.env.HOMEY_HOST}`;
  const key = process.env.HOMEY_API_KEY;
  if (!process.env.HOMEY_HOST || !key) {
    console.error("HOMEY_HOST / HOMEY_API_KEY ontbreken in .env");
    process.exit(1);
  }

  const uit = { opgehaald_op: new Date().toISOString(), kaarten: {}, voorbeeld_flow: null, fouten: [] };

  for (const [naam, pad] of Object.entries({
    triggers: "/api/manager/flow/flowcardtrigger/",
    condities: "/api/manager/flow/flowcardcondition/",
    acties: "/api/manager/flow/flowcardaction/",
  })) {
    try {
      const alles = await haal(basis, key, pad);
      const lijst = Object.values(alles).filter(relevantOwner);
      uit.kaarten[naam] = lijst;
      console.log(`  ok  ${naam.padEnd(10)} ${lijst.length} relevant van ${Object.keys(alles).length}`);
    } catch (e) {
      uit.fouten.push(String(e.message));
      console.log(`  --  ${naam.padEnd(10)} ${e.message}`);
    }
  }

  // één volledige advanced flow als voorbeeld van de JSON-structuur
  try {
    const advs = await haal(basis, key, "/api/manager/flow/advancedflow/");
    const eerste = Object.values(advs)[0];
    if (eerste) {
      uit.voorbeeld_flow = await haal(basis, key, `/api/manager/flow/advancedflow/${eerste.id}/`);
      console.log(`  ok  voorbeeldflow: "${uit.voorbeeld_flow.name}"`);
    }
  } catch (e) {
    uit.fouten.push(String(e.message));
    console.log(`  --  voorbeeldflow: ${e.message}`);
  }

  // ook de Serre-capabilities (voor de actie-argumenten)
  try {
    const devices = await haal(basis, key, "/api/manager/devices/device/");
    const serre = Object.values(devices).find((d) => d.class === "sunshade");
    if (serre) uit.serre = { id: serre.id, naam: serre.name, capabilities: serre.capabilities };
  } catch (e) {
    uit.fouten.push(String(e.message));
  }

  writeFileSync(UIT, JSON.stringify(uit, null, 1));
  console.log(`\nGeschreven: ${UIT}`);
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
