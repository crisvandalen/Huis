#!/usr/bin/env node
/**
 * Laadadvies-agent: haalt de dynamische uurprijzen van vandaag + morgen op
 * (EnergyZero), rekent ze om naar je Vattenfall FlexPrijs, en bepaalt:
 *   - het goedkoopste aaneengesloten laadvenster (globaal én 's nachts)
 *   - de uren met negatieve marktprijs (goedkoopst mogelijk)
 *   - een indicatie hoeveel je bespaart t.o.v. lukraak laden
 *
 * Schrijft dashboard/laadadvies.json (voor de pagina) en print een samenvatting.
 * Stuurt NIETS aan — puur advies. Draai 'm dagelijks ná ~13:00 (dan staan de
 * prijzen van morgen online).
 *
 * Draaien:  node scripts/homey/laadadvies.mjs
 * Cron (VPS/Mac), elke dag 13:15:  15 13 * * *  cd ~/projects/huis && node scripts/homey/laadadvies.mjs
 *
 * .env: ENERGIEBELASTING, FLEX_OPSLAG_KWH (all-in prijs), en optioneel:
 *   LAADUREN=5           # uren die je per nacht nodig hebt om te laden
 *   LAADPAAL_KW=7.4      # laadvermogen (voor de kWh/besparing-schatting)
 *   LAAD_PER_DAG_KWH=29  # typische dagelijkse laadhoeveelheid (voor besparing)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
const UIT = resolve(ROOT, 'dashboard', 'laadadvies.json');

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
const LAADUREN = Math.max(1, Math.round(num('LAADUREN', 5)));
const LAAD_PER_DAG = num('LAAD_PER_DAG_KWH', 29);

// 50five-vergoeding per kWh: afgeleid uit de sessiedata (som te-ontvangen / som kWh),
// met .env-override LAAD_VERGOEDING_KWH; valt terug op het 50five-standaardtarief.
function leesVergoedingKwh() {
  const env = parseFloat(process.env.LAAD_VERGOEDING_KWH);
  if (!isNaN(env)) return env;
  try {
    const p = resolve(ROOT, 'inventaris/export/laadpaal-sessies.csv');
    let kwh = 0, eur = 0;
    for (const l of readFileSync(p, 'utf8').trim().split('\n').slice(1)) {
      const c = l.split(','); if (c.length < 6) continue;
      kwh += parseFloat(c[3]) || 0; eur += parseFloat(c[5]) || 0;
    }
    if (kwh > 0) return eur / kwh;
  } catch { /* nog geen sessies */ }
  return 0.375; // 50five-standaardtarief bij benadering
}
const VERGOEDING = leesVergoedingKwh();

