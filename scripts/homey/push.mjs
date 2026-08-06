#!/usr/bin/env node
/**
 * push.mjs — stuurt een pushbericht naar de Homey-app (iPhone) via de LOKALE
 * Homey-API. De lokale API kan zelf geen notificatie aanmaken, maar wel de
 * notificatie-actiekaart uitvoeren (dezelfde kaart die de nachtslot-flow
 * gebruikt): homey:manager:notifications:create_notification, via runFlowCardAction.
 *
 * Draait op linuxcris of lokaal op de Mac — NIET vanuit de cloud/Cowork.
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

function vindNotificatieKaart(lijst) {
  const owner = k => k.uri || k.ownerUri || '';
  return lijst.find(k => owner(k) === 'homey:flowcardaction:homey:manager:notifications:create_notification')
    || lijst.find(k => /manager:notifications:create_notification/.test(owner(k) + ':' + (k.id || '')))
    || lijst.find(k => /notification/i.test(owner(k) + (k.id || '')));
}

export async function stuurPush(tekst) {
  laadEnv();
  const host = process.env.HOMEY_HOST;
  const token = process.env.HOMEY_API_KEY;
  if (!host || !token) throw new Error('HOMEY_HOST / HOMEY_API_KEY ontbreken in .env (lokale API vereist)');
  if (!tekst || !tekst.trim()) throw new Error('lege meldingstekst');

  const api = await HomeyAPI.createLocalAPI({ address: `http://${host}`, token });
  const acties = await api.flow.getFlowCardActions();
  const lijst = Array.isArray(acties) ? acties : Object.values(acties);
  const kaart = vindNotificatieKaart(lijst);
  if (!kaart) throw new Error('notificatie-actiekaart niet gevonden op deze Homey');

  const uri = kaart.uri || kaart.ownerUri;
  const arg = (kaart.args && kaart.args.find(a => a.type === 'text')?.name) || 'text';
  await api.flow.runFlowCardAction({ uri, id: kaart.id, args: { [arg]: tekst } });
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
