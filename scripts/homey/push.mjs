#!/usr/bin/env node
/**
 * push.mjs — stuurt een pushbericht naar de Homey-app (iPhone) via Homey's
 * lokale API (timeline-notificatie). Draait op linuxcris of lokaal op de Mac —
 * NIET vanuit de cloud/Cowork (die komt niet op het thuisnetwerk).
 *
 * CLI:   node scripts/homey/push.mjs "Je bericht"
 * Code:  import { stuurPush } from './push.mjs'; await stuurPush('tekst');
 *
 * .env: HOMEY_HOST (IP van Homey, bv. 192.168.2.174) + HOMEY_API_KEY.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const key = process.env.HOMEY_API_KEY;
  if (!host || !key) throw new Error('HOMEY_HOST / HOMEY_API_KEY ontbreken in .env');
  if (!tekst || !tekst.trim()) throw new Error('lege meldingstekst');

  const url = `http://${host}/api/manager/notifications/notification/`;
  // Homey verwacht { excerpt }. Voor de zekerheid proberen we ook de gewrapte
  // vorm; we stoppen bij de eerste die lukt.
  const varianten = [{ excerpt: tekst }, { notification: { excerpt: tekst } }];
  let laatste;
  for (const body of varianten) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) { laatste = e; continue; }
    const txt = await res.text();
    if (res.ok) return { ok: true, status: res.status, body: txt };
    laatste = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    if (![400, 404, 422].includes(res.status)) break; // andere fout: niet doorproberen
  }
  throw laatste ?? new Error('push mislukt');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const tekst = process.argv.slice(2).join(' ').trim();
  if (!tekst) { console.error('Gebruik: node scripts/homey/push.mjs "Je bericht"'); process.exit(1); }
  stuurPush(tekst)
    .then(r => console.log(`Push verstuurd (HTTP ${r.status}).`))
    .catch(e => { console.error('Push mislukt:', e.message); process.exit(1); });
}
