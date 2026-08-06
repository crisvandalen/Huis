#!/usr/bin/env node
/**
 * laadadvies-push.mjs — berekent het laadadvies (verse prijzen) en stuurt een
 * korte samenvatting als pushbericht naar de Homey-app (iPhone).
 *
 * Bouwt voort op maakLaadadvies() (008) en stuurPush() (009/push.mjs).
 * Stuurt ALLEEN een melding — schakelt niets aan. Draait op linuxcris (LAN).
 *
 * Draaien:  node scripts/homey/laadadvies-push.mjs
 * Cron (linuxcris), dagelijks 13:15:
 *   15 13 * * *  cd ~/huis && node scripts/homey/laadadvies-push.mjs >> ~/laadadvies-push.log 2>&1
 */
import { maakLaadadvies } from './laadadvies.mjs';
import { stuurPush } from './push.mjs';

const eur = n => '€' + Number(n).toFixed(2).replace('.', ',');
const eur3 = n => '€' + Number(n).toFixed(3).replace('.', ',');

function meldingTekst(a) {
  const r = [];
  if (a.beste_venster) {
    r.push(`⚡ Laadadvies — goedkoopst ${a.beste_venster.label} (gem ${eur3(a.beste_venster.gem)}/kWh, ~${eur(a.besparing_per_dag)} voordeel).`);
  } else {
    r.push('⚡ Laadadvies — geen aaneengesloten venster gevonden.');
  }
  if (a.goedkoopste_uur) r.push(`Goedkoopste uur: ${a.goedkoopste_uur.label} (${eur3(a.goedkoopste_uur.allin)}/kWh).`);
  if (a.negatieve_uren && a.negatieve_uren.length) {
    r.push(`Negatieve marktprijs: ${a.negatieve_uren.map(n => n.label).join(', ')} — laad extra / op zon.`);
  }
  return r.join('\n');
}

async function main() {
  const advies = await maakLaadadvies({ stil: true });
  const tekst = meldingTekst(advies);
  console.log('Melding:\n' + tekst + '\n');
  await stuurPush(tekst);
  console.log('Push verstuurd.');
}

main().catch(e => { console.error('Mislukt:', e.message); process.exit(1); });
