#!/usr/bin/env node
/**
 * Maakt de zonwering-automatisering aan (spec: automatiseringen/001-zonwering.md):
 *
 *   variabelen : ZW_Handbediend (ja/nee), ZW_FlowStuurt (ja/nee)
 *   flow A     : Zonwering – Serre dicht (ochtend)
 *   flow B     : Zonwering – Serre open (middag)
 *   flow C     : Zonwering – handbediening wint
 *
 * Standaard DRY-RUN: toont wat er aangemaakt zóu worden, wijzigt niets.
 * Echt aanmaken:  node scripts/homey/maak-zonwering-flows.mjs --echt
 * De flows worden UIT aangemaakt; aanzetten doe je zelf in de Homey-app.
 *
 * Vereist een API-key met schrijfrechten op Flow en Logic.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ECHT = process.argv.includes("--echt");

// ---- instellingen (drempels uit de spec; pas gerust aan) -------------------
const ZON_ELEVATIE = 10;      // ° — trigger "sluiten" zodra zon hierboven komt
const ZON_AZIMUT_VRIJ = 157;  // ° — zon draait van de ONO-gevel af (~13:30)
const TEMP_DREMPEL = 22;      // °C buitentemperatuur (KNMI current_temp)
const ZONKANS_DREMPEL = 50;   // %  (KNMI expected_today_sunshine)
const OCHTEND = ["06:00", "13:30"];
const BLOKKADE_UUR = 2;       // handbediening wint dit aantal uren
const FLOWSTUURT_MIN = 5;     // minuten dat ZW_FlowStuurt aanstaat na eigen commando

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
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(20000),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`${methode} ${pad} → HTTP ${res.status}: ${tekst.slice(0, 200)}`);
  try { return JSON.parse(tekst); } catch { return tekst; }
}

/** POST met geverifieerd resultaat. Probeert eerst de platte body (wat de
 *  lokale API blijkt te willen), dan de verpakte variant. Na elke geslaagde
 *  POST wordt gecontroleerd of het aangemaakte object echt de verwachte naam
 *  heeft — zo niet, dan wordt het direct weer verwijderd en de volgende
 *  variant geprobeerd. Zo blijft er nooit een naamloos wrak achter. */
async function apiPostGeverifieerd(basis, key, pad, sleutel, waarde) {
  const kandidaten = [waarde, { [sleutel]: waarde }];
  let laatste;
  for (const body of kandidaten) {
    let resultaat;
    try {
      resultaat = await api(basis, key, pad, "POST", body);
    } catch (e) {
      laatste = e;
      if (!/HTTP 4/.test(e.message)) throw e;
      continue;
    }
    const nieuwId = resultaat?.id ?? Object.values(resultaat ?? {})[0]?.id;
    if (!nieuwId) { laatste = new Error("aanmaak gaf geen id terug"); continue; }
    const terug = await api(basis, key, `${pad}${nieuwId}/`);
    if (terug?.name === waarde.name) return terug;   // geverifieerd goed
    // wrak: opruimen en volgende variant proberen
    await api(basis, key, `${pad}${nieuwId}/`, "DELETE").catch(() => {});
    laatste = new Error(`aangemaakt object had naam ${JSON.stringify(terug?.name)} — verwijderd, formaat verworpen`);
  }
  throw laatste ?? new Error("geen enkel body-formaat geaccepteerd");
}

