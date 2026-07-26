#!/usr/bin/env node
/**
 * Exporteert Homey via de Athom-cloud (OAuth2) naar inventaris/export/.
 *
 * Tegenhanger van export-devices.mjs, maar werkt van BUITEN het LAN — dus ook
 * op de VPS. Schrijft dezelfde bestanden (homey-ruw.json + homey.json) in
 * hetzelfde formaat, zodat bouw_dashboard.py ongewijzigd blijft werken.
 *
 * Vereist: eenmalig `make cloud-auth` (token in .homey-cloud-token.json) en
 * HOMEY_CLIENT_ID/SECRET in .env. Zie docs/04-cloud-oauth2.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakHomeyApi } from './cloud-client.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
const EXPORT_DIR = resolve(ROOT, 'inventaris/export');

// Haalt een manager-collectie op; faalt zacht (net als de lokale export), zodat
// een missende sectie de rest van de export niet onderuit haalt.
async function haal(naam, fn) {
  try {
    const data = (await fn()) ?? {};
    console.log(`  ok   ${naam.padEnd(16)} ${Object.keys(data).length} items`);
    return data;
  } catch (err) {
    console.log(`  --   ${naam.padEnd(16)} ${err.message}`);
    return {};
  }
}

// Reduceert de rijke device-objecten tot precies wat het dashboard leest.
function mapDevices(devicesRaw, zones) {
  const zoneNaam = (id) => (zones && zones[id] ? zones[id].name : null);
  const ruw = {};
  const samen = [];
  for (const d of Object.values(devicesRaw)) {
    const capabilitiesObj = {};
    for (const [k, v] of Object.entries(d.capabilitiesObj ?? {})) {
      capabilitiesObj[k] = { value: v?.value ?? null };
    }
    const driver = d.driverId ?? d.driverUri ?? null;
    ruw[d.id] = {
      id: d.id, name: d.name, zone: d.zone, class: d.class,
      driverId: driver, available: d.available,
      capabilities: d.capabilities ?? [], capabilitiesObj,
    };
    samen.push({
      id: d.id, naam: d.name, zone: zoneNaam(d.zone), klasse: d.class,
      merk: driver, beschikbaar: d.available, capabilities: d.capabilities ?? [],
    });
  }
  samen.sort((a, b) => `${a.zone}${a.naam}`.localeCompare(`${b.zone}${b.naam}`));
  return { ruw, samen };
}

function keyed(obj, velden) {
  const uit = {};
  for (const x of Object.values(obj ?? {})) {
    const rij = {};
    for (const v of velden) rij[v] = x[v] ?? null;
    uit[x.id] = rij;
  }
  return uit;
}

async function main() {
  const { homey, api } = await maakHomeyApi();
  console.log(`Verbonden met ${homey.name} via de cloud.\n`);

  const devicesRaw = await haal('devices', () => api.devices.getDevices());
  const zonesRaw = await haal('zones', () => api.zones.getZones());
  const flowsRaw = await haal('flows', () => api.flow.getFlows());
  const advRaw = await haal('advanced_flows', () => api.flow.getAdvancedFlows());

  const zones = keyed(zonesRaw, ['id', 'name', 'parent']);
  const flows = keyed(flowsRaw, ['id', 'name', 'enabled', 'folder']);
  const advanced_flows = keyed(advRaw, ['id', 'name', 'enabled', 'folder']);
  const { ruw: devices, samen } = mapDevices(devicesRaw, zones);

  const opgehaald_op = new Date().toISOString();
  mkdirSync(EXPORT_DIR, { recursive: true });

  writeFileSync(resolve(EXPORT_DIR, 'homey-ruw.json'), JSON.stringify({
    basis: 'cloud (OAuth2)',
    opgehaald_op,
    data: { devices, zones, flows, advanced_flows },
  }, null, 2));

  writeFileSync(resolve(EXPORT_DIR, 'homey.json'), JSON.stringify({
    bron: 'homey-cloud',
    opgehaald_op,
    apparaten: samen,
    zones: Object.values(zones).map((z) => ({ id: z.id, naam: z.name, ouder: z.parent })),
    flows: Object.values(flows).map((f) => ({ id: f.id, naam: f.name, aan: f.enabled, map: f.folder })),
  }, null, 2));

  console.log(`\n${samen.length} apparaten, ${Object.keys(flows).length} flows`);
  console.log(`Geschreven: ${resolve(EXPORT_DIR, 'homey.json')}`);
}

main().catch((err) => {
  console.error('Mislukt:', err.message);
  process.exit(1);
});
