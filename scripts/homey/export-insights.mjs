#!/usr/bin/env node
/**
 * Exporteert je gemeten net-uitwisseling uit Homey Insights (slimme meter) naar
 * CSV voor de batterijsimulator:
 *
 *   inventaris/export/energie-uur.csv   met kolommen: tijd,import_kwh,export_kwh
 *
 *   import_kwh  = van het net afgenomen dat uur (meter_power.consumed, delta)
 *   export_kwh  = aan het net teruggeleverd dat uur (meter_power.returned, delta)
 *
 * Dit is precies het signaal waar een thuisbatterij op werkt: in export-uren
 * laadt hij, in import-uren ontlaadt hij. (De Enphase-zonproductie wordt niet in
 * Insights gelogd, dus bruto zon/verbruik is niet beschikbaar — de net-data wel.)
 *
 * meter_power.* zijn cumulatieve kWh-tellers; het uurverbruik is het verschil
 * tussen twee opeenvolgende standen.
 *
 * Gebruik:
 *   node scripts/homey/export-insights.mjs [resolutie]
 *   resolutie = last7Days | last14Days (default, uurdata) | last31Days (6-uurs) | last3Months
 *
 * Tip: Homey bewaart uurdata maar beperkt terug. Draai dit periodiek en voeg de
 * CSV's samen om meer seizoenen te dekken. Wil je ook zonproductie meenemen? Zet
 * dan in Homey bij de Enphase-omvormer de Insights-logging aan voor 'meter_power'.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakHomeyApi } from './cloud-client.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const EXPORT = resolve(HIER, '../../inventaris/export');
const RES = process.argv[2] || 'last14Days';

// Exacte logs van de slimme meter (device 11df88ce). We matchen op de sommen,
// met terugval op een generieke zoektocht mocht het device-ID ooit wijzigen.
const METER = '11df88ce';
function kies(logs, suffix, driver) {
  return logs.find(l => l.id.includes(driver) && l.id.endsWith(':' + suffix))
      || logs.find(l => l.id.endsWith(':' + suffix));
}

async function haalEntries(api, log) {
  const args = { uri: log.uri, id: log.id, resolution: RES };
  try { return await api.insights.getLogEntries(args); }
  catch { try { return await api.insights.getLogEntries(log, { resolution: RES }); }
    catch (e) { console.error('  entries mislukt voor', log.id, '-', e.message); return null; } }
}
function naarUurStanden(entries) {
  const arr = (entries && (entries.values || entries)) || [];
  const perUur = new Map();
  for (const e of arr) {
    const t = new Date(e.t || e.date || e[0]);
    const v = Number(e.v ?? e.value ?? e[1]);
    if (isNaN(t) || isNaN(v)) continue;
    const u = new Date(t); u.setMinutes(0, 0, 0);
    perUur.set(u.getTime(), v);
  }
  return perUur;
}
function deltas(perUur) {
  const t = [...perUur.keys()].sort((a, b) => a - b);
  const out = new Map();
  let stapMin = Infinity;
  for (let i = 1; i < t.length; i++) {
    const d = perUur.get(t[i]) - perUur.get(t[i - 1]);
    out.set(t[i], d >= 0 && d < 200 ? d : 0);
    stapMin = Math.min(stapMin, (t[i] - t[i - 1]) / 60000);
  }
  return { out, stapMin };
}

(async () => {
  const { api } = await maakHomeyApi();
  const logsObj = await api.insights.getLogs();
  const logs = Array.isArray(logsObj) ? logsObj : Object.values(logsObj);

  const impLog = kies(logs, 'meter_power.consumed', METER);
  const expLog = kies(logs, 'meter_power.returned', METER);
  console.log('resolutie:', RES);
  console.log('  import      :', impLog ? impLog.id : 'NIET GEVONDEN');
  console.log('  teruglevering:', expLog ? expLog.id : 'NIET GEVONDEN');
  if (!impLog || !expLog) { console.error('Meterlogs niet gevonden.'); process.exit(1); }

  const imp = deltas(naarUurStanden(await haalEntries(api, impLog)));
  const exp = deltas(naarUurStanden(await haalEntries(api, expLog)));
  console.log('  tijdstap    : ~' + Math.round(Math.min(imp.stapMin, exp.stapMin)) + ' min');

  const alle = [...new Set([...imp.out.keys(), ...exp.out.keys()])].sort((a, b) => a - b);
  let sImp = 0, sExp = 0;
  const rijen = alle.map(t => {
    const i = imp.out.get(t) || 0, e = exp.out.get(t) || 0; sImp += i; sExp += e;
    return `${new Date(t).toISOString()},${i.toFixed(3)},${e.toFixed(3)}`;
  });

  mkdirSync(EXPORT, { recursive: true });
  const pad = resolve(EXPORT, 'energie-uur.csv');
  writeFileSync(pad, 'tijd,import_kwh,export_kwh\n' + rijen.join('\n') + '\n');
  console.log(`\n✓ ${rijen.length} tijdstappen -> ${pad}`);
  console.log(`  totaal import ${sImp.toFixed(1)} kWh, teruglevering ${sExp.toFixed(1)} kWh over de periode.`);
  console.log('  Laad dit bestand in de simulator onder "Echte data uit je P1-meter laden".');
})().catch(e => { console.error(e); process.exit(1); });
