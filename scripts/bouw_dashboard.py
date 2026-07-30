#!/usr/bin/env python3
"""Bouwt dashboard/index.html uit de exports in inventaris/export/.

Eén zelfstandig HTML-bestand: dubbelklikken opent het, licht/donker volgt het
systeem. Het is een momentopname van de laatste `make homey` — geen live
verbinding.

Leest bij voorkeur homey-ruw.json (daar zitten de actuele waarden in) en valt
terug op homey.json.
"""

from __future__ import annotations

import html
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "inventaris" / "export"
UIT = ROOT / "dashboard" / "index.html"

KLASSE_ICOON = {
    "light": "💡", "sensor": "◉", "thermostat": "🌡", "lock": "🔒",
    "doorbell": "🔔", "remote": "🎛", "sunshade": "⛱", "heater": "♨",
    "camera": "📷", "other": "·",
}


def lees(naam: str):
    p = EXPORT_DIR / naam
    return json.loads(p.read_text()) if p.exists() else None


def esc(x) -> str:
    return html.escape(str(x if x is not None else ""))


def verzamel():
    """Combineert homey-ruw (waarden) met homey.json (nette zones)."""
    ruw = lees("homey-ruw.json")
    net = lees("homey.json")
    if not ruw and not net:
        raise SystemExit("Geen export gevonden. Draai eerst: make homey")

    zone_per_id = {}
    if net:
        for a in net.get("apparaten", []):
            zone_per_id[a["id"]] = a.get("zone")

    apparaten = []
    if ruw and ruw.get("data", {}).get("devices"):
        for d in ruw["data"]["devices"].values():
            caps = {k: (v or {}).get("value") for k, v in (d.get("capabilitiesObj") or {}).items()}
            apparaten.append({
                "id": d.get("id"),
                "naam": d.get("name"),
                "zone": zone_per_id.get(d.get("id")),
                "klasse": d.get("class"),
                "driver": str(d.get("driverId") or d.get("driverUri") or ""),
                "beschikbaar": d.get("available", True),
                "caps": caps,
            })
    elif net:
        for a in net.get("apparaten", []):
            apparaten.append({**a, "caps": {}})

    flows, adv = [], []
    if ruw and ruw.get("data"):
        flows = list((ruw["data"].get("flows") or {}).values())
        adv = list((ruw["data"].get("advanced_flows") or {}).values())
    elif net:
        flows = [{"name": f["naam"], "enabled": f["aan"]} for f in net.get("flows", [])]

    stamp = (ruw or net).get("opgehaald_op", "")
    return apparaten, flows, adv, stamp


def kpis(apparaten):
    """Bepaalt de koptegels uit de live waarden."""
    vind = lambda **crit: next(
        (a for a in apparaten if all(a.get(k) == v for k, v in crit.items())), None)

    p1 = next((a for a in apparaten if "measure_power" in a["caps"]), None)
    thermo = next((a for a in apparaten if a["klasse"] == "thermostat"
                   and "woonkamer" in (a["naam"] or "").lower()), None) \
        or next((a for a in apparaten if a["klasse"] == "thermostat"), None)
    slot = next((a for a in apparaten if a["klasse"] == "lock"), None)
    scherm = next((a for a in apparaten if a["klasse"] == "sunshade"), None)
    lampen = [a for a in apparaten if a["klasse"] == "light"]
    aan = [a for a in lampen if a["caps"].get("onoff")]

    tegels = []

    # KNMI-weerapparaat (voor de controle van de zonwering-condities).
    # De app gebruikt eigen veldnamen: current_temp, recap/expected_today_recap,
    # wind_speed_k_m_h, expected_today_max_temp, expected_today_sunshine.
    knmi = next((a for a in apparaten if "knmi" in a.get("driver", "").lower()), None)
    if knmi:
        c = knmi["caps"]
        buiten = c.get("current_temp", c.get("measure_temperature"))
        recap = c.get("recap") or c.get("expected_today_recap")
        wind = c.get("wind_speed_k_m_h", c.get("measure_wind_strength"))
        maxt = c.get("expected_today_max_temp")
        zonkans = c.get("expected_today_sunshine")
        sub = " · ".join(s for s in (
            recap,
            f"max {maxt:g}°" if isinstance(maxt, (int, float)) else None,
            f"zonkans {zonkans:g}%" if isinstance(zonkans, (int, float)) else None,
            f"wind {wind:.0f} km/u" if isinstance(wind, (int, float)) else None,
        ) if s)
        if buiten is not None:
            tegels.append(("Buiten (KNMI)", f"{buiten:.1f}", "°C", sub or None))
        elif recap:
            tegels.append(("Weer (KNMI)", recap, "", None))

    if p1:
        w = p1["caps"].get("measure_power")
        kwh = p1["caps"].get("meter_power.daily")
        gas = p1["caps"].get("meter_gas.daily")
        if w is not None:
            if w < 0:
                tegels.append(("Stroom nu", f"{abs(w):.0f}", "W", "levert terug ↩ (zon)"))
            else:
                tegels.append(("Stroom nu", f"{w:.0f}", "W", "afname van het net"))
        if kwh is not None:
            tegels.append(("Stroom vandaag", f"{kwh:.1f}", "kWh", None))
        if gas is not None:
            tegels.append(("Gas vandaag", f"{gas:.2f}", "m³", None))
    if thermo:
        t = thermo["caps"].get("measure_temperature")
        doel = thermo["caps"].get("target_temperature")
        if t is not None:
            tegels.append(("Woonkamer", f"{t:.1f}", "°C",
                           f"doel {doel:g}°" if doel is not None else None))
    tegels.append(("Lampen aan", str(len(aan)), f"van {len(lampen)}",
                   ", ".join(a["naam"] for a in aan[:3]) if aan else "alles uit"))
    if scherm:
        st = scherm["caps"].get("windowcoverings_state")
        vert = {"down": "dicht", "up": "open", "idle": "stil"}.get(st, st or "?")
        tegels.append(("Serre-scherm", vert, "", None))
    return tegels


