#!/usr/bin/env node
/**
 * push.mjs — stuurt een pushbericht naar de Homey-app (iPhone) via de LOKALE
 * Homey-API, met de homey-api-library (createLocalAPI + notifications). Draait op
 * linuxcris of lokaal op de Mac — NIET vanuit de cloud/Cowork (die komt niet op
 * het thuisnetwerk).
 *
 * CLI:   node scripts/homey/push.mjs "Je bericht"
 * Code:  import { stuurPush } from './push.mjs'; await stuurPush('tekst');
 *
 * .env: HOMEY_HOST (IP van Homey, bv. 192.168.2.174) + HOMEY_API_KEY (lokale key).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HomeyAPI } from 'homey-api';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function laadEnv() {
  try {
    for (const r of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
      const t = r.trim(); if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('='); if (i < 1) continue;
      const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
    }
  } catch { /* geen .env: dan verwachten we echte omgevingsvariabelen */ }
}

export async function stuurPush(tekst) {
  laadEnv();
  const host = process.env.HOMEY_HOST;
  const token = process.env.HOMEY_API_KEY;
  if (!host || !token) throw new Error('HOMEY_HOST / HOMEY_API_KEY ontbreken in .env (lokale API vereist)');
  if (!tekst || !tekst.trim()) throw new Error('lege meldingstekst');

  const api = await HomeyAPI.createLocalAPI({ address: `http://${host}`, token });
  if (!api.notifications || typeof api.notifications.createNotification !== 'function') {
    throw new Error('notifications.createNotification niet beschikbaar op deze Homey-API');
  }
  await api.notifications.createNotification({ excerpt: tekst });
  return { ok: true };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const tekst = process.argv.slice(2).join(' ').trim();
  if (!tekst) { console.error('Gebruik: node scripts/homey/push.mjs "Je bericht"'); process.exit(1); }
  stuurPush(tekst)
    .then(() => console.log('Push verstuurd.'))
    .catch(e => { console.error('Push mislukt:', e.message); process.exit(1); });
}
