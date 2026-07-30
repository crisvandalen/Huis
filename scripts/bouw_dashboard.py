#!/usr/bin/env python3
"""Bouwt dashboard/index.html uit de exports in inventaris/export/.

Persoonlijke startpagina met tabbladen:

    Overzicht · Beveiliging · Sensors · Vannacht · Netwerk & router ·
    Mail & agenda · Energie · Huis

Eén zelfstandig HTML-bestand: dubbelklikken opent het, licht/donker volgt het
systeem. Het is een momentopname van de laatste `make homey` — geen live
verbinding. De tabbladen zijn client-side (een klein stukje JS), zodat het
bestand offline blijft werken.

Databronnen (allemaal optioneel; ontbreekt er één, dan blijft dat tabblad leeg
of toont het een uitleg):
  - homey-ruw.json / homey.json  → apparaten, sensoren, flows, energie
  - ring-log.json                → camera-beweging (voor "Vannacht")
  - mail-agenda.json             → mail + agenda (Cowork bakt dit mee)
  - router.json                  → routerstatus (lokaal netwerkscript)
"""

from __future__ import annotations

import html
import json
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    # Vaste weergave-tijdzone: tijden altijd in Amsterdamse tijd, ongeacht waar
    # het dashboard gebouwd wordt.
    LOKALE_TZ = ZoneInfo("Europe/Amsterdam")
except Exception:  # geen tzdata -> val terug op systeem-lokaal
    LOKALE_TZ = None

ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "inventaris" / "export"
UIT = ROOT / "dashboard" / "index.html"

# Nacht-venster voor het tabblad "Vannacht" (lokale uren).
NACHT_START_UUR = 22
NACHT_EIND_UUR = 8

WEEKDAGEN = ["maandag", "dinsdag", "woensdag", "donderdag",
             "vrijdag", "zaterdag", "zondag"]

KLASSE_ICOON = {
    "light": "💡", "sensor": "◉", "thermostat": "🌡", "lock": "🔒",
    "doorbell": "🔔", "remote": "🎛", "sunshade": "⛱", "heater": "♨",
    "camera": "📷", "solarpanel": "☀", "other": "·",
}

# Ring-camera's komen via de Amazon Ring-app binnen. Homey labelt ze als
# klasse "sensor", dus we herkennen ze aan de driver en behandelen ze apart.
RING_DRIVER = "com.amazon.ring"

# Volgorde + labels van de tabbladen.
TABS = [
    ("overzicht", "Overzicht"),
    ("beveiliging", "Beveiliging"),
    ("sensors", "Sensors"),
    ("vannacht", "Vannacht"),
    ("netwerk", "Netwerk & router"),
    ("mailagenda", "Mail & agenda"),
    ("energie", "Energie"),
    ("huis", "Huis"),
]


def is_ring(a) -> bool:
    return RING_DRIVER in (a.get("driver") or "")


def lees(naam: str):
    p = EXPORT_DIR / naam
    return json.loads(p.read_text()) if p.exists() else None


def esc(x) -> str:
    return html.escape(str(x if x is not None else ""))


def nu_lokaal() -> datetime:
    return datetime.now(LOKALE_TZ) if LOKALE_TZ else datetime.now()


