#!/usr/bin/env node
/**
 * Leest een Teltonika-router (RutOS 7.x REST-API) uit en schrijft
 * inventaris/export/router.json voor het Netwerk-tabblad.
 *
 * Vereist in .env:
 *   ROUTER_HOST=192.168.1.1      (LAN-IP van de router)
 *   ROUTER_USER=admin
 *   ROUTER_PASS=...
 *
 * Draai dit thuis (op de Mac) — de router is alleen op het LAN bereikbaar.
 * Het script probeert per onderwerp meerdere bekende endpoints (verschilt per
 * RutOS-versie) en meldt wat het vond; de ruwe antwoorden gaan naar
 * router-ruw.json zodat de mapping bij te stellen is.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// RutOS gebruikt een self-signed certificaat op het LAN; dat is hier oké.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXPORT_DIR = resolve(ROOT, "inventaris/export");

function laadEnv() {
  try {
    for (const regel of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}

async function post(basis, pad, body, token) {
  const res = await fetch(`${basis}${pad}`, {
    method: "POST",
    headers: { "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const tekst = await res.text();
  let json; try { json = JSON.parse(tekst); } catch { json = { _ruw: tekst.slice(0, 200) }; }
  return { status: res.status, json };
}

async function get(basis, pad, token) {
  const res = await fetch(`${basis}${pad}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  const tekst = await res.text();
  let json; try { json = JSON.parse(tekst); } catch { json = { _ruw: tekst.slice(0, 200) }; }
  return { status: res.status, json };
}

function uptimeTekst(sec) {
  if (!Number.isFinite(sec)) return null;
  const d = Math.floor(sec / 86400), u = Math.floor((sec % 86400) / 3600),
        m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${u}u` : (u ? `${u}u ${m}m` : `${m}m`);
}

async function main() {
  laadEnv();
  const host = process.env.ROUTER_HOST;
  const user = process.env.ROUTER_USER || "admin";
  const pass = process.env.ROUTER_PASS;
  if (!host || !pass) {
    console.error("ROUTER_HOST en/of ROUTER_PASS ontbreken in .env");
    process.exit(1);
  }

  // https eerst (RutOS-standaard), dan http.
  let basis = null, token = null, loginInfo = null;
  for (const b of [`https://${host}`, `http://${host}`]) {
    try {
      const r = await post(b, "/api/login", { username: user, password: pass });
      loginInfo = `${b} → HTTP ${r.status}`;
      token = r.json?.data?.token ?? r.json?.token ?? null;
      if (r.status === 200 && token) { basis = b; break; }
    } catch (e) {
      loginInfo = `${b} → ${e.cause?.code ?? e.message}`;
    }
  }
  if (!basis) {
    console.error(`Inloggen mislukt (laatste poging: ${loginInfo}).`);
    console.error("Check: klopt het IP, en staat de API aan (standaard wel op RutOS 7)?");
    process.exit(1);
  }
  console.log(`Ingelogd op ${basis}`);

  // Per onderwerp meerdere kandidaat-endpoints; de eerste die antwoordt wint.
  const ONDERWERPEN = {
    apparaat: ["/api/system/device/status", "/api/system/deviceinfo/status"],
    systeem: ["/api/system/status", "/api/system/usage/status"],
    interfaces: ["/api/network/interfaces/status", "/api/interfaces/status"],
    draadloos: ["/api/wireless/interfaces/status", "/api/wireless/status"],
    wifi_clients: ["/api/wireless/devices/status", "/api/wireless/clients/status"],
    dhcp: ["/api/dhcp/leases/ipv4/status", "/api/dhcp/leases/status", "/api/dhcp/status"],
    mobiel: ["/api/mobile/modems/status", "/api/modems/status"],
  };

  const ruw = {};
  for (const [naam, paden] of Object.entries(ONDERWERPEN)) {
    for (const pad of paden) {
      try {
        const r = await get(basis, pad, token);
        if (r.status === 200) { ruw[naam] = { pad, data: r.json?.data ?? r.json }; break; }
        ruw[naam] = ruw[naam] ?? { pad, status: r.status };
      } catch (e) {
        ruw[naam] = ruw[naam] ?? { pad, fout: e.message };
      }
    }
    const ok = ruw[naam]?.data !== undefined;
    console.log(`  ${ok ? "ok " : "-- "} ${naam.padEnd(13)} ${ruw[naam]?.pad ?? ""}${ok ? "" : ` (HTTP ${ruw[naam]?.status ?? "?"})`}`);
  }

  mkdirSync(EXPORT_DIR, { recursive: true });
  writeFileSync(resolve(EXPORT_DIR, "router-ruw.json"), JSON.stringify(ruw, null, 1));

  // Best-effort mapping naar het dashboard-formaat.
  const ap = ruw.apparaat?.data ?? {};
  const sys = ruw.systeem?.data ?? {};
  const ifs = ruw.interfaces?.data;
  const wl = ruw.draadloos?.data;
  const dhcp = ruw.dhcp?.data;
  const wcl = ruw.wifi_clients?.data;

  const wan = Array.isArray(ifs)
    ? ifs.find((i) => /wan|mob/i.test(`${i.name ?? i.id ?? ""}`) && (i.ipv4_address || i.ip_address || i.ipaddr))
    : null;
  const wifiNamen = Array.isArray(wl)
    ? [...new Set(wl.map((w) => w.ssid).filter(Boolean))]
    : [];
  const aantalClients =
    (Array.isArray(wcl) ? wcl.length : null) ??
    (Array.isArray(dhcp) ? dhcp.length : (Array.isArray(dhcp?.leases) ? dhcp.leases.length : null));

  const router = {
    opgehaald_op: new Date().toISOString(),
    online: true,
    merk: "Teltonika",
    model: ap.model ?? ap.name ?? ap.device_name ?? null,
    firmware: ap.firmware ?? ap.fw_version ?? ap.version ?? null,
    uptime: uptimeTekst(Number(sys.uptime ?? ap.uptime)) ?? null,
    wan_ip: wan?.ipv4_address ?? wan?.ip_address ?? wan?.ipaddr ?? null,
    lan_ip: host,
    clients: aantalClients,
    wifi: wifiNamen,
  };
  writeFileSync(resolve(EXPORT_DIR, "router.json"), JSON.stringify(router, null, 1));

  console.log("\nSamenvatting:");
  for (const [k, v] of Object.entries(router)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log(`\nGeschreven: ${resolve(EXPORT_DIR, "router.json")} (+ router-ruw.json)`);
  console.log("Staat er ergens null waar je wél een waarde verwacht? Stuur de output door.");
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
