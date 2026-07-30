#!/usr/bin/env node
/**
 * Maakt de nachtslot-check aan (spec: automatiseringen/003-nachtslot.md):
 *
 *   flow "Nachtslot – voordeur check (23:45)"
 *   tijd 23:45 → als Nuki niet op slot → op slot draaien → pushmelding
 *
 * Standaard DRY-RUN. Echt aanmaken:  --echt
 * De flow wordt UIT aangemaakt; aanzetten doe je zelf in de Homey-app.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ECHT = process.argv.includes("--echt");

const TIJD = "23:45";
const FLOWNAAM = "Nachtslot – voordeur check (23:45)";
const MELDING = "Voordeur stond om 23:45 nog open — automatisch op slot gedraaid.";

function laadEnv() {
  try {
    for (const regel of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}

async function api(basis, key, pad, methode = "GET", body = null) {
  const res = await fetch(`${basis}${pad}`, {
    method: methode,
    headers: { Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(20000),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`${methode} ${pad} → HTTP ${res.status}: ${tekst.slice(0, 200)}`);
  try { return JSON.parse(tekst); } catch { return tekst; }
}

/** Aanmaken met verificatie: plat formaat eerst, wrak wordt direct opgeruimd. */
async function apiPostGeverifieerd(basis, key, pad, sleutel, waarde) {
  const kandidaten = [waarde, { [sleutel]: waarde }];
  let laatste;
  for (const body of kandidaten) {
    let resultaat;
    try { resultaat = await api(basis, key, pad, "POST", body); }
    catch (e) { laatste = e; if (!/HTTP 4/.test(e.message)) throw e; continue; }
    const nieuwId = resultaat?.id ?? Object.values(resultaat ?? {})[0]?.id;
    if (!nieuwId) { laatste = new Error("aanmaak gaf geen id terug"); continue; }
    const terug = await api(basis, key, `${pad}${nieuwId}/`);
    if (terug?.name === waarde.name) return terug;
    await api(basis, key, `${pad}${nieuwId}/`, "DELETE").catch(() => {});
    laatste = new Error(`aangemaakt object had naam ${JSON.stringify(terug?.name)} — verwijderd`);
  }
  throw laatste ?? new Error("geen enkel body-formaat geaccepteerd");
}

function vindKaart(kaarten, ownerUri, patronen) {
  for (const p of patronen) {
    const hit = Object.values(kaarten).find(
      (k) => k.ownerUri === ownerUri && (k.id.endsWith(p) || k.id.includes(p)));
    if (hit) return hit;
  }
  return null;
}

