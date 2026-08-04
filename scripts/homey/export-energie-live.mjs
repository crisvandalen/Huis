#!/usr/bin/env node
/**
 * Live energie-snapshot voor de VPS: leest de slimme meter + Enphase via de
 * Athom-cloud, haalt de EPEX-uurprijzen op en rekent ze om naar je Vattenfall
 * FlexPrijs (markt + opslag + energiebelasting). Schrijft:
 *
 *   dashboard/energie-live.json
 *
 * De live pagina dashboard/energie.html leest dit bestand en ververst zichzelf.
 *
 * Draaien:
 *   node scripts/homey/export-energie-live.mjs          # eenmalig
 *   node scripts/homey/export-energie-live.mjs --loop    # blijft draaien (30s)
 *
 * Als service (systemd) draai je 'm met --loop; zie docs/06-energie-live.md.
 *
 * Prijsopbouw (pas aan je contract aan via .env, anders defaults):
 *   FLEX_OPSLAG_KWH   inkoopvergoeding Vattenfall FlexPrijs  (EUR/kWh, incl btw)
 *   ENERGIEBELASTING  energiebelasting elektriciteit         (EUR/kWh, incl btw)
 *   TERUGLEVER_KWH    terugleververgoeding                   (EUR/kWh)
 * De EnergyZero-prijs is de kale marktprijs incl btw; belasting + opslag komen
 * daar bovenop voor de all-in leverprijs.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakHomeyApi } from './cloud-client.mjs';
import { werkKostenBij } from './kosten-bijwerken.mjs';
import { maakLaadadvies } from './laadadvies.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
const UIT = resolve(ROOT, 'dashboard', 'energie-live.json');

const LOOP = process.argv.includes('--loop');
const INTERVAL = 30_000;

// --- .env voor prijs-parameters (cloud-client laadt 'm ook, maar we lezen hier
//     de energie-specifieke waarden apart) ---
function env(key, def) {
  const v = process.env[key];
  return v === undefined || v === '' ? def : v;
}
try {
  for (const r of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const t = r.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 1) continue;
    const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch { /* geen .env */ }

const OPSLAG = parseFloat(env('FLEX_OPSLAG_KWH', '0.02'));
const BELASTING = parseFloat(env('ENERGIEBELASTING', '0.1316'));
const TERUGLEVER = parseFloat(env('TERUGLEVER_KWH', '0.05'));

const METER = '11df88ce'; // Kaifa via HomeWizard
const ENPHASE = '6c2cad3e'; // Enphase ("Cris van Dalen"); valt terug op driver 'enphase'

function capVal(dev, cap) {
  const c = dev && dev.capabilitiesObj && dev.capabilitiesObj[cap];
  return c ? c.value : null;
}
function vindDevice(devices, idFragment, driverFragment) {
  const arr = Object.values(devices);
  return arr.find(d => (d.id || '').includes(idFragment))
      || arr.find(d => ((d.driverId || d.driverUri || '') + '').includes(driverFragment));
}

