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
    failover: ["/api/failover/status", "/api/mwan/status", "/api/network/failover/status"],
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

  // Mapping afgestemd op RutOS 7.x (geverifieerd op RUTX12, fw 07.21).
  const ap = ruw.apparaat?.data ?? {};
  const ifs = ruw.interfaces?.data;
  const wl = ruw.draadloos?.data;
  const dhcp = ruw.dhcp?.data;
  const mob = Array.isArray(ruw.mobiel?.data)
    ? ruw.mobiel.data.find((m) => m.primary || m.state === "Connected") ?? ruw.mobiel.data[0]
    : null;

  const lan = Array.isArray(ifs) ? ifs.find((i) => i.id === "lan" || i.interface === "lan") : null;
  const wan = Array.isArray(ifs)
    ? ifs.find((i) => i.area_type === "wan" && i.is_up && (i.ipaddrs?.length))
    : null;

  // ssid's zitten in name: 'ap "Dalen_BackUP"' / 'sta "WifiDalenRUT"'
  const wifiNamen = Array.isArray(wl)
    ? [...new Set(wl.map((w) => (String(w.name ?? "").match(/"([^"]+)"/) || [])[1] || w.ssid)
        .filter(Boolean))]
    : [];

  // Failover-status: liefst uit de failover-API, anders afleiden uit de
  // WAN-interfaces (elke area_type=="wan" met z'n up/down-status).
  let failover = null;
  const fo = ruw.failover?.data;
  if (fo && typeof fo === "object") {
    const items = Array.isArray(fo) ? fo : Object.entries(fo).map(([k, v]) =>
      (typeof v === "object" ? { interface: k, ...v } : { interface: k, status: v }));
    const delen = items
      .map((i) => {
        const nm = i.interface ?? i.name ?? i.id;
        const st = i.status ?? i.state ?? (i.up === true ? "online" : i.up === false ? "offline" : null);
        return nm && st != null ? { nm, st: String(st) } : null;
      })
      .filter(Boolean)
      // 'notracking' = interface doet niet mee aan failover; niet tonen
      .filter((i) => i.st.toLowerCase() !== "notracking")
      .map((i) => `${i.nm}: ${i.st}`);
    if (delen.length) failover = delen.join(" · ");
  }
  if (!failover && Array.isArray(ifs)) {
    const wans = ifs.filter((i) => i.area_type === "wan");
    if (wans.length) {
      failover = wans
        .map((i) => `${i.name ?? i.id}: ${i.is_up ? "online" : "stand-by"}`)
        .join(" · ");
    }
  }

  const router = {
    opgehaald_op: new Date().toISOString(),
    online: true,
    failover,
    merk: "Teltonika",
    model: ap.static?.device_name ?? ap.static?.model ?? null,
    firmware: ap.static?.fw_version ?? null,
    uptime: uptimeTekst(Number(lan?.uptime)),
    wan_ip: (wan?.ipaddrs?.[0] ?? "").split("/")[0] || null,
    lan_ip: host,
    clients: Array.isArray(dhcp) ? dhcp.length : null,
    wifi: wifiNamen,
    // 4G-details (RUTX12): getoond op de Netwerk-tab
    verbinding: mob?.conntype ?? null,
    provider: mob?.operator && mob.operator !== "N/A" ? mob.operator : null,
    signaal: Number.isFinite(mob?.rsrp) ? `${mob.rsrp} dBm (RSRP)` : null,
    modem_temp: Number.isFinite(mob?.temperature) ? `${mob.temperature} °C` : null,
  };
  writeFileSync(resolve(EXPORT_DIR, "router.json"), JSON.stringify(router, null, 1));

  console.log("\nSamenvatting:");
  for (const [k, v] of Object.entries(router)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log(`\nGeschreven: ${resolve(EXPORT_DIR, "router.json")} (+ router-ruw.json)`);
  console.log("Staat er ergens null waar je wél een waarde verwacht? Stuur de output door.");
}

main().catch((e) => { console.error("Mislukt:", e.message); process.exit(1); });
