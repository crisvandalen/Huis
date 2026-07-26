#!/usr/bin/env node
// Eenmalige OAuth2-login bij de Athom-cloud + verificatie.
// Zonder argument: opent de login-URL en vangt de code automatisch op via
// http://localhost:8899/callback (moet matchen met de API-client), en wisselt
// hem direct in — sneller dan de korte geldigheid van de code.
// Met argument (fallback): node scripts/homey/cloud-auth.mjs <code>
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { maakCloud, TOKEN_PAD } from './cloud-client.mjs';

const cloud = maakCloud();
let code = process.argv[2];

if (await cloud.isLoggedIn()) {
  console.log('Al ingelogd (token in ' + TOKEN_PAD + ').');
} else {
  if (!code) {
    const redirect = process.env.HOMEY_REDIRECT_URL || process.env.HOMEY_CLOUD_REDIRECT_URI || 'http://localhost:8899/callback';
    const port = Number(new URL(redirect).port || 80);
    const url = await cloud.getLoginUrl();
    console.log('Open deze URL in je browser en log in met je Homey-account:');
    console.log('');
    console.log(url);
    console.log('');
    console.log('Dit script vangt de code automatisch op via ' + redirect + ' ...');
    try { spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } catch {}
    code = await new Promise((klaar, faal) => {
      const server = createServer((req, res) => {
        const q = new URL(req.url, 'http://localhost');
        const c = q.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(c ? '<h2>Gelukt - je kunt dit venster sluiten.</h2>' : '<h2>Geen code ontvangen.</h2>');
        if (c) { server.close(); klaar(c); }
      });
      server.on('error', faal);
      server.listen(port);
    });
    console.log('Code ontvangen, direct inwisselen ...');
  }
  try {
    await cloud.authenticateWithAuthorizationCode({ code });
  } catch (e) {
    console.error('Inwisselen van de code faalde: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
  console.log('Ingelogd; token opgeslagen in ' + TOKEN_PAD);
}

const user = await cloud.getAuthenticatedUser();
const homey = await user.getFirstHomey();
console.log('');
console.log('Homey:     ' + homey.name);
console.log('remoteUrl: ' + (homey.remoteUrl || '(onbekend)'));
const api = await homey.authenticate();
const devices = await api.devices.getDevices();
const zones = await api.zones.getZones();
console.log('');
console.log(Object.keys(devices).length + ' apparaten, ' + Object.keys(zones).length + ' zones opgehaald VIA DE CLOUD - de VPS-route werkt.');