async function haalDag(datum) {
  const url = `https://api.energyzero.nl/v1/energyprices?fromDate=${datum}T00:00:00.000Z&tillDate=${datum}T23:00:00.000Z&interval=4&usageType=1&inclBtw=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('EnergyZero HTTP ' + res.status);
  const j = await res.json();
  return (j.Prices || []).map(p => ({
    t: new Date(p.readingDate).getTime(), markt: p.price, allin: p.price + BELASTING + OPSLAG,
  }));
}
const isoDag = d => d.toISOString().slice(0, 10);
const lokaalUur = t => Number(new Date(t).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).slice(0, 2));
const lokaalLabel = t => new Date(t).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit' });

// goedkoopste aaneengesloten venster van `uren` uur; optioneel alleen nacht (22-08)
function besteVenster(uren, lengte, alleenNacht) {
  let best = null;
  for (let i = 0; i + lengte <= uren.length; i++) {
    const blok = uren.slice(i, i + lengte);
    if (alleenNacht && !blok.every(u => { const h = lokaalUur(u.t); return h >= 22 || h < 8; })) continue;
    // aaneengesloten check (opeenvolgende uren)
    let aaneengesloten = true;
    for (let k = 1; k < blok.length; k++) if (blok[k].t - blok[k - 1].t !== 3600000) { aaneengesloten = false; break; }
    if (!aaneengesloten) continue;
    const gem = blok.reduce((a, u) => a + u.allin, 0) / lengte;
    if (!best || gem < best.gem) best = { start: blok[0].t, eind: blok[lengte - 1].t + 3600000, gem, uren: blok };
  }
  return best;
}

export async function maakLaadadvies({ stil = false } = {}) {
  const nu = new Date();
  const vandaag = isoDag(nu);
  const morgen = isoDag(new Date(nu.getTime() + 86400000));
  let prijzen = [];
  try { prijzen = prijzen.concat(await haalDag(vandaag)); } catch (e) { console.error('vandaag:', e.message); }
  try { prijzen = prijzen.concat(await haalDag(morgen)); } catch { console.error('morgen nog niet beschikbaar (komt ~13:00).'); }
  if (!prijzen.length) throw new Error('geen prijzen opgehaald');

  // alleen vanaf het huidige uur vooruit
  const uurNu = Math.floor(nu.getTime() / 3600000) * 3600000;
  prijzen = prijzen.filter(p => p.t >= uurNu).sort((a, b) => a.t - b.t);

  const gemHorizon = prijzen.reduce((a, u) => a + u.allin, 0) / prijzen.length;
  const globaal = besteVenster(prijzen, LAADUREN, false);
  const nacht = besteVenster(prijzen, LAADUREN, true);
  const negatief = prijzen.filter(u => u.markt < 0).map(u => ({ tijd: new Date(u.t).toISOString(), label: lokaalLabel(u.t), markt: u.markt, allin: u.allin }));
  const goedkoopsteUur = prijzen.reduce((a, u) => u.allin < a.allin ? u : a, prijzen[0]);

  const besparing = globaal ? Math.max(0, (gemHorizon - globaal.gem) * LAAD_PER_DAG) : 0;

  // Winst-uren: uren waarin je all-in prijs onder je 50five-vergoeding ligt (= met marge laden).
  const winstUren = prijzen.filter(u => u.allin < VERGOEDING)
    .map(u => ({ tijd: new Date(u.t).toISOString(), label: lokaalLabel(u.t), allin: u.allin, winst: VERGOEDING - u.allin }));
  const margeVenster = globaal ? VERGOEDING - globaal.gem : null;
  const winstPerDag = margeVenster != null ? Math.max(0, margeVenster) * LAAD_PER_DAG : 0;

  const advies = {
    gegenereerd: nu.toISOString(),
    laaduren: LAADUREN, laad_per_dag_kwh: LAAD_PER_DAG,
    gem_horizon: gemHorizon,
    beste_venster: globaal && { start: new Date(globaal.start).toISOString(), eind: new Date(globaal.eind).toISOString(), gem: globaal.gem, label: lokaalLabel(globaal.start) + '–' + lokaalLabel(globaal.eind) },
    nacht_venster: nacht && { start: new Date(nacht.start).toISOString(), eind: new Date(nacht.eind).toISOString(), gem: nacht.gem, label: lokaalLabel(nacht.start) + '–' + lokaalLabel(nacht.eind) },
    goedkoopste_uur: { tijd: new Date(goedkoopsteUur.t).toISOString(), label: lokaalLabel(goedkoopsteUur.t), allin: goedkoopsteUur.allin, markt: goedkoopsteUur.markt },
    negatieve_uren: negatief,
    besparing_per_dag: besparing,
    vergoeding_kwh: VERGOEDING,
    marge_beste_venster: margeVenster,
    winst_per_dag: winstPerDag,
    winst_uren: winstUren,
    uren: prijzen.map(u => ({ tijd: new Date(u.t).toISOString(), markt: u.markt, allin: u.allin })),
  };
  mkdirSync(dirname(UIT), { recursive: true });
  writeFileSync(UIT, JSON.stringify(advies, null, 2));

  if (!stil) {
    console.log(`\n⚡ Laadadvies (${prijzen.length} uur vooruit, ${LAADUREN}u laden):`);
    if (globaal) console.log(`  Goedkoopst: ${advies.beste_venster.label}  gem €${globaal.gem.toFixed(3)}/kWh  → ~€${besparing.toFixed(2)} voordeel t.o.v. gemiddeld`);
    if (nacht && (!globaal || nacht.start !== globaal.start)) console.log(`  's Nachts:  ${advies.nacht_venster.label}  gem €${nacht.gem.toFixed(3)}/kWh`);
    if (negatief.length) console.log(`  ⚠ Negatieve marktprijs: ${negatief.map(n => n.label).join(', ')} (all-in ~€${negatief[0].allin.toFixed(3)}) — laad dan extra / op zon.`);
    else console.log('  Geen negatieve uren in deze horizon.');
    console.log(`  Vergoeding 50five ~€${VERGOEDING.toFixed(3)}/kWh → ${winstUren.length} uur met winst${margeVenster != null ? ` (venstermarge €${margeVenster.toFixed(3)}/kWh, ~€${winstPerDag.toFixed(2)}/dag)` : ''}.`);
    console.log(`  Geschreven: ${UIT}`);
  }
  return advies;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) maakLaadadvies().catch(e => { console.error('Mislukt:', e.message); process.exit(1); });
