#!/usr/bin/env node
/**
 * Haalt de dagelijkse zonproductie uit de Enphase Enlighten Systems API (v4) en
 * schrijft die naar inventaris/export/zon-dag.csv (datum,kwh). Zo krijgt het
 * kostenoverzicht de échte historische productie, gelijk aan de Enphase-app.
 *
 * Eenmalige setup:
 *   1) Maak een app op https://developer-v4.enphase.com (gratis "Watt"-plan).
 *      Je krijgt: API key, client_id, client_secret. Redirect URL laat je op de
 *      standaard staan: https://api.enphaseenergy.com/oauth/redirect_uri
 *   2) Zet in .env:
 *        ENPHASE_API_KEY=...
 *        ENPHASE_CLIENT_ID=...
 *        ENPHASE_CLIENT_SECRET=...
 *        ENPHASE_SYSTEM_ID=        (vul je in na stap 'systems')
 *   3) node scripts/homey/enphase-enlighten.mjs auth
 *        -> open de getoonde URL, log in bij Enlighten, keur goed.
 *        -> de pagina toont een 'code'. Draai daarna:
 *      node scripts/homey/enphase-enlighten.mjs auth <code>
 *   4) node scripts/homey/enphase-enlighten.mjs systems   -> toont je system_id
 *      Zet dat in .env als ENPHASE_SYSTEM_ID.
 *
 * Daarna:
 *   node scripts/homey/enphase-enlighten.mjs [start_date]   # default 120 dagen terug
 *   -> schrijft/ververst inventaris/export/zon-dag.csv
 *
 * Token wordt bewaard in scripts/homey/.enphase-token.json (zet 'm in .gitignore)
 * en automatisch ververst via het refresh-token.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
const TOKEN = resolve(HIER, '.enphase-token.json');
const ZON_DAG = resolve(ROOT, 'inventaris/export/zon-dag.csv');
const REDIRECT = 'https://api.enphaseenergy.com/oauth/redirect_uri';
const BASE = 'https://api.enphaseenergy.com';

// --- .env ---
try {
  for (const r of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const t = r.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 1) continue;
    const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch { /* geen .env */ }
const API_KEY = process.env.ENPHASE_API_KEY;
const CLIENT_ID = process.env.ENPHASE_CLIENT_ID;
const CLIENT_SECRET = process.env.ENPHASE_CLIENT_SECRET;
const SYSTEM_ID = process.env.ENPHASE_SYSTEM_ID;