/** Zoekt in een kaartenlijst de eerste kaart van `ownerUri` waarvan het id op
 *  een van de patronen matcht. */
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

  // --- apparaten en kaarten ophalen ---------------------------------------
  const devices = await api(basis, key, "/api/manager/devices/device/");
  const serre = Object.values(devices).find((d) => d.class === "sunshade");
  const knmi = Object.values(devices).find((d) =>
    ((d.driverId ?? "") + (d.driverUri ?? "")).toLowerCase().includes("knmi"));
  if (!serre) throw new Error("Geen sunshade-apparaat gevonden");
  if (!knmi) throw new Error("Geen KNMI-apparaat gevonden");
  console.log(`Serre: ${serre.name} (${serre.id})`);
  console.log(`KNMI:  ${knmi.name} (${knmi.id})\n`);

  const [triggers, condities, acties] = await Promise.all([
    api(basis, key, "/api/manager/flow/flowcardtrigger/"),
    api(basis, key, "/api/manager/flow/flowcardcondition/"),
    api(basis, key, "/api/manager/flow/flowcardaction/"),
  ]);

  const serreUri = `homey:device:${serre.id}`;
  const knmiUri = `homey:device:${knmi.id}`;
  const sunUri = "homey:app:com.cyclone-software.sunevents";

  // Serre-kaarten tonen zodat controleerbaar is wat er beschikbaar is
  console.log("Beschikbare Serre-kaarten (met argument-definities):");
  for (const [soort, lijst] of [["trigger", triggers], ["conditie", condities], ["actie", acties]])
    for (const k of Object.values(lijst).filter((k) => k.ownerUri === serreUri)) {
      console.log(`  ${soort.padEnd(8)} ${k.id.replace(serreUri + ":", "")}  (${k.title})`);
      if (k.args?.length) console.log(`           args: ${JSON.stringify(k.args)}`);
    }
  console.log("");

  // --- kaarten kiezen ------------------------------------------------------
  const kaart = {
    trZonHoog: vindKaart(triggers, sunUri, ["altitude_greater_than"]),
    trAzimut: vindKaart(triggers, sunUri, ["azimuth_greater_than"]),
    // "positie veranderd" heeft géén verplichte argumenten en vangt alles
    trSerreVeranderd: vindKaart(triggers, serreUri, [
      "windowcoverings_set_changed", "windowcoverings_state_changed", "windowcoverings"]),
    coTijdTussen: Object.values(condities).find((k) => k.id === "homey:manager:cron:time_between"),
    coGroterDan: Object.values(condities).find((k) => k.id === "homey:manager:logic:gt"),
    coBool: Object.values(condities).find((k) => k.id === "homey:manager:logic:equal_boolean"),
    acSerreMy: vindKaart(acties, serreUri, ["quick_open", "my_position", "my"]),
    acSerreOpen: vindKaart(acties, serreUri, ["windowcoverings_up", "up", "windowcoverings_state"]),
    acZetBool: Object.values(acties).find((k) => k.id === "homey:manager:logic:variable_set_boolean"),
  };
  let mislukt = false;
  for (const [naam, k] of Object.entries(kaart)) {
    console.log(`${k ? "ok " : "!! "} ${naam.padEnd(16)} ${k ? k.id : "NIET GEVONDEN"}`);
    if (!k) mislukt = true;
  }
  if (mislukt) {
    console.error("\nNiet alle kaarten gevonden — niets aangemaakt. Stuur deze output door.");
    process.exit(1);
  }

  // --- eerst rommel van eerdere pogingen opruimen ---------------------------
  const alleVars = await api(basis, key, "/api/manager/logic/variable/");
  for (const v of Object.values(alleVars)) {
    if (v.name == null || String(v.name).trim() === "") {
      if (ECHT) {
        await api(basis, key, `/api/manager/logic/variable/${v.id}/`, "DELETE");
        console.log(`naamloze variabele opgeruimd: ${v.id}`);
      } else console.log(`naamloze variabele gevonden (wordt bij --echt opgeruimd): ${v.id}`);
    }
  }

  // --- logic-variabelen ----------------------------------------------------
  const bestaand = await api(basis, key, "/api/manager/logic/variable/");
  const varId = {};
  for (const naam of ["ZW_Handbediend", "ZW_FlowStuurt"]) {
    const hit = Object.values(bestaand).find((v) => v.name === naam);
    if (hit) { varId[naam] = hit.id; console.log(`var bestaat al: ${naam}`); continue; }
    if (ECHT) {
      const nieuw = await apiPostGeverifieerd(basis, key, "/api/manager/logic/variable/",
        "variable", { name: naam, type: "boolean", value: false });
      varId[naam] = nieuw.id;
      console.log(`var aangemaakt en geverifieerd: ${naam} (${varId[naam]})`);
    } else {
      varId[naam] = `<nieuw:${naam}>`;
      console.log(`var zou aangemaakt worden: ${naam}`);
    }
  }
  const tokenVar = (naam) => `homey:manager:logic|${varId[naam]}`;
  const tokenKnmi = (cap) => `${knmiUri}|${cap}`;

  // --- flowbouwers ---------------------------------------------------------
  const uid = () => randomUUID();
  function keten(kaartDefs) {
    // zet kaarten op een rij en verbindt ze 1→2→3…
    const ids = kaartDefs.map(() => uid());
    const cards = {};
    kaartDefs.forEach((def, i) => {
      const volgende = ids[i + 1] ? [ids[i + 1]] : [];
      const c = { ...def, x: 40 + i * 320, y: 120 };
      if (def.type === "condition") c.outputTrue = volgende;
      else c.outputSuccess = volgende;
      cards[ids[i]] = c;
    });
    return cards;
  }

  const flowA = {
    name: "Zonwering – Serre dicht (ochtend)",
    enabled: false,
    cards: keten([
      { ownerUri: sunUri, id: kaart.trZonHoog.id, type: "trigger", args: { altitude: ZON_ELEVATIE } },
      { ownerUri: "homey:manager:cron", id: kaart.coTijdTussen.id, type: "condition",
        args: { time1: OCHTEND[0], time2: OCHTEND[1] } },
      { ownerUri: "homey:manager:logic", id: kaart.coGroterDan.id, type: "condition",
        droptoken: tokenKnmi("current_temp"), args: { comparator: TEMP_DREMPEL } },
      { ownerUri: "homey:manager:logic", id: kaart.coGroterDan.id, type: "condition",
        droptoken: tokenKnmi("expected_today_sunshine"), args: { comparator: ZONKANS_DREMPEL } },
      { ownerUri: "homey:manager:logic", id: kaart.coBool.id, type: "condition",
        droptoken: tokenVar("ZW_Handbediend"), inverted: true },
      { ownerUri: "homey:manager:logic", id: kaart.acZetBool.id, type: "action",
        args: { variable: { id: varId.ZW_FlowStuurt, name: "ZW_FlowStuurt" }, value: true } },
      { ownerUri: serreUri, id: kaart.acSerreMy.id, type: "action" },
      { type: "delay", args: { delay: { number: String(FLOWSTUURT_MIN), multiplier: 60 } } },
      { ownerUri: "homey:manager:logic", id: kaart.acZetBool.id, type: "action",
        args: { variable: { id: varId.ZW_FlowStuurt, name: "ZW_FlowStuurt" }, value: false } },
    ]),
  };

  const flowB = {
    name: "Zonwering – Serre open (middag)",
    enabled: false,
    cards: keten([
      { ownerUri: sunUri, id: kaart.trAzimut.id, type: "trigger", args: { azimuth: ZON_AZIMUT_VRIJ } },
      { ownerUri: "homey:manager:logic", id: kaart.coBool.id, type: "condition",
        droptoken: tokenVar("ZW_Handbediend"), inverted: true },
      { ownerUri: "homey:manager:logic", id: kaart.acZetBool.id, type: "action",
        args: { variable: { id: varId.ZW_FlowStuurt, name: "ZW_FlowStuurt" }, value: true } },
      { ownerUri: serreUri, id: kaart.acSerreOpen.id, type: "action",
        args: { state: "up" } },   // argument heet 'state'; "up" = Omhoog/open
      { type: "delay", args: { delay: { number: String(FLOWSTUURT_MIN), multiplier: 60 } } },
      { ownerUri: "homey:manager:logic", id: kaart.acZetBool.id, type: "action",
        args: { variable: { id: varId.ZW_FlowStuurt, name: "ZW_FlowStuurt" }, value: false } },
    ]),
  };

  const flowC = {
    name: "Zonwering – handbediening wint",
    enabled: false,
    cards: keten([
      { ownerUri: serreUri, id: kaart.trSerreVeranderd.id, type: "trigger" },
      { ownerUri: "homey:manager:logic", id: kaart.coBool.id, type: "condition",
        droptoken: tokenVar("ZW_FlowStuurt"), inverted: true },
      { ownerUri: "homey:manager:logic", id: kaart.acZetBool.id, type: "action",
        args: { variable: { id: varId.ZW_Handbediend, name: "ZW_Handbediend" }, value: true } },
      { type: "delay", args: { delay: { number: String(BLOKKADE_UUR), multiplier: 3600 } } },
      { ownerUri: "homey:manager:logic", id: kaart.acZetBool.id, type: "action",
        args: { variable: { id: varId.ZW_Handbediend, name: "ZW_Handbediend" }, value: false } },
    ]),
  };

  const bestaandeFlows = await api(basis, key, "/api/manager/flow/advancedflow/");
  for (const flow of [flowA, flowB, flowC]) {
    const dubbel = Object.values(bestaandeFlows).find((f) => f.name === flow.name);
    if (dubbel) { console.log(`\nbestaat al, overgeslagen: "${flow.name}"`); continue; }
    console.log(`\n=== ${flow.name} (${Object.keys(flow.cards).length} kaarten, uit) ===`);
    for (const c of Object.values(flow.cards))
      console.log(`  ${(c.type ?? "?").padEnd(10)} ${c.id ?? "vertraging"} ${c.args ? JSON.stringify(c.args) : ""}${c.droptoken ? "  ← " + c.droptoken : ""}${c.inverted ? "  (omgekeerd: nee)" : ""}`);
    if (ECHT) {
      const terug = await apiPostGeverifieerd(basis, key, "/api/manager/flow/advancedflow/", "advancedflow", flow);
      const nKaarten = Object.keys(terug.cards ?? {}).length;
      if (nKaarten !== Object.keys(flow.cards).length) {
        // naam klopt maar kaarten ontbreken: ook dit is een wrak — opruimen
        await api(basis, key, `/api/manager/flow/advancedflow/${terug.id}/`, "DELETE");
        throw new Error(`"${flow.name}": aangemaakt met ${nKaarten}/${Object.keys(flow.cards).length} kaarten — verwijderd. Stuur deze melding door.`);
      }
      console.log(`  → AANGEMAAKT en geverifieerd (${nKaarten} kaarten)`);
    }
  }

  console.log(ECHT
    ? "\nKlaar. Controleer de flows in de Homey-app en zet ze aan als ze er goed uitzien."
    : "\nDry-run klaar. Aanmaken: node scripts/homey/maak-zonwering-flows.mjs --echt");
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
