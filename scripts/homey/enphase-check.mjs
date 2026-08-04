#!/usr/bin/env node
/**
 * Dumpt alle zonnepaneel-apparaten (class 'solarpanel') met hun live-waarden,
 * zodat we zien welke de juiste totale zonproductie geeft. Puur uitlezen.
 * Draai: node scripts/homey/enphase-check.mjs
 */
import { maakHomeyApi } from './cloud-client.mjs';

const { api, homey } = await maakHomeyApi();
console.log(`Verbonden met ${homey.name}.\n`);
const devices = await api.devices.getDevices();
const arr = Object.values(devices);

const zonnetjes = arr.filter(d => (d.class === 'solarpanel') ||
  ((d.driverId || d.driverUri || '') + '').includes('enphase'));

if (!zonnetjes.length) { console.log('Geen solarpanel/enphase-apparaten gevonden.'); process.exit(0); }

for (const d of zonnetjes) {
  console.log(`=== ${d.name}  (id ${d.id})`);
  console.log(`    class=${d.class}  driver=${d.driverId || d.driverUri}  beschikbaar=${d.available}`);
  const co = d.capabilitiesObj || {};
  for (const [k, v] of Object.entries(co)) {
    const val = v && v.value !== undefined ? v.value : v;
    const unit = v && v.units ? ` ${v.units}` : '';
    console.log(`    ${k.padEnd(22)} = ${val}${unit}`);
  }
  console.log('');
}
console.log('Tip: de "juiste" is meestal die met een realistische measure_power (kW-bereik overdag) en oplopende meter_power (totaal kWh).');