def parse_iso(iso):
    """ISO-tijd -> aware datetime in lokale tijd, of None."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(LOKALE_TZ)
    except Exception:
        return None


def tijdkort(iso) -> str:
    """ISO-tijd -> 'dd-mm HH:MM' in lokale tijd."""
    d = parse_iso(iso)
    return d.strftime("%d-%m %H:%M") if d else str(iso or "?")


def uur_kort(iso) -> str:
    d = parse_iso(iso)
    return d.strftime("%H:%M") if d else "?"


def nacht_venster(ref: datetime):
    """Meest recente [22:00, 08:00]-venster t.o.v. ref."""
    eind = ref.replace(hour=NACHT_EIND_UUR, minute=0, second=0, microsecond=0)
    if ref < eind:                     # het is nog vroeg in de ochtend
        eind = ref
        start = (ref - timedelta(days=1)).replace(
            hour=NACHT_START_UUR, minute=0, second=0, microsecond=0)
    else:
        start = (eind - timedelta(days=1)).replace(
            hour=NACHT_START_UUR, minute=0, second=0, microsecond=0)
    return start, eind


# ---------------------------------------------------------------------------
# Data verzamelen (ongewijzigd t.o.v. de vorige versie)
# ---------------------------------------------------------------------------
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
    """Bepaalt de energie-/klimaat-tegels uit de live waarden."""
    p1 = next((a for a in apparaten
               if "measure_power" in a["caps"] and a["klasse"] != "solarpanel"), None)
    zon = next((a for a in apparaten if a["klasse"] == "solarpanel"), None) \
        or next((a for a in apparaten if "enphase" in (a.get("driver") or "").lower()), None)
    thermo = next((a for a in apparaten if a["klasse"] == "thermostat"
                   and "woonkamer" in (a["naam"] or "").lower()), None) \
        or next((a for a in apparaten if a["klasse"] == "thermostat"), None)
    scherm = next((a for a in apparaten if a["klasse"] == "sunshade"), None)
    lampen = [a for a in apparaten if a["klasse"] == "light"]
    aan = [a for a in lampen if a["caps"].get("onoff")]

    nu, vandaag, woning = [], [], []

    if zon:
        w = zon["caps"].get("measure_power")
        tot = zon["caps"].get("meter_power")
        if w is not None:
            sub = f"totaal {tot:,.0f} kWh".replace(",", ".") if isinstance(tot, (int, float)) else None
            nu.append(("Zon nu", f"{w:.0f}", "W", sub))
    if zon and p1:
        zw = zon["caps"].get("measure_power")
        nw = p1["caps"].get("measure_power")
        if isinstance(zw, (int, float)) and isinstance(nw, (int, float)):
            nu.append(("Verbruik nu", f"{zw + nw:.0f}", "W",
                       f"zon {zw:.0f} W · net {nw:+.0f} W"))
    if p1:
        w = p1["caps"].get("measure_power")
        if isinstance(w, (int, float)):
            if w < 0:
                nu.append(("Teruglevering nu", f"{-w:.0f}", "W", "naar het net"))
            else:
                nu.append(("Afname net", f"{w:.0f}", "W", "van het net"))

    if zon:
        dag = zon["caps"].get("meter_power.day", zon["caps"].get("meter_power.daily"))
        if dag is not None:
            vandaag.append(("Zon vandaag", f"{dag:.1f}", "kWh", None))
    if p1:
        kwh = p1["caps"].get("meter_power.daily")
        gas = p1["caps"].get("meter_gas.daily")
        gasnu = p1["caps"].get("measure_gas")
        if kwh is not None:
            vandaag.append(("Stroom vandaag", f"{kwh:.1f}", "kWh", None))
        if gas is not None:
            vandaag.append(("Gas vandaag", f"{gas:.2f}", "m³", None))
        if gasnu is not None:
            vandaag.append(("Gas nu", f"{gasnu:.3f}", "m³", None))

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
            woning.append(("Buiten (KNMI)", f"{buiten:.1f}", "°C", sub or None))
        elif recap:
            woning.append(("Weer (KNMI)", recap, "", None))
    if thermo:
        t = thermo["caps"].get("measure_temperature")
        doel = thermo["caps"].get("target_temperature")
        if t is not None:
            woning.append(("Woonkamer", f"{t:.1f}", "°C",
                           f"doel {doel:g}°" if doel is not None else None))
    woning.append(("Lampen aan", str(len(aan)), f"van {len(lampen)}",
                   ", ".join(a["naam"] for a in aan[:3]) if aan else "alles uit"))
    if scherm:
        st = scherm["caps"].get("windowcoverings_state")
        vert = {"down": "dicht", "up": "open", "idle": "stil"}.get(st, st or "?")
        woning.append(("Serre-scherm", vert, "", None))

    return {"Energie — nu": nu, "Vandaag": vandaag, "Klimaat & woning": woning}


def cameras(apparaten):
    return sorted((a for a in apparaten if is_ring(a)), key=lambda a: str(a["naam"]))


def bewegingssensoren(apparaten):
    """Bewegingssensoren die géén camera zijn."""
    return sorted((a for a in apparaten
                   if not is_ring(a) and "alarm_motion" in a["caps"]),
                  key=lambda a: str(a["naam"]))


def statusmeldingen(apparaten):
    """Dingen die aandacht vragen — met icoon en tekst, nooit alleen kleur."""
    meldingen = []
    slot = next((a for a in apparaten if a["klasse"] == "lock"), None)
    if slot and slot["caps"].get("locked") is False:
        meldingen.append(("warning", "⚠", f"{slot['naam'].capitalize()} is niet op slot"))
    for a in cameras(apparaten):
        if a["caps"].get("alarm_motion") is True:
            meldingen.append(("warning", "⚠", f"Beweging bij camera {a['naam']}"))
        if a["caps"].get("siren") is True:
            meldingen.append(("serious", "✖", f"Sirene aan: camera {a['naam']}"))
    for a in apparaten:
        if a["caps"].get("alarm_contact") is True:
            meldingen.append(("warning", "⚠", f"Contact open: {a['naam']}"))
        if not a.get("beschikbaar", True):
            meldingen.append(("serious", "✖", f"Offline: {a['naam']}"))
        b = a["caps"].get("measure_battery")
        if isinstance(b, (int, float)) and b < 20:
            meldingen.append(("warning", "⚠", f"Batterij laag ({b:.0f}%): {a['naam']}"))
    return meldingen


# ---------------------------------------------------------------------------
# Kleine HTML-bouwstenen
# ---------------------------------------------------------------------------
def tegels_html(tg) -> str:
    return "".join(
        f'''<div class="tegel"><div class="tegel-label">{esc(lab)}</div>
        <div class="tegel-waarde">{esc(val)}<span class="tegel-eenheid">{esc(een)}</span></div>
        {f'<div class="tegel-sub">{esc(sub)}</div>' if sub else ''}</div>'''
        for lab, val, een, sub in tg)


def sectie(titel, inhoud, leeg="Niets te tonen.") -> str:
    """Kop + inhoud, met nette fallback als de inhoud leeg is."""
    body = inhoud if inhoud else f'<p class="leeg">{esc(leeg)}</p>'
    return f'<h2>{esc(titel)}</h2>{body}'


def camera_kaart(a) -> str:
    c = a["caps"]
    badges = []
    beweging = c.get("alarm_motion")
    if beweging is True:
        badges.append(("warn", "◉ beweging"))
    elif beweging is False:
        badges.append(("rust", "rustig"))
    b = c.get("measure_battery")
    if isinstance(b, (int, float)):
        badges.append(("warn" if b < 20 else "rust", f"🔋 {b:.0f}%"))
    if "flood_light" in c:
        aan = c.get("flood_light") is True
        badges.append(("aan" if aan else "rust", f"💡 licht {'aan' if aan else 'uit'}"))
    if c.get("siren") is True:
        badges.append(("alarm", "🔊 sirene aan"))
    if not a.get("beschikbaar", True):
        badges.append(("alarm", "✖ offline"))
    badge_html = "".join(f'<span class="badge badge-{s}">{esc(t)}</span>' for s, t in badges)
    return (
        f'<section class="camera"><div class="camera-kop">'
        f'<span class="camera-icoon" aria-hidden="true">📷</span>'
        f'<span class="camera-naam">{esc(a["naam"])}</span>'
        f'<span class="camera-zone">{esc(a["zone"] or "Onbekend")}</span></div>'
        f'<div class="badges">{badge_html}</div></section>')


# ---------------------------------------------------------------------------
# Tabblad-inhoud
# ---------------------------------------------------------------------------
def tab_beveiliging(apparaten) -> str:
    delen = []

    # Sloten — prominent.
    sloten = [a for a in apparaten if a["klasse"] == "lock"]
    if sloten:
        tg = []
        for a in sloten:
            locked = a["caps"].get("locked")
            waarde = "op slot" if locked else ("open" if locked is False else "?")
            tg.append((a["naam"], waarde, "", a["zone"] or None))
        delen.append(sectie("Sloten", f'<div class="tegels">{tegels_html(tg)}</div>'))

    # Camera's.
    cams = cameras(apparaten)
    cam_html = "".join(camera_kaart(a) for a in cams)
    delen.append(sectie(
        f"Camera's ({len(cams)})",
        f'<div class="cameras">{cam_html}</div>'
        '<p class="uitleg">Status via de Homey Ring-app — beweging, batterij, '
        'floodlight en sirene. Geen live videobeeld.</p>' if cams else "",
        "Geen camera's gevonden."))

    # Bewegingssensoren (geen camera).
    sensoren = bewegingssensoren(apparaten)
    if sensoren:
        rijen = ""
        for a in sensoren:
            bew = a["caps"].get("alarm_motion")
            klasse = "aan" if bew else "rust"
            tekst = "◉ beweging" if bew else "rustig"
            rijen += (f'<li class="lijnrij"><span class="lijn-naam">{esc(a["naam"])}</span>'
                      f'<span class="lijn-zone">{esc(a["zone"] or "")}</span>'
                      f'<span class="badge badge-{klasse}">{esc(tekst)}</span></li>')
        delen.append(sectie("Bewegingssensoren",
                            f'<ul class="lijnlijst">{rijen}</ul>'))

    # Contactsensoren (deur/raam) — als aanwezig.
    contact = [a for a in apparaten if "alarm_contact" in a["caps"]]
    if contact:
        rijen = ""
        for a in contact:
            open_ = a["caps"].get("alarm_contact")
            klasse = "warn" if open_ else "rust"
            rijen += (f'<li class="lijnrij"><span class="lijn-naam">{esc(a["naam"])}</span>'
                      f'<span class="lijn-zone">{esc(a["zone"] or "")}</span>'
                      f'<span class="badge badge-{klasse}">{"open" if open_ else "dicht"}</span></li>')
        delen.append(sectie("Contactsensoren",
                            f'<ul class="lijnlijst">{rijen}</ul>'))

    return "".join(delen)


def tab_sensors(apparaten) -> str:
    delen = []

    # Temperatuur.
    temps = []
    knmi = next((a for a in apparaten if "knmi" in a.get("driver", "").lower()), None)
    if knmi:
        bt = knmi["caps"].get("current_temp", knmi["caps"].get("measure_temperature"))
        if isinstance(bt, (int, float)):
            temps.append(("Buiten (KNMI)", f"{bt:.1f}", "°C", None))
    for a in sorted(apparaten, key=lambda x: str(x["naam"])):
        t = a["caps"].get("measure_temperature")
        if isinstance(t, (int, float)):
            sub = None
            if a["klasse"] in ("thermostat", "heater"):
                doel = a["caps"].get("target_temperature")
                sub = f"doel {doel:g}°" if isinstance(doel, (int, float)) else (a["zone"] or None)
            else:
                sub = a["zone"] or None
            temps.append((a["naam"], f"{t:.1f}", "°C", sub))
    delen.append(sectie("Temperatuur",
                        f'<div class="tegels">{tegels_html(temps)}</div>' if temps else "",
                        "Geen temperatuursensoren."))

    # Luchtvochtigheid / licht / overige meetwaarden.
    overig = []
    for a in sorted(apparaten, key=lambda x: str(x["naam"])):
        c = a["caps"]
        h = c.get("measure_humidity")
        if isinstance(h, (int, float)):
            overig.append((f"{a['naam']} — vocht", f"{h:.0f}", "%", a["zone"] or None))
        lx = c.get("measure_luminance")
        if isinstance(lx, (int, float)):
            overig.append((f"{a['naam']} — licht", f"{lx:.0f}", "lux", a["zone"] or None))
    if overig:
        delen.append(sectie("Vocht & licht",
                            f'<div class="tegels">{tegels_html(overig)}</div>'))

    # Beweging (alle sensoren + camera's, huidige stand).
    bew = []
    for a in sorted(apparaten, key=lambda x: str(x["naam"])):
        if "alarm_motion" in a["caps"]:
            actief = a["caps"].get("alarm_motion")
            bew.append((a["naam"], a["zone"] or "", "aan" if actief else "rust",
                        "◉ beweging" if actief else "rustig"))
    if bew:
        rijen = "".join(
            f'<li class="lijnrij"><span class="lijn-naam">{esc(n)}</span>'
            f'<span class="lijn-zone">{esc(z)}</span>'
            f'<span class="badge badge-{k}">{esc(t)}</span></li>'
            for n, z, k, t in bew)
        delen.append(sectie("Beweging (nu)", f'<ul class="lijnlijst">{rijen}</ul>'))

    # Batterijen.
    accs = []
    for a in sorted(apparaten, key=lambda x: (x["caps"].get("measure_battery") or 999)):
        b = a["caps"].get("measure_battery")
        if isinstance(b, (int, float)):
            accs.append((a["naam"], f"{b:.0f}", "%", "laag!" if b < 20 else (a["zone"] or None)))
    if accs:
        delen.append(sectie("Batterijen",
                            f'<div class="tegels">{tegels_html(accs)}</div>'))

    return "".join(delen)


def tab_vannacht(apparaten) -> str:
    ringlog = lees("ring-log.json")
    ref = nu_lokaal()
    start, eind = nacht_venster(ref)
    venster_tekst = f"{start.strftime('%d-%m %H:%M')} – {eind.strftime('%H:%M')}"

    kop = (f'<p class="uitleg">Wat is er tussen <strong>{esc(venster_tekst)}</strong> '
           f'gebeurd — beweging bij de camera\'s uit Homey Insights.</p>')

    if not (ringlog and ringlog.get("cameras")):
        return kop + ('<p class="leeg">Nog geen camera-log. Draai '
                      '<code>make ring-log</code> om beweging op te halen.</p>')

    # Waarschuw als het log ouder is dan het nacht-venster (dan mist deze nacht).
    log_tijd = parse_iso(ringlog.get("opgehaald_op"))
    verouderd = ""
    if log_tijd and log_tijd < eind:
        verouderd = (f'<div class="melding melding-warning"><span aria-hidden="true">⚠</span> '
                     f'Camera-log is van {esc(log_tijd.strftime("%d-%m %H:%M"))} — '
                     f'draai <code>make ring-log</code> voor de meest recente nacht.</div>')

    kaarten = ""
    totaal = 0
    for cam in sorted(ringlog["cameras"], key=lambda x: str(x.get("naam"))):
        evs = []
        for t in cam.get("events") or []:
            d = parse_iso(t)
            if d and start <= d <= eind:
                evs.append(d)
        evs.sort(reverse=True)
        totaal += len(evs)
        if not cam.get("beschikbaar", True):
            regels = '<li class="log-leeg">geen Insights-log voor deze camera</li>'
        elif not evs:
            regels = '<li class="log-leeg">rustig — geen beweging</li>'
        else:
            regels = "".join(f"<li>{esc(d.strftime('%H:%M'))}</li>" for d in evs)
        kaarten += (
            f'<section class="camlog"><div class="camlog-kop">'
            f'<span class="camera-naam">📷 {esc(cam.get("naam"))}</span>'
            f'<span class="camlog-aantal">{len(evs)}×</span></div>'
            f"<ul>{regels}</ul></section>")

    samenvatting = (f'<div class="groot-cijfer">{totaal}'
                    f'<span class="groot-cijfer-label">bewegingsmeldingen vannacht</span></div>')
    return kop + verouderd + samenvatting + f'<div class="camlogs">{kaarten}</div>'


def tab_netwerk(apparaten, net_html) -> str:
    delen = []
    router = lees("router.json")

    if router:
        online = router.get("online")
        status_klasse = "goed" if online else ("slecht" if online is False else "onb")
        status_tekst = "online" if online else ("offline" if online is False else "onbekend")
        naam = router.get("model") or router.get("merk") or "Router"
        tg = []
        veld_labels = [
            ("merk", "Merk"), ("model", "Model"), ("firmware", "Firmware"),
            ("uptime", "Uptime"), ("wan_ip", "WAN-IP"), ("lan_ip", "LAN-IP"),
            ("clients", "Verbonden apparaten"), ("download", "Download"),
            ("upload", "Upload"), ("latency", "Latency"),
        ]
        for sleutel, label in veld_labels:
            v = router.get(sleutel)
            if v not in (None, "", []):
                tg.append((label, v, "", None))
        wifi = router.get("wifi")
        if isinstance(wifi, list) and wifi:
            tg.append(("Wi-Fi", ", ".join(str(w) for w in wifi), "", None))
        rstamp = tijdkort(router.get("opgehaald_op")) if router.get("opgehaald_op") else ""
        delen.append(
            f'<h2>Router</h2>'
            f'<div class="router-status router-{status_klasse}">'
            f'<span class="router-dot"></span>{esc(naam)} — {esc(status_tekst)}</div>'
            f'<div class="tegels">{tegels_html(tg)}</div>'
            + (f'<p class="uitleg">Uitgelezen op {esc(rstamp)}.</p>' if rstamp else ''))
    else:
        delen.append(
            '<h2>Router</h2>'
            '<p class="leeg">Router nog niet gekoppeld. Zodra het lokale '
            'netwerkscript draait (<code>scripts/netwerk/router.*</code>) en '
            '<code>inventaris/export/router.json</code> schrijft, verschijnt hier '
            'de status: online, uptime, verbonden apparaten en Wi-Fi.</p>')

    # Netkwaliteit uit de P1-meter.
    if net_html:
        delen.append(f'<h2>Netkwaliteit (P1-meter)</h2>'
                     f'<div class="netinfo">{net_html}</div>'
                     f'<p class="uitleg">Spanning, aantal stroomstoringen en '
                     f'verbindingsstatus van de slimme meter.</p>')
    return "".join(delen)


def tab_mailagenda() -> str:
    data = lees("mail-agenda.json")
    if not data:
        return ('<p class="leeg">Mail en agenda nog niet gekoppeld. Cowork haalt '
                'ze op en schrijft <code>inventaris/export/mail-agenda.json</code>; '
                'dit tabblad toont ze dan hier.</p>')

    stamp = tijdkort(data.get("opgehaald_op")) if data.get("opgehaald_op") else ""
    delen = []

    # --- Agenda -----------------------------------------------------------
    agenda = data.get("agenda") or []
    vandaag = nu_lokaal().date()
    morgen = vandaag + timedelta(days=1)

    def daglabel(d):
        if d == vandaag:
            return "Vandaag"
        if d == morgen:
            return "Morgen"
        return f"{WEEKDAGEN[d.weekday()].capitalize()} {d.strftime('%d-%m')}"

    groepen = {}
    for ev in sorted(agenda, key=lambda e: str(e.get("start"))):
        d = parse_iso(ev.get("start"))
        sleutel = d.date() if d else vandaag
        groepen.setdefault(sleutel, []).append((d, ev))

    agenda_html = ""
    for d in sorted(groepen):
        items = ""
        for start_dt, ev in groepen[d]:
            tijd = "hele dag" if ev.get("hele_dag") else (
                uur_kort(ev.get("start")) +
                (f"–{uur_kort(ev.get('eind'))}" if ev.get("eind") else ""))
            loc = ev.get("locatie")
            agn = ev.get("agenda")
            meta = " · ".join(x for x in (loc, agn) if x)
            items += (
                f'<li class="afspraak"><span class="afspraak-tijd">{esc(tijd)}</span>'
                f'<span class="afspraak-body"><span class="afspraak-titel">{esc(ev.get("titel"))}</span>'
                f'{f"<span class=afspraak-meta>{esc(meta)}</span>" if meta else ""}</span></li>')
        agenda_html += f'<div class="daggroep"><h3>{esc(daglabel(d))}</h3><ul class="afspraken">{items}</ul></div>'
    delen.append(sectie("Agenda", agenda_html, "Geen afspraken gevonden."))

    # --- Mail -------------------------------------------------------------
    mail = data.get("mail") or {}
    items = mail.get("items") or []
    onnodig = mail.get("ongelezen_aantal")
    if mail.get("type") == "ongelezen":
        koptekst = f"Ongelezen ({onnodig if onnodig is not None else len(items)})"
    else:
        koptekst = "Recente mail"
        if onnodig is not None:
            koptekst += f" · {onnodig} ongelezen"

    rijen = ""
    for m in items:
        ster = '<span class="mail-ster" title="belangrijk">★</span>' if m.get("belangrijk") else '<span class="mail-ster leeg"></span>'
        rijen += (
            f'<li class="mailrij">{ster}'
            f'<span class="mail-body"><span class="mail-van">{esc(m.get("van"))}</span>'
            f'<span class="mail-onderwerp">{esc(m.get("onderwerp"))}</span></span>'
            f'<span class="mail-tijd">{esc(tijdkort(m.get("tijd")))}</span></li>')
    mail_html = f'<ul class="maillijst">{rijen}</ul>' if rijen else ""
    delen.append(sectie(koptekst, mail_html, "Postvak leeg — niets ongelezen."))

    if stamp:
        delen.append(f'<p class="uitleg">Opgehaald {esc(stamp)} via Cowork.</p>')
    return "".join(delen)


def tab_energie(groepen) -> str:
    delen = []
    for titel in ("Energie — nu", "Vandaag"):
        tg = groepen.get(titel) or []
        if tg:
            delen.append(f'<h2>{esc(titel)}</h2><div class="tegels">{tegels_html(tg)}</div>')
    if not delen:
        return '<p class="leeg">Geen energiegegevens in de export.</p>'
    return "".join(delen)


def tab_huis(apparaten, flows, adv) -> str:
    per_zone = Counter((a["zone"] or "Onbekend") for a in apparaten)
    zones_sorted = sorted(per_zone.items(), key=lambda kv: -kv[1])
    maxn = max(per_zone.values()) if per_zone else 1

    staven = ""
    for zone, n in zones_sorted:
        breedte = n / maxn * 100
        staven += f'''<div class="rij" data-tip="{esc(zone)}: {n} apparaten">
          <div class="rij-label">{esc(zone)}</div>
          <div class="rij-track"><div class="rij-bar" style="width:{breedte:.1f}%"></div></div>
          <div class="rij-waarde">{n}</div></div>'''

    kamers = ""
    for zone, _ in zones_sorted:
        items = ""
        for a in sorted((x for x in apparaten if (x["zone"] or "Onbekend") == zone),
                        key=lambda x: str(x["naam"])):
            icoon = "📷" if is_ring(a) else KLASSE_ICOON.get(a["klasse"], "·")
            status = ""
            c = a["caps"]
            if is_ring(a):
                status = "beweging" if c.get("alarm_motion") else "rustig"
            elif a["klasse"] == "solarpanel" and c.get("measure_power") is not None:
                status = f"{c['measure_power']:.0f} W"
            elif a["klasse"] == "light":
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

    flows_aan = sum(1 for f in flows if f.get("enabled"))
    adv_aan = sum(1 for f in adv if f.get("enabled"))
    flowlijst = "".join(
        f'<li><span class="dot {"dot-aan" if f.get("enabled") else "dot-uit"}" aria-hidden="true"></span>'
        f'{esc(f.get("name"))}<span class="app-status">{"aan" if f.get("enabled") else "uit"}</span></li>'
        for f in sorted(adv + flows, key=lambda f: (not f.get("enabled"), str(f.get("name")))))

    return (
        f'<h2>Apparaten per ruimte ({len(apparaten)} totaal)</h2>'
        f'<div class="grafiek">{staven}</div>'
        f'<h2>Ruimtes</h2><div class="kamers">{kamers}</div>'
        f'<h2>Flows ({flows_aan + adv_aan} aan, '
        f'{len(flows) + len(adv) - flows_aan - adv_aan} uit)</h2>'
        f'<div class="flows"><ul>{flowlijst}</ul></div>')


def tab_overzicht(apparaten, groepen, meldingen) -> str:
    melding_html = "".join(
        f'<div class="melding melding-{soort}"><span aria-hidden="true">{icoon}</span> {esc(tekst)}</div>'
        for soort, icoon, tekst in meldingen) or \
        '<div class="melding melding-ok"><span aria-hidden="true">✓</span> Geen bijzonderheden</div>'

    # Curated tegels: weer, verbruik, woonkamer, zon.
    def pak(titel, labels):
        return [t for t in groepen.get(titel, []) if t[0] in labels]
    kern = (pak("Klimaat & woning", {"Buiten (KNMI)", "Weer (KNMI)", "Woonkamer"})
            + pak("Energie — nu", {"Verbruik nu", "Zon nu"}))
    kern_html = f'<div class="tegels">{tegels_html(kern)}</div>' if kern else ""

    # Agenda-snippet (max 3 komende).
    data = lees("mail-agenda.json") or {}
    agenda = sorted(data.get("agenda") or [], key=lambda e: str(e.get("start")))[:3]
    agenda_html = ""
    if agenda:
        rijen = ""
        for ev in agenda:
            tijd = "hele dag" if ev.get("hele_dag") else tijdkort(ev.get("start"))
            rijen += (f'<li class="afspraak"><span class="afspraak-tijd">{esc(tijd)}</span>'
                      f'<span class="afspraak-body"><span class="afspraak-titel">{esc(ev.get("titel"))}</span></span></li>')
        agenda_html = f'<div class="kolom"><h2>Komende afspraken</h2><ul class="afspraken">{rijen}</ul></div>'

    # Mail-snippet (max 3).
    mail = (data.get("mail") or {})
    mitems = (mail.get("items") or [])[:3]
    mail_html = ""
    if mitems:
        rijen = ""
        for m in mitems:
            ster = '★ ' if m.get("belangrijk") else ''
            rijen += (f'<li class="mailrij"><span class="mail-body">'
                      f'<span class="mail-van">{esc(ster)}{esc(m.get("van"))}</span>'
                      f'<span class="mail-onderwerp">{esc(m.get("onderwerp"))}</span></span>'
                      f'<span class="mail-tijd">{esc(tijdkort(m.get("tijd")))}</span></li>')
        kop = "Ongelezen mail" if mail.get("type") == "ongelezen" else "Recente mail"
        mail_html = f'<div class="kolom"><h2>{esc(kop)}</h2><ul class="maillijst">{rijen}</ul></div>'

    kolommen = ""
    if agenda_html or mail_html:
        kolommen = f'<div class="tweekolom">{agenda_html}{mail_html}</div>'

    return (f'<div class="meldingen">{melding_html}</div>'
            + (f'<h2>Nu in huis</h2>{kern_html}' if kern_html else "")
            + kolommen)


# ---------------------------------------------------------------------------
# Assemblage
# ---------------------------------------------------------------------------
def main() -> None:
    apparaten, flows, adv, stamp = verzamel()
    groepen = kpis(apparaten)
    meldingen = statusmeldingen(apparaten)

    try:
        tijd = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(LOKALE_TZ)
        stamp_net = tijd.strftime("%d-%m-%Y %H:%M")
    except Exception:
        stamp_net = stamp or "?"

    # Netkwaliteit-badges uit de P1-meter (gedeeld met het Netwerk-tabblad).
    netm = next((a for a in apparaten
                 if "measure_power" in a["caps"] and a["klasse"] != "solarpanel"), None)
    net_html = ""
    if netm:
        c = netm["caps"]
        badges = []
        v = c.get("measure_voltage.l1", c.get("measure_voltage"))
        if isinstance(v, (int, float)):
            soort = "warn" if (v < 207 or v > 253) else "rust"
            badges.append((soort, ("⚡ " + f"{v:.1f}".replace(".", ",") + " V")))
        fails = c.get("long_power_fail_count")
        if isinstance(fails, (int, float)):
            badges.append(("rust", f"storingen: {fails:.0f}"))
        conn = c.get("alarm_connectivity")
        if conn is True:
            badges.append(("alarm", "⚠ verbindingsprobleem"))
        elif conn is False:
            badges.append(("rust", "✓ verbonden"))
        net_html = "".join(f'<span class="badge badge-{s}">{esc(t)}</span>' for s, t in badges)

    # Inhoud per tabblad.
    inhoud = {
        "overzicht": tab_overzicht(apparaten, groepen, meldingen),
        "beveiliging": tab_beveiliging(apparaten),
        "sensors": tab_sensors(apparaten),
        "vannacht": tab_vannacht(apparaten),
        "netwerk": tab_netwerk(apparaten, net_html),
        "mailagenda": tab_mailagenda(),
        "energie": tab_energie(groepen),
        "huis": tab_huis(apparaten, flows, adv),
    }

    nav = "".join(
        f'<button class="tab" role="tab" data-tab="{sleutel}" '
        f'id="tab-btn-{sleutel}" aria-selected="false">{esc(label)}</button>'
        for sleutel, label in TABS)
    panelen = "".join(
        f'<section class="tabpaneel" id="tab-{sleutel}" role="tabpanel" '
        f'aria-labelledby="tab-btn-{sleutel}">{inhoud.get(sleutel, "")}</section>'
        for sleutel, _ in TABS)

    doc = f"""<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<title>Startpagina</title>
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
       color:var(--text-secondary); margin:1.8rem 0 .7rem; }}
  h3 {{ font-size:.95rem; margin:0 0 .4rem; }}
  .sub {{ color:var(--text-muted); font-size:.85rem; margin:.2rem 0 0; }}
  .uitleg {{ color:var(--text-muted); font-size:.8rem; margin:.5rem 0 0; }}
  .leeg {{ color:var(--text-muted); font-size:.9rem; background:var(--surface-2);
           border-radius:12px; padding:1rem 1.1rem; margin:.5rem 0 0; }}
  code {{ font-size:.85em; background:var(--surface-2); padding:.05rem .3rem; border-radius:4px; }}

  .kop {{ display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }}
  #ververs {{ font:inherit; font-size:.9rem; border:1px solid var(--rand);
      background:var(--surface-2); color:var(--text-primary); border-radius:99px;
      padding:.45rem 1.1rem; cursor:pointer; flex:none; }}
  #ververs:hover {{ border-color:var(--series-1); }}
  #ververs[disabled] {{ opacity:.55; cursor:wait; }}

  /* Tabbladen */
  .tabs {{ display:flex; gap:.15rem; flex-wrap:wrap; margin:1.2rem 0 1.4rem;
           border-bottom:1px solid var(--rand); overflow-x:auto; }}
  .tab {{ font:inherit; font-size:.9rem; border:0; background:none;
          color:var(--text-secondary); padding:.55rem .9rem; cursor:pointer;
          border-bottom:2px solid transparent; margin-bottom:-1px; white-space:nowrap;
          border-radius:8px 8px 0 0; }}
  .tab:hover {{ color:var(--text-primary); background:var(--surface-2); }}
  .tab[aria-selected="true"] {{ color:var(--text-primary);
          border-bottom-color:var(--series-1); font-weight:600; }}
  .tabpaneel {{ display:none; }}
  .tabpaneel.actief {{ display:block; animation:fade .18s ease; }}
  @keyframes fade {{ from {{ opacity:0; transform:translateY(3px); }} to {{ opacity:1; }} }}
  .tabpaneel > h2:first-child {{ margin-top:.4rem; }}

  .tegels {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
             gap:.75rem; }}
  .tegel {{ background:var(--surface-2); border-radius:12px; padding:.9rem 1rem; }}
  .tegel-label {{ font-size:.75rem; text-transform:uppercase; letter-spacing:.05em;
                  color:var(--text-secondary); }}
  .tegel-waarde {{ font-size:2rem; font-weight:650; line-height:1.15; margin-top:.15rem; }}
  .tegel-eenheid {{ font-size:.85rem; font-weight:400; color:var(--text-secondary);
                    margin-left:.3rem; }}
  .tegel-sub {{ font-size:.78rem; color:var(--text-muted); margin-top:.1rem;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}

  .meldingen {{ display:flex; flex-wrap:wrap; gap:.5rem; }}
  .melding {{ font-size:.85rem; border-radius:99px; padding:.3rem .85rem;
              background:var(--surface-2); }}
  .melding-warning span {{ color:var(--st-warn); }}
  .melding-serious span {{ color:var(--st-serious); }}
  .melding-ok span {{ color:var(--st-good); }}

  .tweekolom {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
                gap:1.5rem; }}

  /* Lijstjes (beveiliging/sensors) */
  .lijnlijst {{ list-style:none; margin:.3rem 0 0; padding:0;
                display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:.3rem .9rem; }}
  .lijnrij {{ display:flex; align-items:center; gap:.6rem; padding:.35rem .1rem;
              border-bottom:1px solid var(--rand); }}
  .lijn-naam {{ flex:1; font-size:.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .lijn-zone {{ color:var(--text-muted); font-size:.78rem; }}

  .groot-cijfer {{ display:flex; align-items:baseline; gap:.6rem; margin:.4rem 0 1rem;
                   font-size:2.6rem; font-weight:700; }}
  .groot-cijfer-label {{ font-size:.9rem; font-weight:400; color:var(--text-secondary); }}

  /* Camera's + camlog */
  .cameras {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:.9rem; }}
  .camera {{ border:1px solid var(--rand); border-radius:12px; padding:.8rem .95rem; }}
  .camera-kop {{ display:flex; align-items:baseline; gap:.5rem; }}
  .camera-icoon {{ flex:none; }}
  .camera-naam {{ font-weight:600; font-size:.95rem; }}
  .camera-zone {{ margin-left:auto; color:var(--text-muted); font-size:.8rem; white-space:nowrap; }}
  .badges {{ display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.6rem; }}
  .badge {{ font-size:.78rem; border-radius:99px; padding:.18rem .6rem;
            background:var(--surface-2); color:var(--text-secondary); }}
  .badge-rust {{ color:var(--text-secondary); }}
  .badge-aan {{ color:var(--st-warn); }}
  .badge-warn {{ color:var(--st-warn); font-weight:600; }}
  .badge-alarm {{ color:var(--st-serious); font-weight:600; }}

  .camlogs {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:.9rem; }}
  .camlog {{ border:1px solid var(--rand); border-radius:12px; padding:.8rem .95rem; }}
  .camlog-kop {{ display:flex; align-items:baseline; justify-content:space-between;
                 gap:.5rem; margin-bottom:.4rem; }}
  .camlog-aantal {{ color:var(--text-secondary); font-variant-numeric:tabular-nums; font-size:.85rem; }}
  .camlog ul {{ list-style:none; margin:0; padding:0; }}
  .camlog li {{ font-size:.85rem; color:var(--text-secondary); padding:.12rem 0;
                font-variant-numeric:tabular-nums; }}
  .camlog .log-leeg {{ color:var(--text-muted); font-variant-numeric:normal; }}

  /* Router */
  .router-status {{ display:inline-flex; align-items:center; gap:.55rem; font-weight:600;
      background:var(--surface-2); border-radius:99px; padding:.4rem 1rem; margin:.2rem 0 .9rem; }}
  .router-dot {{ width:10px; height:10px; border-radius:50%; background:var(--text-muted); }}
  .router-goed .router-dot {{ background:var(--st-good); }}
  .router-slecht .router-dot {{ background:var(--st-serious); }}
  .netinfo {{ display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; }}

  /* Agenda + mail */
  .daggroep {{ margin-bottom:1rem; }}
  .afspraken, .maillijst {{ list-style:none; margin:.2rem 0 0; padding:0; }}
  .afspraak {{ display:flex; gap:.8rem; padding:.4rem 0; border-bottom:1px solid var(--rand); }}
  .afspraak-tijd {{ flex:none; width:5.5em; font-variant-numeric:tabular-nums;
                    color:var(--text-secondary); font-size:.9rem; }}
  .afspraak-body {{ display:flex; flex-direction:column; }}
  .afspraak-titel {{ font-size:.92rem; }}
  .afspraak-meta {{ font-size:.78rem; color:var(--text-muted); }}
  .mailrij {{ display:flex; align-items:baseline; gap:.55rem; padding:.4rem 0;
              border-bottom:1px solid var(--rand); }}
  .mail-ster {{ color:var(--st-warn); flex:none; width:1em; }}
  .mail-ster.leeg {{ color:var(--rand); }}
  .mail-body {{ display:flex; flex-direction:column; flex:1; min-width:0; }}
  .mail-van {{ font-size:.82rem; color:var(--text-secondary); }}
  .mail-onderwerp {{ font-size:.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .mail-tijd {{ flex:none; color:var(--text-muted); font-size:.78rem;
                font-variant-numeric:tabular-nums; }}

  /* Huis (grafiek/ruimtes/flows) */
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
  .kamers {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:.9rem; }}
  .kamer {{ border:1px solid var(--rand); border-radius:12px; padding:.8rem .95rem; }}
  .kamer ul {{ list-style:none; margin:0; padding:0; }}
  .apparaat {{ display:flex; align-items:baseline; gap:.5rem; padding:.18rem 0; font-size:.88rem; }}
  .app-icoon {{ width:1.2em; text-align:center; color:var(--text-muted); }}
  .apparaat-aan .app-icoon {{ color:var(--st-warn); }}
  .app-naam {{ flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .app-status {{ color:var(--text-muted); font-size:.8rem; }}
  .flows ul {{ list-style:none; margin:0; padding:0; columns:2 320px; }}
  .flows li {{ display:flex; align-items:center; gap:.55rem; padding:.22rem 0;
               font-size:.88rem; break-inside:avoid; }}
  .flows .app-status {{ margin-left:auto; }}
  .dot {{ width:8px; height:8px; border-radius:50%; flex:none; box-shadow:0 0 0 2px var(--surface-1); }}
  .dot-aan {{ background:var(--st-good); }}
  .dot-uit {{ background:var(--rand); }}
  footer {{ margin-top:3rem; color:var(--text-muted); font-size:.8rem; }}
</style></head>
<body class="viz-root">
<div class="kop">
  <div><h1>🏠 Startpagina</h1>
  <p class="sub">Momentopname van {esc(stamp_net)}<span id="ververs-uitleg"> · ververs met <code>make homey &amp;&amp; make dashboard</code>, of start <code>make serve</code> voor een knop</span></p></div>
  <button id="ververs" hidden>↻ Ververs</button>
</div>

<nav class="tabs" role="tablist" aria-label="Onderdelen">{nav}</nav>
<main>{panelen}</main>

<footer>Gegenereerd door scripts/bouw_dashboard.py · bron: inventaris/export/ ·
project <code>~/projects/Prive/huis</code></footer>
<script>
  // Tabbladen — client-side, werkt ook op file://.
  const tabs = [...document.querySelectorAll('.tab')];
  const panelen = [...document.querySelectorAll('.tabpaneel')];
  function toon(id) {{
    if (!tabs.some(t => t.dataset.tab === id)) id = 'overzicht';
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    panelen.forEach(p => p.classList.toggle('actief', p.id === 'tab-' + id));
  }}
  tabs.forEach(t => t.addEventListener('click', () => {{
    toon(t.dataset.tab);
    history.replaceState(null, '', '#' + t.dataset.tab);
  }}));
  toon((location.hash || '').replace('#', '') || 'overzicht');

  // Ververs-knop werkt alleen via make serve (op file:// draait niets).
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
    print(f"{len(apparaten)} apparaten, {len(TABS)} tabbladen, "
          f"{len(meldingen)} meldingen -> {UIT}")


if __name__ == "__main__":
    main()
