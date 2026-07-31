#!/usr/bin/env node
/**
 * Dumpt alle beschikbare Homey Insights-logs naar
 * inventaris/export/insights-logs.json (id, uri, titel, type, eenheid).
 * Puur uitlezen — verandert niets. Draai: node scripts/homey/insights-logs.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakHomeyApi } from './cloud-client.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const EXPORT = resolve(HIER, '../../inventaris/export');

(async () => {
  const { api } = await maakHomeyApi();
  const logsObj = await api.insights.getLogs();
  const logs = Array.isArray(logsObj) ? logsObj : Object.values(logsObj);
  const simpel = logs.map(l => ({
    id: l.id, uri: l.uri, title: l.title, type: l.type, units: l.units,
  })).sort((a, b) => (a.uri + a.id).localeCompare(b.uri + b.id));

  mkdirSync(EXPORT, { recursive: true });
  const pad = resolve(EXPORT, 'insights-logs.json');
  writeFileSync(pad, JSON.stringify(simpel, null, 2));
  console.log(`${simpel.length} logs -> ${pad}`);
  // toon de energie-gerelateerde direct in de console
  for (const l of simpel) if (/power|energy|meter/i.test(l.id + l.uri))
    console.log(`  ${l.uri}  ${l.id}   [${l.units || ''}]  ${l.title || ''}`);
})().catch(e => { console.error(e); process.exit(1); });
