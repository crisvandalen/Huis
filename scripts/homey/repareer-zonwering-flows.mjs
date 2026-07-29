#!/usr/bin/env node
/**
 * Herstel: dumpt en verwijdert de drie "Zonwering – …"-flows die de
 * flow-editor laten crashen.
 *
 * 1. haalt de volledige JSON van de drie flows op en bewaart die in
 *    inventaris/export/zonwering-flows-dump.json (voor diagnose)
 * 2. verwijdert de drie flows
 *
 * De logic-variabelen (ZW_*) blijven staan — die zijn onschuldig en worden
 * hergebruikt bij de volgende poging.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DUMP = resolve(ROOT, "inventaris/export/zonwering-flows-dump.json");
const NAMEN = [
  "Zonwering – Serre dicht (ochtend)",
  "Zonwering – Serre open (middag)",
  "Zonwering – handbediening wint",
];

function laadEnv() {
  try {
    for (const regel of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}

async function api(basis, key, pad, methode = "GET") {
  const res = await fetch(`${basis}${pad}`, {
    method: methode,
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`${methode} ${pad} → HTTP ${res.status}: ${tekst.slice(0, 200)}`);
  try { return JSON.parse(tekst); } catch { return tekst; }
}

async function main() {
  laadEnv();
  const basis = `http://${process.env.HOMEY_HOST}`;
  const key = process.env.HOMEY_API_KEY;

  const alles = await api(basis, key, "/api/manager/flow/advancedflow/");
  console.log("Alle advanced flows op dit moment:");
  for (const f of Object.values(alles))
    console.log(`  ${f.id}  naam=${JSON.stringify(f.name)}  aan=${f.enabled}`);

  // onze drie op naam, plus alles zonder geldige naam (de editor-crasher)
  const onze = Object.values(alles).filter(
    (f) => NAMEN.includes(f.name) || f.name == null || String(f.name).trim() === "");
  if (!onze.length) {
    console.log("\nNiets verdachts gevonden. Stuur de lijst hierboven door.");
    return;
  }
  console.log(`\nTe verwijderen: ${onze.length} flow(s)`);

  const dump = [];
  for (const f of onze) {
    try {
      dump.push(await api(basis, key, `/api/manager/flow/advancedflow/${f.id}/`));
    } catch (e) {
      dump.push({ id: f.id, name: f.name, dump_fout: e.message });
    }
  }
  writeFileSync(DUMP, JSON.stringify(dump, null, 1));
  console.log(`Dump geschreven: ${DUMP}`);

  for (const f of onze) {
    await api(basis, key, `/api/manager/flow/advancedflow/${f.id}/`, "DELETE");
    console.log(`verwijderd: ${f.id} (naam=${JSON.stringify(f.name)})`);
  }
  console.log("\nKlaar — herlaad my.homey.app; de flow-pagina hoort weer te werken.");
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