def statusmeldingen(apparaten):
    """Dingen die aandacht vragen — met icoon en tekst, nooit alleen kleur."""
    meldingen = []
    slot = next((a for a in apparaten if a["klasse"] == "lock"), None)
    if slot and slot["caps"].get("locked") is False:
        meldingen.append(("warning", "⚠", f"{slot['naam'].capitalize()} is niet op slot"))
    for a in apparaten:
        if a["caps"].get("alarm_contact") is True:
            meldingen.append(("warning", "⚠", f"Contact open: {a['naam']}"))
        if not a.get("beschikbaar", True):
            meldingen.append(("serious", "✖", f"Offline: {a['naam']}"))
        b = a["caps"].get("measure_battery")
        if isinstance(b, (int, float)) and b < 20:
            meldingen.append(("warning", "⚠", f"Batterij laag ({b:.0f}%): {a['naam']}"))
    return meldingen


def main() -> None:
    apparaten, flows, adv, stamp = verzamel()
    tegels = kpis(apparaten)
    meldingen = statusmeldingen(apparaten)

    per_zone = Counter((a["zone"] or "Onbekend") for a in apparaten)
    zones_sorted = sorted(per_zone.items(), key=lambda kv: -kv[1])
    maxn = max(per_zone.values()) if per_zone else 1

    flows_aan = sum(1 for f in flows if f.get("enabled"))
    adv_aan = sum(1 for f in adv if f.get("enabled"))

    try:
        tijd = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone()
        stamp_net = tijd.strftime("%d-%m-%Y %H:%M")
    except Exception:
        stamp_net = stamp or "?"

    # --- bouwstenen -------------------------------------------------------
    tegel_html = "".join(
        f'''<div class="tegel"><div class="tegel-label">{esc(lab)}</div>
        <div class="tegel-waarde">{esc(val)}<span class="tegel-eenheid">{esc(een)}</span></div>
        {f'<div class="tegel-sub">{esc(sub)}</div>' if sub else ''}</div>'''
        for lab, val, een, sub in tegels)

    melding_html = "".join(
        f'<div class="melding melding-{soort}"><span aria-hidden="true">{icoon}</span> {esc(tekst)}</div>'
        for soort, icoon, tekst in meldingen) or \
        '<div class="melding melding-ok"><span aria-hidden="true">✓</span> Geen bijzonderheden</div>'

    # staafdiagram: apparaten per ruimte (één reeks → één kleur, geen legenda)
    staven = ""
    for zone, n in zones_sorted:
        breedte = n / maxn * 100
        staven += f'''<div class="rij" data-tip="{esc(zone)}: {n} apparaten">
          <div class="rij-label">{esc(zone)}</div>
          <div class="rij-track"><div class="rij-bar" style="width:{breedte:.1f}%"></div></div>
          <div class="rij-waarde">{n}</div></div>'''

    # kamers
    kamers = ""
    for zone, _ in zones_sorted:
        items = ""
        for a in sorted((x for x in apparaten if (x["zone"] or "Onbekend") == zone),
                        key=lambda x: str(x["naam"])):
            icoon = KLASSE_ICOON.get(a["klasse"], "·")
            status = ""
            c = a["caps"]
            if a["klasse"] == "light":
                status = "aan" if c.get("onoff") else "uit"
            elif "measure_temperature" in c and c["measure_temperature"] is not None:
                status = f"{c['measure_temperature']:.1f}°"
            elif "locked" in c:
                status = "op slot" if c.get("locked") else "open"
            elif "windowcoverings_state" in c:
                status = {"down": "dicht", "up": "open"}.get(c.get("windowcoverings_state"), "")
            elif "alarm_motion" in c:
                status = "beweging" if c.get("alarm_motion") else "rustig"
            aanklas = " apparaat-aan" if (a["klasse"] == "light" and c.get("onoff")) else ""
            items += (f'<li class="apparaat{aanklas}"><span class="app-icoon" aria-hidden="true">{icoon}</span>'
                      f'<span class="app-naam">{esc(a["naam"])}</span>'
                      f'<span class="app-status">{esc(status)}</span></li>')
        kamers += f'<section class="kamer"><h3>{esc(zone)}</h3><ul>{items}</ul></section>'

    flowlijst = "".join(
        f'<li><span class="dot {"dot-aan" if f.get("enabled") else "dot-uit"}" aria-hidden="true"></span>'
        f'{esc(f.get("name"))}<span class="app-status">{"aan" if f.get("enabled") else "uit"}</span></li>'
        for f in sorted(adv + flows, key=lambda f: (not f.get("enabled"), str(f.get("name")))))

    doc = f"""<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<title>Huis — dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  .viz-root {{
    color-scheme: light;
    --surface-1:#fcfcfb; --surface-2:#f1f0ee; --rand:#e3e2df;
    --text-primary:#0b0b0b; --text-secondary:#52514e; --text-muted:#8a8984;
    --series-1:#2a78d6;
    --st-good:#008300; --st-warn:#eda100; --st-serious:#e34948;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:where(:not([data-theme="light"])) .viz-root {{
      color-scheme: dark;
      --surface-1:#1a1a19; --surface-2:#242423; --rand:#33332f;
      --text-primary:#ffffff; --text-secondary:#c3c2b7; --text-muted:#8a8984;
      --series-1:#3987e5;
      --st-good:#3fae3f; --st-warn:#c98500; --st-serious:#e66767;
    }}
  }}
  * {{ box-sizing:border-box; }}
  body.viz-root {{ margin:0; background:var(--surface-1); color:var(--text-primary);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    padding:1.5rem clamp(1rem,4vw,3rem) 3rem; }}
  h1 {{ font-size:1.35rem; margin:0; }}
  h2 {{ font-size:.85rem; text-transform:uppercase; letter-spacing:.05em;
       color:var(--text-secondary); margin:2.2rem 0 .8rem; }}
  h3 {{ font-size:.95rem; margin:0 0 .4rem; }}
  .sub {{ color:var(--text-muted); font-size:.85rem; margin:.2rem 0 0; }}

  .tegels {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
             gap:.75rem; margin-top:1.2rem; }}
  .tegel {{ background:var(--surface-2); border-radius:12px; padding:.9rem 1rem; }}
  .tegel-label {{ font-size:.75rem; text-transform:uppercase; letter-spacing:.05em;
                  color:var(--text-secondary); }}
  .tegel-waarde {{ font-size:2rem; font-weight:650; line-height:1.15; margin-top:.15rem; }}
  .tegel-eenheid {{ font-size:.85rem; font-weight:400; color:var(--text-secondary);
                    margin-left:.3rem; }}
  .tegel-sub {{ font-size:.78rem; color:var(--text-muted); margin-top:.1rem;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}

  .meldingen {{ display:flex; flex-wrap:wrap; gap:.5rem; margin-top:1rem; }}
  .melding {{ font-size:.85rem; border-radius:99px; padding:.3rem .85rem;
              background:var(--surface-2); }}
  .melding-warning span {{ color:var(--st-warn); }}
  .melding-serious span {{ color:var(--st-serious); }}
  .melding-ok span {{ color:var(--st-good); }}

  .grafiek {{ max-width:560px; }}
  .rij {{ display:grid; grid-template-columns:110px 1fr 2.2em; align-items:center;
          gap:.6rem; margin:.32rem 0; position:relative; }}
  .rij-label {{ font-size:.85rem; color:var(--text-secondary); text-align:right;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .rij-track {{ height:18px; }}
  .rij-bar {{ height:100%; max-height:18px; background:var(--series-1);
              border-radius:0 4px 4px 0; min-width:3px; }}
  .rij-waarde {{ font-size:.85rem; color:var(--text-primary); font-variant-numeric:tabular-nums; }}
  .rij:hover::after {{ content:attr(data-tip); position:absolute; left:112px; top:-1.9em;
      background:var(--text-primary); color:var(--surface-1); font-size:.78rem;
      padding:.15rem .6rem; border-radius:6px; white-space:nowrap; z-index:2; }}

  .kamers {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr));
             gap:.9rem; }}
  .kamer {{ border:1px solid var(--rand); border-radius:12px; padding:.8rem .95rem; }}
  .kamer ul {{ list-style:none; margin:0; padding:0; }}
  .apparaat {{ display:flex; align-items:baseline; gap:.5rem; padding:.18rem 0;
               font-size:.88rem; }}
  .app-icoon {{ width:1.2em; text-align:center; color:var(--text-muted); }}
  .apparaat-aan .app-icoon {{ color:var(--st-warn); }}
  .app-naam {{ flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .app-status {{ color:var(--text-muted); font-size:.8rem; }}

  .flows ul {{ list-style:none; margin:0; padding:0; columns:2 320px; }}
  .flows li {{ display:flex; align-items:center; gap:.55rem; padding:.22rem 0;
               font-size:.88rem; break-inside:avoid; }}
  .flows .app-status {{ margin-left:auto; }}
  .dot {{ width:8px; height:8px; border-radius:50%; flex:none;
          box-shadow:0 0 0 2px var(--surface-1); }}
  .dot-aan {{ background:var(--st-good); }}
  .dot-uit {{ background:var(--rand); }}
  footer {{ margin-top:3rem; color:var(--text-muted); font-size:.8rem; }}
  .kop {{ display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }}
  #ververs {{ font:inherit; font-size:.9rem; border:1px solid var(--rand);
      background:var(--surface-2); color:var(--text-primary); border-radius:99px;
      padding:.45rem 1.1rem; cursor:pointer; flex:none; }}
  #ververs:hover {{ border-color:var(--series-1); }}
  #ververs[disabled] {{ opacity:.55; cursor:wait; }}
</style></head>
<body class="viz-root">
<div class="kop">
  <div><h1>🏠 Huis — dashboard</h1>
  <p class="sub">Momentopname van {esc(stamp_net)}<span id="ververs-uitleg"> · ververs met <code>make homey &amp;&amp; make dashboard</code>, of start <code>make serve</code> voor een knop</span></p></div>
  <button id="ververs" hidden>↻ Ververs</button>
</div>

<div class="tegels">{tegel_html}</div>
<div class="meldingen">{melding_html}</div>

<h2>Apparaten per ruimte ({len(apparaten)} totaal)</h2>
<div class="grafiek">{staven}</div>

<h2>Ruimtes</h2>
<div class="kamers">{kamers}</div>

<h2>Flows ({flows_aan + adv_aan} aan, {len(flows) + len(adv) - flows_aan - adv_aan} uit)</h2>
<div class="flows"><ul>{flowlijst}</ul></div>

<footer>Gegenereerd door scripts/bouw_dashboard.py · bron: inventaris/export/ ·
project <code>~/projects/Prive/huis</code></footer>
<script>
  // De ververs-knop werkt alleen als de pagina via make serve draait —
  // op file:// is er niets dat de export kan uitvoeren.
  const knop = document.getElementById("ververs");
  if (location.protocol.startsWith("http")) {{
    knop.hidden = false;
    document.getElementById("ververs-uitleg").hidden = true;
    knop.addEventListener("click", async () => {{
      knop.disabled = true; knop.textContent = "… bezig";
      try {{
        const r = await fetch("/ververs", {{ method: "POST" }});
        const j = await r.json();
        if (j.gelukt) {{ location.reload(); return; }}
        alert("Verversen mislukt:\\n\\n" + j.log);
      }} catch (e) {{
        alert("Kon de server niet bereiken: " + e.message);
      }}
      knop.disabled = false; knop.textContent = "↻ Ververs";
    }});
  }}
</script>
</body></html>
"""

    UIT.parent.mkdir(parents=True, exist_ok=True)
    UIT.write_text(doc)
    print(f"{len(apparaten)} apparaten, {len(tegels)} tegels, {len(meldingen)} meldingen -> {UIT}")


if __name__ == "__main__":
    main()
