#!/usr/bin/env node
// Haalt via de Athom-cloud de exacte URLs van je Homey op, en test of de
// HOMEY_API_KEY tegen de cloud werkt. Draaien kan vanaf elk netwerk.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const NL = String.fromCharCode(10);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(NL)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim();
  if (!(k in process.env)) process.env[k] = v;
}
const key = process.env.HOMEY_API_KEY;
if (!key) { console.log('Geen HOMEY_API_KEY in .env'); process.exit(1); }
const res = await fetch('https://api.athom.com/user/me', { headers: { Authorization: `Bearer ${key}` } });
console.log('Athom cloud API: HTTP ' + res.status);
if (!res.ok) {
  console.log('De key werkt niet tegen de Athom-cloud (te verwachten bij een lokale API-key).');
  console.log('Volgende stap: exacte URL uit tools.developer.homey.app, of we gaan via OAuth2.');
  process.exit(1);
}
const me = await res.json();
const homeys = me.homeys || (me.user && me.user.homeys) || [];
if (!homeys.length) { console.log('Geen Homeys gevonden in het antwoord.'); process.exit(1); }
for (const h of homeys) {
  console.log('--- ' + h.name + ' (' + h.platform + ')');
  console.log('  localUrl       ' + h.localUrl);
  console.log('  localUrlSecure ' + h.localUrlSecure);
  console.log('  remoteUrl      ' + h.remoteUrl);
}