// --- EPEX-prijzen via EnergyZero (kale marktprijs incl btw) ---
let prijsCache = { datum: null, prijzen: null };
async function haalPrijzen() {
  const nu = new Date();
  const datum = nu.toISOString().slice(0, 10);
  if (prijsCache.datum === datum && prijsCache.prijzen) return prijsCache.prijzen;
  const van = `${datum}T00:00:00.000Z`;
  const tot = `${datum}T23:00:00.000Z`;
  const url = `https://api.energyzero.nl/v1/energyprices?fromDate=${van}&tillDate=${tot}&interval=4&usageType=1&inclBtw=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('EnergyZero HTTP ' + res.status);
  const j = await res.json();
  const prijzen = (j.Prices || []).map(p => ({
    tijd: p.readingDate,                 // UTC
    markt: p.price,                      // EUR/kWh incl btw
    allin: p.price + BELASTING + OPSLAG, // Vattenfall FlexPrijs all-in
  }));
  prijsCache = { datum, prijzen };
  return prijzen;
}

function prijsNu(prijzen) {
  const nu = Date.now();
  let huidige = null;
  for (const p of prijzen) {
    const t = new Date(p.tijd).getTime();
    if (t <= nu && t + 3600_000 > nu) { huidige = p; break; }
  }
  return huidige || prijzen[0] || null;
}

async function snapshot(api) {
  const devices = await api.devices.getDevices();
  const meter = vindDevice(devices, METER, 'homewizard');
  const enphase = vindDevice(devices, ENPHASE, 'enphase');

  const netW = capVal(meter, 'measure_power');       // + = afname, - = teruglevering
  const zonW = capVal(enphase, 'measure_power') || 0; // productie nu (W)
  const huisW = (netW || 0) + zonW;                   // verbruik nu = zon + net

  const prijzen = await haalPrijzen().catch(e => { console.error('prijs:', e.message); return prijsCache.prijzen || []; });
  const nu = prijsNu(prijzen);
  const allinLijst = prijzen.map(p => p.allin);
  const min = allinLijst.length ? Math.min(...allinLijst) : null;
  const max = allinLijst.length ? Math.max(...allinLijst) : null;
  const gesorteerd = [...allinLijst].sort((a, b) => a - b);
  const rang = nu ? gesorteerd.indexOf(nu.allin) : -1; // 0 = goedkoopste uur

  // Batterij-nu-advies (indicatief).
  let advies = 'wachten', kleur = 'grijs', reden = '';
  const drempelLaag = gesorteerd.length ? gesorteerd[Math.floor(gesorteerd.length * 0.25)] : Infinity;
  const drempelHoog = gesorteerd.length ? gesorteerd[Math.ceil(gesorteerd.length * 0.75)] : -Infinity;
  if (netW !== null && netW < -50) { advies = 'laden'; kleur = 'groen'; reden = 'je levert nu terug — een batterij zou dit opslaan i.p.v. goedkoop terugleveren'; }
  else if (nu && nu.allin <= drempelLaag) { advies = 'laden'; kleur = 'groen'; reden = 'stroom is nu goedkoop — laden voor later'; }
  else if (netW !== null && netW > 50 && nu && nu.allin >= drempelHoog) { advies = 'ontladen'; kleur = 'oranje'; reden = 'je neemt af terwijl stroom duur is — een batterij zou dit nu dekken'; }
  else if (netW !== null && netW > 50) { advies = 'ontladen'; kleur = 'oranje'; reden = 'je neemt af uit het net'; }

  return {
    tijd: new Date().toISOString(),
    verbonden: !!meter,
    vermogen: { net_w: netW, zon_w: zonW, huis_w: huisW },
    vandaag: {
      zon_kwh: capVal(enphase, 'meter_power.day'),
      net_dag_kwh: capVal(meter, 'meter_power.daily'),
      import_totaal_kwh: capVal(meter, 'meter_power.consumed'),
      teruglevering_totaal_kwh: capVal(meter, 'meter_power.returned'),
      gas_dag_m3: capVal(meter, 'meter_gas.daily'),
    },
    prijs: nu ? {
      markt: nu.markt, allin: nu.allin, min, max, rang, aantal: gesorteerd.length,
      terugleververgoeding: TERUGLEVER,
    } : null,
    prijzen_vandaag: prijzen.map(p => ({ tijd: p.tijd, markt: p.markt, allin: p.allin })),
    tarief: { opslag: OPSLAG, belasting: BELASTING, teruglever: TERUGLEVER },
    batterij: { advies, kleur, reden },
  };
}

async function schrijf(snap) {
  mkdirSync(dirname(UIT), { recursive: true });
  writeFileSync(UIT, JSON.stringify(snap, null, 2));
}

async function main() {
  const { api, homey } = await maakHomeyApi();
  console.error(`Verbonden met ${homey.name} via de cloud. Prijs all-in = markt + €${BELASTING} belasting + €${OPSLAG} opslag.`);
  const tik = async () => {
    try { const snap = await snapshot(api); await schrijf(snap);
      console.error(`${new Date().toLocaleTimeString('nl-NL')}  net ${snap.vermogen.net_w} W  zon ${snap.vermogen.zon_w} W  prijs €${snap.prijs ? snap.prijs.allin.toFixed(3) : '?'}  → ${snap.batterij.advies}`);
    } catch (e) { console.error('tik mislukt:', e.message); }
  };
  await tik();
  if (LOOP) {
    setInterval(tik, INTERVAL);
    // Kostenlogboek elk uur automatisch meebijwerken (via dezelfde verbinding).
    const kostenTik = async () => {
      try {
        const r = await werkKostenBij({ api });
        console.error(`${new Date().toLocaleTimeString('nl-NL')}  kosten bijgewerkt: ${r.dagenBijgewerkt} dagen, netto €${r.totalen.netto.toFixed(2)} totaal`);
      } catch (e) { console.error('kosten bijwerken mislukt:', e.message); }
    };
    await kostenTik();                 // meteen één keer bij de start
    setInterval(kostenTik, 3600_000);  // daarna elk uur
    // Laadadvies elk uur verversen (pikt de prijzen van morgen op ~13:00 vanzelf).
    const adviesTik = async () => {
      try {
        const a = await maakLaadadvies({ stil: true });
        const neg = (a.negatieve_uren || []).length;
        console.error(`${new Date().toLocaleTimeString('nl-NL')}  laadadvies: ${a.beste_venster ? a.beste_venster.label : '-'}${neg ? '  ⚠ ' + neg + ' negatieve uren' : ''}`);
      } catch (e) { console.error('laadadvies mislukt:', e.message); }
    };
    await adviesTik();
    setInterval(adviesTik, 3600_000);
  }
}

main().catch(e => { console.error('Mislukt:', e.message); process.exit(1); });
