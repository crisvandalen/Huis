#!/usr/bin/env node
// Herbruikbare cloud-verbinding met Homey Pro via OAuth2 (Athom-cloud).
// Voor gebruik vanaf een VPS of elke machine buiten het LAN.
// Token wordt bewaard in scripts/homey/.homey-cloud-token.json (gitignored).
//
// Vereist in .env:
//   HOMEY_CLIENT_ID=      (Homey Developer Tools -> API Clients)
//   HOMEY_CLIENT_SECRET=  (idem; redirect URL van de client: http://localhost)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AthomCloudAPI } from 'homey-api';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HIER, '../..');
export const TOKEN_PAD = resolve(HIER, '.homey-cloud-token.json');

export function laadEnv() {
  try {
    for (const regel of readFileSync(resolve(ROOT, '.env'), 'utf8').split(String.fromCharCode(10))) {
      const t = regel.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* geen .env */ }
}

class FileStore extends AthomCloudAPI.StorageAdapter {
  async get() {
    try { return JSON.parse(readFileSync(TOKEN_PAD, 'utf8')); } catch { return {}; }
  }
  async set(waarde) {
    writeFileSync(TOKEN_PAD, JSON.stringify(waarde, null, 2));
  }
}

export function maakCloud() {
  laadEnv();
  const clientId = process.env.HOMEY_CLIENT_ID || process.env.HOMEY_CLOUD_CLIENT_ID;
  const clientSecret = process.env.HOMEY_CLIENT_SECRET || process.env.HOMEY_CLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('HOMEY_CLIENT_ID en/of HOMEY_CLIENT_SECRET ontbreken in .env.');
    console.error('Maak een API Client aan op https://tools.developer.homey.app (redirect URL: http://localhost).');
    process.exit(1);
  }
  return new AthomCloudAPI({
    clientId,
    clientSecret,
    redirectUrl: process.env.HOMEY_REDIRECT_URL || process.env.HOMEY_CLOUD_REDIRECT_URI || 'http://localhost',
    store: new FileStore(),
  });
}

// Geeft { homey, api } terug; api is een geauthenticeerde HomeyAPI via de cloud.
export async function maakHomeyApi() {
  const cloud = maakCloud();
  if (!(await cloud.isLoggedIn())) {
    console.error('Nog niet ingelogd bij de Athom-cloud. Draai eerst: make cloud-auth');
    process.exit(1);
  }
  const user = await cloud.getAuthenticatedUser();
  const homey = await user.getFirstHomey();
  const api = await homey.authenticate();
  return { homey, api };
}
