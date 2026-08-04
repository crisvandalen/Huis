#!/usr/bin/env node
/**
 * Werkt het kosten- & opbrengsten-overzicht bij:
 *  - kosten     = afname net × all-in FlexPrijs (echte EPEX-uurprijzen)
 *  - opbrengst  = teruglevering × terugleververgoeding
 *  - zon        = productie uit de Enphase (cumulatieve teller, delta per dag)
 *  - bespaard   = zelf-verbruikte zon × vermeden inkoopprijs
 *
 * Import/teruglevering komen uit Homey Insights (historisch). De Enphase zit
 * NIET in Insights, dus zonproductie wordt vanaf nu opgebouwd: elke run logt de
 * huidige zonstand in inventaris/export/zon-standen.csv, en daaruit volgt de
 * dagproductie. Vandaag gebruiken we meter_power.day rechtstreeks.
 *
 * Logboek (groeit mee, oude dagen blijven):
 *   inventaris/export/kosten-historie.csv
 *   datum,import_kwh,teruglev_kwh,kosten,opbrengst,netto,zon_kwh,zon_bespaard
 * Voor de pagina: dashboard/kosten-overzicht.json
 *
 * Draaien:  node scripts/homey/kosten-bijwerken.mjs [resolutie]
 * Tarieven uit .env: ENERGIEBELASTING, FLEX_OPSLAG_KWH, TERUGLEVER_KWH
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { maakHomeyApi } from './cloud-client.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
const CSV = resolve(ROOT, 'inventaris/export/kosten-historie.csv');
const ZON_CSV = resolve(ROOT, 'inventaris/export/zon-standen.csv');
const JSON_UIT = resolve(ROOT, 'dashboard/kosten-overzicht.json');
const RES_DEFAULT = 'last14Days';
const METER = '11df88ce';
const ENPHASE = '6c2cad3e';

try {
  for (const r of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const t = r.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 1) continue;
    const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch { /* geen .env */ }
const num = (k, d) => { const v = parseFloat(process.env[k]); return isNaN(v) ? d : v; };
const BELASTING = num('ENERGIEBELASTING', 0.1108);
const OPSLAG = num('FLEX_OPSLAG_KWH', 0.0255);
const TERUGLEVER = num('TERUGLEVER_KWH', 0.04);

