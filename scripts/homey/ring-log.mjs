#!/usr/bin/env node
/**
 * Haalt de beweging-geschiedenis van de Ring-camera's uit Homey Insights en
 * schrijft die naar inventaris/export/ring-log.json, zodat bouw_dashboard.py er
 * een "Camera-log"-blok van kan maken.
 *
 * Werkt via de Athom-cloud (OAuth2), net als export-cloud.mjs — dus ook van
 * buiten het LAN, maar NIET vanuit de Cowork-cloudsessie (die heeft het token
 * niet). Draai lokaal op de Mac of op de VPS.
 *
 *   node scripts/homey/ring-log.mjs [resolutie]
 *   resolutie: last24Hours | last7Days (standaard) | last14Days | last31Days
 *
 * Vereist: `make cloud-auth` gedaan + HOMEY_CLIENT_ID/SECRET in .env.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakHomeyApi } from './cloud-client.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
const EXPORT_DIR = resolve(ROOT, 'inventaris/export');
const RING_DRIVER = 'com.amazon.ring';
const CAP = 'alarm_motion';
const RESOLUTIE = process.argv[2] || 'last7Days';

// Homey logt alarm_motion als booleaanse stap-log (0/1). We tellen elke
// overgang naar "aan" (0 -> 1) als één beweging-gebeurtenis.
function haalEvents(values) {
  const events = [];
  let vorige = 0;
  for (const punt of values ?? []) {
    const v = punt.v === true || punt.v === 1 ? 1 : 0;
    if (v === 1 && vorige === 0) events.push(punt.t); // ISO-tijd van de overgang
    vorige = v;
  }
  return events;
}

async function main() {
  const { homey, api } = await maakHomeyApi();
  console.log(`Verbonden met ${homey.name} via de cloud. Resolutie: ${RESOLUTIE}\n`);

  const devices = await api.devices.getDevices();
  const rings = Object.values(devices).filter(
    (d) => String(d.driverId ?? d.driverUri ?? '').includes(RING_DRIVER));
  if (!rings.length) {
    console.error(`Geen Ring-camera's gevonden (driver bevat ${RING_DRIVER}).`);
    process.exit(1);
  }
  console.log(`${rings.length} Ring-camera's: ${rings.map((d) => d.name).join(', ')}\n`);

  // Alle insight-logs ophalen. Homey-versies verschillen in veldnamen, dus we
  // matchen soepel: een log hoort bij een apparaat als de device-id ergens in
  // de sleutel/id/uri/ownerUri voorkomt.
  const logEntries = Object.entries(await api.insights.getLogs());
  console.log(`${logEntries.length} insight-logs in totaal.\n`);

  const hoortBij = (key, log, id) =>
    [key, log?.id, log?.uri, log?.ownerUri].some((x) => String(x ?? '').includes(id));
  const isMotion = (key, log) =>
    [key, log?.id].some((x) => String(x ?? '').includes(CAP));

  const cameras = [];
  for (const d of rings) {
    const eigen = logEntries.filter(([key, log]) => hoortBij(key, log, d.id));
    // Diagnostiek: laat zien wélke logs deze camera heeft (id's).
    const ids = eigen.map(([key, log]) => String(log?.id ?? key)).sort();
    console.log(`  ${d.name}: ${eigen.length} eigen logs` +
      (ids.length ? ` -> ${ids.join(', ')}` : ' (geen enkele Insights-log)'));

    const motion = eigen.find(([key, log]) => isMotion(key, log));
    if (!motion) {
      cameras.push({ naam: d.name, id: d.id, beschikbaar: false, events: [], aantal: 0 });
      continue;
    }
    const [key, log] = motion;
    let values = [];
    const params = { id: log?.id ?? key, uri: log?.uri ?? log?.ownerUri ?? `homey:device:${d.id}`, resolution: RESOLUTIE };
    try {
      const res = await api.insights.getLogEntries(params);
      values = res?.values ?? res?.entries ?? [];
    } catch (err) {
      console.log(`      getLogEntries faalde (${JSON.stringify(params)}): ${err.message}`);
    }
    const events = haalEvents(values);
    console.log(`      -> motion-log '${params.id}': ${values.length} datapunten, ${events.length} events`);
    cameras.push({ naam: d.name, id: d.id, beschikbaar: true, events, aantal: events.length });
  }

  mkdirSync(EXPORT_DIR, { recursive: true });
  const uit = resolve(EXPORT_DIR, 'ring-log.json');
  writeFileSync(uit, JSON.stringify({
    bron: 'homey-insights',
    capability: CAP,
    resolutie: RESOLUTIE,
    opgehaald_op: new Date().toISOString(),
    cameras,
  }, null, 2));
  console.log(`\nGeschreven: ${uit}`);
}

main().catch((err) => {
  console.error('Mislukt:', err.message);
  process.exit(1);
});