function basic() { return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'); }
function eisCreds() {
  if (!API_KEY || !CLIENT_ID || !CLIENT_SECRET) {
    console.error('ENPHASE_API_KEY / ENPHASE_CLIENT_ID / ENPHASE_CLIENT_SECRET ontbreken in .env.');
    console.error('Maak een app op https://developer-v4.enphase.com en vul ze in.');
    process.exit(1);
  }
}
function bewaarToken(t) { t.opgehaald = Date.now(); writeFileSync(TOKEN, JSON.stringify(t, null, 2)); }
function laadToken() { try { return JSON.parse(readFileSync(TOKEN, 'utf8')); } catch { return null; } }

async function ruilCode(code) {
  const url = `${BASE}/oauth/token?grant_type=authorization_code&redirect_uri=${encodeURIComponent(REDIRECT)}&code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: basic() } });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('token-uitwisseling mislukt: ' + JSON.stringify(j));
  bewaarToken(j); return j;
}
async function ververToken(t) {
  const url = `${BASE}/oauth/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: basic() } });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('token verversen mislukt: ' + JSON.stringify(j));
  bewaarToken(j); return j;
}
async function geldigToken() {
  let t = laadToken();
  if (!t) { console.error('Nog geen token. Draai eerst: node scripts/homey/enphase-enlighten.mjs auth'); process.exit(1); }
  const leeftijd = (Date.now() - (t.opgehaald || 0)) / 1000;
  if (leeftijd > (t.expires_in || 86400) - 300) t = await ververToken(t);
  return t.access_token;
}
async function api(pad, params = {}) {
  const at = await geldigToken();
  const qs = new URLSearchParams({ key: API_KEY, ...params }).toString();
  const res = await fetch(`${BASE}/api/v4${pad}?${qs}`, { headers: { Authorization: `Bearer ${at}` } });
  const tekst = await res.text();
  let j; try { j = JSON.parse(tekst); } catch { j = tekst; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof j === 'string' ? j : JSON.stringify(j)}`);
  return j;
}

function isoDag(d) { return d.toISOString().slice(0, 10); }
function leesZonDag() {
  const m = new Map();
  if (!existsSync(ZON_DAG)) return m;
  const lines = readFileSync(ZON_DAG, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) { const c = lines[i].split(','); if (c.length < 2) continue; m.set(c[0], +c[1]); }
  return m;
}
function schrijfZonDag(m) {
  const d = [...m.keys()].sort();
  mkdirSync(dirname(ZON_DAG), { recursive: true });
  writeFileSync(ZON_DAG, 'datum,kwh\n' + d.map(k => `${k},${m.get(k).toFixed(3)}`).join('\n') + '\n');
}

async function backfill(startArg) {
  eisCreds();
  if (!SYSTEM_ID) { console.error('ENPHASE_SYSTEM_ID ontbreekt in .env. Draai eerst: enphase-enlighten.mjs systems'); process.exit(1); }
  const eind = new Date();
  const start = startArg ? new Date(startArg) : new Date(Date.now() - 120 * 86400000);
  const j = await api(`/systems/${SYSTEM_ID}/energy_lifetime`, { start_date: isoDag(start), end_date: isoDag(eind) });
  // Verwacht: { start_date: 'YYYY-MM-DD', production: [Wh per dag] }
  const prod = j.production || j.production_micro || null;
  if (!Array.isArray(prod)) { console.error('Onverwacht antwoord (geen production-array):'); console.error(JSON.stringify(j).slice(0, 600)); process.exit(1); }
  const d0 = new Date((j.start_date || j.meter_start_date || isoDag(start)) + 'T00:00:00Z');
  const boek = leesZonDag();
  let n = 0;
  for (let i = 0; i < prod.length; i++) {
    const d = new Date(d0.getTime() + i * 86400000);
    const kwh = (Number(prod[i]) || 0) / 1000;      // Wh -> kWh
    boek.set(isoDag(d), kwh); n++;
  }
  schrijfZonDag(boek);
  console.error(`✓ ${n} dagen zonproductie geschreven naar ${ZON_DAG}`);
  const laatste = [...boek.keys()].sort().slice(-3);
  for (const k of laatste) console.error(`   ${k}: ${boek.get(k).toFixed(1)} kWh`);
  console.error('Draai nu: node scripts/homey/kosten-bijwerken.mjs');
}

// --- CLI ---
const cmd = process.argv[2];
if (cmd === 'auth') {
  eisCreds();
  const code = process.argv[3];
  if (!code) {
    const url = `${BASE}/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}`;
    console.log('Open deze URL, log in bij Enlighten en keur toegang goed:\n');
    console.log('  ' + url + '\n');
    console.log('Na goedkeuring toont de pagina een "code". Draai dan:');
    console.log('  node scripts/homey/enphase-enlighten.mjs auth <code>');
  } else {
    await ruilCode(code);
    console.log('✓ Token opgeslagen. Volgende: node scripts/homey/enphase-enlighten.mjs systems');
  }
} else if (cmd === 'systems') {
  eisCreds();
  const j = await api('/systems');
  const sys = j.systems || [];
  if (!sys.length) console.log('Geen systemen gevonden in het antwoord:', JSON.stringify(j).slice(0, 400));
  for (const s of sys) console.log(`system_id=${s.system_id}  naam=${s.name || s.public_name}  tz=${s.timezone}`);
  console.log('\nZet de juiste system_id in .env als ENPHASE_SYSTEM_ID.');
} else {
  await backfill(cmd); // cmd kan een start_date zijn (YYYY-MM-DD) of leeg
}