function kies(logs, suffix) {
  return logs.find(l => l.id.includes(METER) && l.id.endsWith(':' + suffix))
      || logs.find(l => l.id.endsWith(':' + suffix));
}
function capVal(dev, cap) { const c = dev && dev.capabilitiesObj && dev.capabilitiesObj[cap]; return c ? c.value : null; }
async function entries(api, log, res) {
  const a = { uri: log.uri, id: log.id, resolution: res };
  try { return await api.insights.getLogEntries(a); }
  catch { return await api.insights.getLogEntries(log, { resolution: res }); }
}
function standenPerUur(res) {
  const arr = (res && (res.values || res)) || [];
  const m = new Map();
  for (const e of arr) {
    const t = new Date(e.t || e.date || e[0]); const v = Number(e.v ?? e.value ?? e[1]);
    if (isNaN(t) || isNaN(v)) continue;
    const u = new Date(t); u.setMinutes(0, 0, 0); m.set(u.getTime(), v);
  }
  return m;
}
function deltas(m) {
  const t = [...m.keys()].sort((a, b) => a - b); const out = [];
  for (let i = 1; i < t.length; i++) {
    const d = m.get(t[i]) - m.get(t[i - 1]);
    out.push({ t: t[i - 1], kwh: d >= 0 && d < 200 ? d : 0 });
  }
  return out;
}
async function prijsMap(vanMs, totMs) {
  const van = new Date(vanMs).toISOString().slice(0, 10);
  const tot = new Date(totMs + 86400000).toISOString().slice(0, 10);
  const url = `https://api.energyzero.nl/v1/energyprices?fromDate=${van}T00:00:00.000Z&tillDate=${tot}T23:00:00.000Z&interval=4&usageType=1&inclBtw=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('EnergyZero HTTP ' + res.status);
  const j = await res.json();
  const map = new Map();
  for (const p of (j.Prices || [])) { const u = new Date(p.readingDate); u.setMinutes(0, 0, 0); map.set(u.getTime(), p.price + BELASTING + OPSLAG); }
  return map;
}
function allinVoor(map, tMs) { const u = new Date(tMs); u.setMinutes(0, 0, 0); return map.get(u.getTime()); }
function lokaleDag(tMs) { return new Date(tMs).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); }

// --- laadpaal (50five-sessies) ---
function leesSessies() {
  const p = resolve(ROOT, 'inventaris/export/laadpaal-sessies.csv');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').slice(1).map(r => {
    const c = r.split(',');
    return { id: c[0], start: new Date(c[1]).getTime(), eind: new Date(c[2]).getTime(), kwh: +c[3], kaart: c[4], euroBackend: +c[5] };
  }).filter(s => s.kwh > 0 && !isNaN(s.start) && !isNaN(s.eind) && s.eind > s.start);
}
// verdeel de sessie-kWh evenredig over de uren die 'ie beslaat (UTC-uur-buckets)
function spreidSessie(s) {
  const out = new Map(), perMs = s.kwh / (s.eind - s.start);
  let t = s.start;
  while (t < s.eind) {
    const uur = Math.floor(t / 3600000) * 3600000;
    const volgende = Math.min(s.eind, uur + 3600000);
    out.set(uur, (out.get(uur) || 0) + (volgende - t) * perMs);
    t = volgende;
  }
  return out;
}

// --- zonstanden-logboek (cumulatieve kWh-teller van de Enphase) ---
function leesZon() {
  const m = new Map();
  if (!existsSync(ZON_CSV)) return m;
  const lines = readFileSync(ZON_CSV, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) { const c = lines[i].split(','); if (c.length < 2) continue; m.set(new Date(c[0]).getTime(), +c[1]); }
  return m;
}
function schrijfZon(m) {
  const t = [...m.keys()].sort((a, b) => a - b);
  mkdirSync(dirname(ZON_CSV), { recursive: true });
  writeFileSync(ZON_CSV, 'tijd,cumulatief_kwh\n' + t.map(x => `${new Date(x).toISOString()},${m.get(x)}`).join('\n') + '\n');
}
// dagproductie uit de cumulatieve standen (delta tussen opeenvolgende metingen)
function zonPerDagUitStanden(m) {
  const t = [...m.keys()].sort((a, b) => a - b); const dag = new Map();
  for (let i = 1; i < t.length; i++) {
    const d = m.get(t[i]) - m.get(t[i - 1]);
    if (d < 0 || d > 200) continue;
    const k = lokaleDag(t[i - 1]); dag.set(k, (dag.get(k) || 0) + d);
  }
  return dag;
}

function leesCsv() {
  const m = new Map();
  if (!existsSync(CSV)) return m;
  const lines = readFileSync(CSV, 'utf8').trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(','); if (c.length < 6) continue;
    m.set(c[0], { import_kwh: +c[1], teruglev_kwh: +c[2], kosten: +c[3], opbrengst: +c[4], netto: +c[5], zon_kwh: +(c[6] || 0), zon_bespaard: +(c[7] || 0), laad_kwh: +(c[8] || 0), laad_kosten: +(c[9] || 0) });
  }
  return m;
}
function schrijfCsv(map) {
  const dagen = [...map.keys()].sort();
  const rijen = dagen.map(d => { const r = map.get(d);
    return [d, r.import_kwh.toFixed(3), r.teruglev_kwh.toFixed(3), r.kosten.toFixed(4), r.opbrengst.toFixed(4), r.netto.toFixed(4), (r.zon_kwh || 0).toFixed(3), (r.zon_bespaard || 0).toFixed(4), (r.laad_kwh || 0).toFixed(3), (r.laad_kosten || 0).toFixed(4)].join(','); });
  mkdirSync(dirname(CSV), { recursive: true });
  writeFileSync(CSV, 'datum,import_kwh,teruglev_kwh,kosten,opbrengst,netto,zon_kwh,zon_bespaard,laad_kwh,laad_kosten\n' + rijen.join('\n') + '\n');
}

export async function werkKostenBij({ api: apiIn, res = RES_DEFAULT } = {}) {
  let api = apiIn;
  if (!api) { const r = await maakHomeyApi(); api = r.api; }
  const logs = await api.insights.getLogs().then(l => Array.isArray(l) ? l : Object.values(l));
  const impLog = kies(logs, 'meter_power.consumed');
  const expLog = kies(logs, 'meter_power.returned');
  if (!impLog || !expLog) throw new Error('meterlogs niet gevonden');

  const imp = deltas(standenPerUur(await entries(api, impLog, res)));
  const exp = deltas(standenPerUur(await entries(api, expLog, res)));
  const sessies = leesSessies();
  const alleT = [...imp, ...exp].map(x => x.t);
  if (!alleT.length && !sessies.length) throw new Error('geen data uit Insights of laadsessies');
  const tijden = [...alleT];
  for (const s of sessies) { tijden.push(s.start, s.eind); }
  const prijzen = await prijsMap(Math.min(...tijden), Math.max(...tijden));

  // Laadsessies afrekenen tegen de dynamische prijs + per dag uitsplitsen.
  const laadDag = new Map(), sessiesGeprijsd = [];
  for (const s of sessies) {
    const perUur = spreidSessie(s);
    let kostenDyn = 0;
    for (const [uur, kwh] of perUur) {
      const a = allinVoor(prijzen, uur); const k = a != null ? kwh * a : 0; kostenDyn += k;
      const dag = lokaleDag(uur); const d = laadDag.get(dag) || { kwh: 0, kosten: 0 };
      d.kwh += kwh; d.kosten += k; laadDag.set(dag, d);
    }
    sessiesGeprijsd.push({ id: s.id, start: new Date(s.start).toISOString(), eind: new Date(s.eind).toISOString(), kwh: s.kwh, kaart: s.kaart, kostenDyn, vergoeding: s.euroBackend, marge: s.euroBackend - kostenDyn });
  }

  // Zonstand nu loggen en dagproductie afleiden.
  let zonPerDag = new Map(), zonVandaag = null, zonTotaalTeller = null;
  try {
    const devices = await api.devices.getDevices();
    const enphase = Object.values(devices).find(d => (d.id || '').includes(ENPHASE) || ((d.driverId || d.driverUri || '') + '').includes('enphase'));
    zonTotaalTeller = capVal(enphase, 'meter_power');       // cumulatief kWh
    zonVandaag = capVal(enphase, 'meter_power.day');        // vandaag kWh
    const standen = leesZon();
    if (zonTotaalTeller != null) { const u = new Date(); u.setMinutes(0, 0, 0); standen.set(u.getTime(), zonTotaalTeller); schrijfZon(standen); }
    zonPerDag = zonPerDagUitStanden(standen);
    // Enlighten-dagproductie (backfill uit de Enphase-cloud) is authoritatief voor historische dagen.
    try {
      const zonDagPad = resolve(ROOT, 'inventaris/export/zon-dag.csv');
      if (existsSync(zonDagPad)) for (const r of readFileSync(zonDagPad, 'utf8').trim().split('\n').slice(1)) {
        const c = r.split(','); if (c.length >= 2 && c[0]) zonPerDag.set(c[0], +c[1]);
      }
    } catch { /* geen backfill */ }
    if (zonVandaag != null) zonPerDag.set(lokaleDag(Date.now()), zonVandaag); // vandaag live uit meter_power.day
  } catch (e) { console.error('  zon uitlezen mislukt:', e.message); }

  // per dag aggregeren (import/teruglevering)
  const nieuw = new Map();
  const voegToe = (arr, soort) => {
    for (const { t, kwh } of arr) {
      const dag = lokaleDag(t);
      const r = nieuw.get(dag) || { import_kwh: 0, teruglev_kwh: 0, kosten: 0, opbrengst: 0 };
      if (soort === 'imp') { const a = allinVoor(prijzen, t); r.import_kwh += kwh; if (a != null) r.kosten += kwh * a; }
      else { r.teruglev_kwh += kwh; r.opbrengst += kwh * TERUGLEVER; }
      nieuw.set(dag, r);
    }
  };
  voegToe(imp, 'imp'); voegToe(exp, 'exp');

  const boek = leesCsv();
  // dagen met import/teruglevering bijwerken (incl. zon indien bekend)
  for (const [dag, r] of nieuw) {
    r.netto = r.kosten - r.opbrengst;
    const zon = zonPerDag.get(dag);
    const oud = boek.get(dag) || {};
    r.zon_kwh = zon != null ? zon : (oud.zon_kwh || 0);
    const avgP = r.import_kwh > 0 ? r.kosten / r.import_kwh : (BELASTING + OPSLAG + 0.10);
    const zonZelf = Math.max(0, r.zon_kwh - r.teruglev_kwh);
    r.zon_bespaard = zonZelf * avgP;
    boek.set(dag, { ...oud, ...r });
  }
  // dagen die alleen zon hebben ook vastleggen — maar "bespaard" ALLEEN als er
  // meterdata is (anders weten we zelfverbruik vs. teruglevering niet).
  for (const [dag, zon] of zonPerDag) {
    if (nieuw.has(dag)) continue;
    const oud = boek.get(dag) || { import_kwh: 0, teruglev_kwh: 0, kosten: 0, opbrengst: 0, netto: 0 };
    const heeftMeter = (oud.import_kwh || 0) > 0 || (oud.teruglev_kwh || 0) > 0;
    const zonZelf = Math.max(0, zon - (oud.teruglev_kwh || 0));
    const avgP = oud.import_kwh > 0 ? oud.kosten / oud.import_kwh : (BELASTING + OPSLAG + 0.10);
    boek.set(dag, { ...oud, zon_kwh: zon, zon_bespaard: heeftMeter ? zonZelf * avgP : 0 });
  }
  // laadpaal per dag toevoegen
  for (const [dag, d] of laadDag) {
    const oud = boek.get(dag) || { import_kwh: 0, teruglev_kwh: 0, kosten: 0, opbrengst: 0, netto: 0, zon_kwh: 0, zon_bespaard: 0 };
    boek.set(dag, { ...oud, laad_kwh: d.kwh, laad_kosten: d.kosten });
  }
  schrijfCsv(boek);

  const dagen = [...boek.keys()].sort().map(d => ({ datum: d, ...boek.get(d) }));
  const tot = dagen.reduce((a, x) => ({
    import_kwh: a.import_kwh + x.import_kwh, teruglev_kwh: a.teruglev_kwh + x.teruglev_kwh,
    kosten: a.kosten + x.kosten, opbrengst: a.opbrengst + x.opbrengst, netto: a.netto + x.netto,
    zon_kwh: a.zon_kwh + (x.zon_kwh || 0), zon_bespaard: a.zon_bespaard + (x.zon_bespaard || 0),
    laad_kwh: a.laad_kwh + (x.laad_kwh || 0), laad_kosten: a.laad_kosten + (x.laad_kosten || 0),
  }), { import_kwh: 0, teruglev_kwh: 0, kosten: 0, opbrengst: 0, netto: 0, zon_kwh: 0, zon_bespaard: 0, laad_kwh: 0, laad_kosten: 0 });
  // laadpaal-totalen (over alle sessies, ook buiten het meter-venster)
  const laadTot = sessiesGeprijsd.reduce((a, s) => ({
    kwh: a.kwh + s.kwh, kostenDyn: a.kostenDyn + s.kostenDyn, vergoeding: a.vergoeding + s.vergoeding, marge: a.marge + s.marge,
  }), { kwh: 0, kostenDyn: 0, vergoeding: 0, marge: 0 });
  mkdirSync(dirname(JSON_UIT), { recursive: true });
  writeFileSync(JSON_UIT, JSON.stringify({
    bijgewerkt: new Date().toISOString(),
    tarief: { belasting: BELASTING, opslag: OPSLAG, teruglever: TERUGLEVER },
    zon_totaal_teller: zonTotaalTeller, totalen: tot, dagen,
    laadpaal: { ...laadTot, aantal: sessiesGeprijsd.length, sessies: sessiesGeprijsd.slice(-40).reverse() },
  }, null, 2));
  return { dagenBijgewerkt: nieuw.size, logboekDagen: dagen.length, totalen: tot, zonVandaag, laad: laadTot };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  werkKostenBij({ res: process.argv[2] || RES_DEFAULT })
    .then(r => {
      console.error(`✓ ${r.dagenBijgewerkt} dagen bijgewerkt, logboek nu ${r.logboekDagen} dagen.`);
      console.error(`  Kosten €${r.totalen.kosten.toFixed(2)}, opbrengst €${r.totalen.opbrengst.toFixed(2)}, netto €${r.totalen.netto.toFixed(2)}.`);
      console.error(`  Zon ${r.totalen.zon_kwh.toFixed(1)} kWh, bespaard door zelfverbruik €${r.totalen.zon_bespaard.toFixed(2)} (bouwt op vanaf nu).`);
      if (r.laad && r.laad.kwh > 0)
        console.error(`  Laadpaal: ${r.laad.kwh.toFixed(0)} kWh, dynamische kosten €${r.laad.kostenDyn.toFixed(2)}, vergoeding €${r.laad.vergoeding.toFixed(2)} → marge €${r.laad.marge.toFixed(2)}.`);
      console.error(`  Logboek: ${CSV}`);
    })
    .catch(e => { console.error('Mislukt:', e.message); process.exit(1); });
}