async function main() {
  laadEnv();
  const basis = `http://${process.env.HOMEY_HOST}`;
  const key = process.env.HOMEY_API_KEY;
  if (!process.env.HOMEY_HOST || !key) {
    console.error("HOMEY_HOST / HOMEY_API_KEY ontbreken in .env"); process.exit(1);
  }
  console.log(ECHT ? "MODUS: ECHT — er wordt aangemaakt\n" : "MODUS: dry-run — er wordt niets gewijzigd\n");

  const devices = await api(basis, key, "/api/manager/devices/device/");
  const nuki = Object.values(devices).find((d) => d.class === "lock");
  if (!nuki) throw new Error("Geen slot-apparaat gevonden");
  console.log(`Slot: ${nuki.name} (${nuki.id})\n`);
  const nukiUri = `homey:device:${nuki.id}`;

  const [triggers, condities, acties] = await Promise.all([
    api(basis, key, "/api/manager/flow/flowcardtrigger/"),
    api(basis, key, "/api/manager/flow/flowcardcondition/"),
    api(basis, key, "/api/manager/flow/flowcardaction/"),
  ]);

  console.log("Beschikbare slot-kaarten (met argument-definities):");
  for (const [soort, lijst] of [["trigger", triggers], ["conditie", condities], ["actie", acties]])
    for (const k of Object.values(lijst).filter((k) => k.ownerUri === nukiUri)) {
      console.log(`  ${soort.padEnd(8)} ${k.id.replace(nukiUri + ":", "")}  (${k.title})`);
      if (k.args?.length) console.log(`           args: ${JSON.stringify(k.args)}`);
    }
  console.log("\nBeschikbare cron-triggers en meldingskaarten:");
  for (const k of Object.values(triggers).filter((k) => k.ownerUri === "homey:manager:cron"))
    console.log(`  trigger  ${k.id}  (${k.title})  args: ${JSON.stringify(k.args ?? [])}`);
  for (const k of Object.values(acties).filter((k) => (k.ownerUri ?? "").includes("notification")))
    console.log(`  actie    ${k.id}  (${k.title})  args: ${JSON.stringify(k.args ?? [])}`);
  console.log("");

  const kaart = {
    trTijd: vindKaart(triggers, "homey:manager:cron", ["cron:time"]),
    coOpSlot: vindKaart(condities, nukiUri, ["locked", "lock"]),
    acOpSlot: vindKaart(acties, nukiUri, ["lock_true", ":lock", "locked", "lock"]),
    acMelding: Object.values(acties).find((k) => (k.ownerUri ?? "").includes("notification")),
  };
  let mislukt = false;
  for (const [naam, k] of Object.entries(kaart)) {
    console.log(`${k ? "ok " : "!! "} ${naam.padEnd(10)} ${k ? k.id : "NIET GEVONDEN"}`);
    if (!k) mislukt = true;
  }
  if (mislukt) {
    console.error("\nNiet alle kaarten gevonden — niets aangemaakt. Stuur deze output door.");
    process.exit(1);
  }

  // tijd-trigger argumentnaam uit de kaartdefinitie halen (meestal 'time')
  const tijdArg = kaart.trTijd.args?.[0]?.name ?? "time";
  const meldingArg = kaart.acMelding.args?.find((a) => a.type === "text")?.name ?? "text";

  const defs = [
    { ownerUri: "homey:manager:cron", id: kaart.trTijd.id, type: "trigger",
      args: { [tijdArg]: TIJD } },
    { ownerUri: nukiUri, id: kaart.coOpSlot.id, type: "condition", inverted: true },
    { ownerUri: nukiUri, id: kaart.acOpSlot.id, type: "action" },
    { ownerUri: kaart.acMelding.ownerUri, id: kaart.acMelding.id, type: "action",
      args: { [meldingArg]: MELDING } },
  ];
  const ids = defs.map(() => randomUUID());
  const cards = {};
  defs.forEach((def, i) => {
    const volgende = ids[i + 1] ? [ids[i + 1]] : [];
    const c = { ...def, x: 40 + i * 320, y: 120 };
    if (def.type === "condition") c.outputTrue = volgende;
    else c.outputSuccess = volgende;
    cards[ids[i]] = c;
  });
  const flow = { name: FLOWNAAM, enabled: false, cards };

  const bestaande = await api(basis, key, "/api/manager/flow/advancedflow/");
  if (Object.values(bestaande).some((f) => f.name === FLOWNAAM)) {
    console.log(`bestaat al, niets gedaan: "${FLOWNAAM}"`); return;
  }

  console.log(`=== ${FLOWNAAM} (${defs.length} kaarten, uit) ===`);
  for (const c of Object.values(cards))
    console.log(`  ${c.type.padEnd(10)} ${c.id} ${c.args ? JSON.stringify(c.args) : ""}${c.inverted ? "  (omgekeerd: niet op slot)" : ""}`);

  if (ECHT) {
    const terug = await apiPostGeverifieerd(basis, key, "/api/manager/flow/advancedflow/", "advancedflow", flow);
    const n = Object.keys(terug.cards ?? {}).length;
    if (n !== defs.length) {
      await api(basis, key, `/api/manager/flow/advancedflow/${terug.id}/`, "DELETE");
      throw new Error(`aangemaakt met ${n}/${defs.length} kaarten — verwijderd. Stuur deze melding door.`);
    }
    console.log(`  → AANGEMAAKT en geverifieerd (${n} kaarten)`);
    console.log("\nControleer de flow in de Homey-app en zet 'm aan.");
  } else {
    console.log("\nDry-run klaar. Aanmaken: node scripts/homey/maak-nachtslot-flow.mjs --echt");
  }
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
