#!/usr/bin/env python3
"""Haalt ongelezen mail (Gmail) + komende afspraken (Google Agenda) op en
schrijft ze naar inventaris/export/mail-agenda.json — hetzelfde schema dat
dashboard/vandaag.html en de generator (bouw_dashboard.py) lezen.

Draait LOKAAL op linuxcris (die heeft internet en de OAuth-token), zodat de
Ververs-knop en de uur-cron de mail/agenda echt vers ophalen. Vervangt de oude
route waarbij Cowork dit dagelijks meebakte.

Eenmalig autoriseren (op een machine mét browser, bijv. de Mac):
    python scripts/google/export_mail_agenda.py --auth
Dat opent een browser, vraagt toestemming en schrijft scripts/google/token.json.
Kopieer credentials.json + token.json daarna naar linuxcris (~/huis/scripts/google/).

Nodig: scripts/google/credentials.json (OAuth-client, type 'Desktop app') uit de
Google Cloud Console, met de Gmail API en Google Calendar API ingeschakeld.

Alleen-lezen scopes; dit script wijzigt niets in je mailbox of agenda.
"""

from __future__ import annotations

import email.utils
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Amsterdam")
except Exception:  # geen tzdata -> systeem-lokaal
    TZ = None

ROOT = Path(__file__).resolve().parents[2]
HIER = Path(__file__).resolve().parent
CREDS = HIER / "credentials.json"
TOKEN = HIER / "token.json"
UIT = ROOT / "inventaris" / "export" / "mail-agenda.json"

# Alleen-lezen: mail en agenda worden nooit gewijzigd.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
]

# Configuratie (overschrijfbaar via omgeving/.env).
GMAIL_QUERY = os.environ.get("GMAIL_QUERY", "is:unread in:inbox")
MAIL_MAX = int(os.environ.get("MAIL_MAX", "15"))
DAGEN_VOORUIT = int(os.environ.get("AGENDA_DAGEN", "7"))
# (agenda-id, weergavenaam). Standaard: eigen agenda + Gezin-agenda.
AGENDAS = [
    (os.environ.get("GOOGLE_CAL_PRIMARY", "crisvandalen@gmail.com"), "Cris"),
    (os.environ.get(
        "GOOGLE_CAL_GEZIN",
        "family02527755765601232612@group.calendar.google.com"), "Gezin"),
]


def get_creds(auth_mode: bool):
    """Laadt token.json (ververst indien nodig) of draait de OAuth-flow."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)

    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN.write_text(creds.to_json())
        return creds

    if auth_mode:
        if not CREDS.exists():
            sys.exit(f"credentials.json ontbreekt: leg 'm neer op {CREDS}")
        from google_auth_oauthlib.flow import InstalledAppFlow
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDS), SCOPES)
        creds = flow.run_local_server(port=0)
        TOKEN.write_text(creds.to_json())
        print(f"Autorisatie gelukt -> {TOKEN}")
        return creds

    sys.exit(
        "Geen geldige token.json. Draai eenmalig met een browser:\n"
        "    python scripts/google/export_mail_agenda.py --auth\n"
        "en kopieer daarna credentials.json + token.json naar linuxcris."
    )


def _nu_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ms_naar_iso(ms: str) -> str:
    dt = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _afzender(from_header: str) -> str:
    naam, adres = email.utils.parseaddr(from_header or "")
    return naam.strip() or adres or "(onbekend)"


def haal_mail(creds) -> dict:
    from googleapiclient.discovery import build
    gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)

    resp = gmail.users().messages().list(
        userId="me", q=GMAIL_QUERY, maxResults=MAIL_MAX).execute()
    berichten = resp.get("messages", []) or []

    items = []
    for m in berichten:
        msg = gmail.users().messages().get(
            userId="me", id=m["id"], format="metadata",
            metadataHeaders=["From", "Subject"]).execute()
        kop = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        items.append({
            "van": _afzender(kop.get("From", "")),
            "onderwerp": kop.get("Subject", "(geen onderwerp)"),
            "tijd": _ms_naar_iso(msg.get("internalDate", "0")),
            "belangrijk": "IMPORTANT" in (msg.get("labelIds") or []),
        })

    # Nauwkeurig totaalaantal ongelezen in de inbox (kan hoger zijn dan MAIL_MAX).
    try:
        lbl = gmail.users().labels().get(userId="me", id="INBOX").execute()
        aantal = int(lbl.get("messagesUnread", len(items)))
    except Exception:
        aantal = len(items)

    return {"type": "ongelezen", "ongelezen_aantal": aantal, "items": items}


def haal_agenda(creds) -> list:
    from googleapiclient.discovery import build
    cal = build("calendar", "v3", credentials=creds, cache_discovery=False)

    nu = datetime.now(TZ) if TZ else datetime.now().astimezone()
    start = nu.replace(hour=0, minute=0, second=0, microsecond=0)
    eind = start + timedelta(days=DAGEN_VOORUIT, hours=23, minutes=59, seconds=59)
    time_min = start.isoformat()
    time_max = eind.isoformat()

    afspraken = []
    for cal_id, naam in AGENDAS:
        try:
            evs = cal.events().list(
                calendarId=cal_id, timeMin=time_min, timeMax=time_max,
                singleEvents=True, orderBy="startTime", maxResults=50,
            ).execute().get("items", [])
        except Exception as e:  # één stukke agenda mag de rest niet blokkeren
            print(f"[waarschuwing] agenda {naam} overgeslagen: {e}", file=sys.stderr)
            continue

        for ev in evs:
            s, e = ev.get("start", {}), ev.get("end", {})
            hele_dag = "date" in s
            item = {
                "start": s.get("dateTime") or s.get("date"),
                "eind": e.get("dateTime") or e.get("date"),
                "titel": ev.get("summary", "(geen titel)"),
                "agenda": naam,
                "hele_dag": hele_dag,
            }
            if ev.get("location"):
                item["locatie"] = ev["location"]
            afspraken.append(item)

    afspraken.sort(key=lambda x: str(x.get("start")))
    return afspraken


def main() -> None:
    auth_mode = "--auth" in sys.argv[1:]
    creds = get_creds(auth_mode)
    if auth_mode:
        # Bij --auth alleen autoriseren; geen export forceren.
        print("Token staat klaar. Draai het script nu zonder --auth om te exporteren.")
        return

    mail = haal_mail(creds)
    agenda = haal_agenda(creds)

    data = {
        "bron": "Google (lokaal, linuxcris)",
        "opgehaald_op": _nu_utc_iso(),
        "agenda": agenda,
        "mail": mail,
    }

    UIT.parent.mkdir(parents=True, exist_ok=True)
    UIT.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"{len(agenda)} afspraken, {mail['ongelezen_aantal']} ongelezen -> {UIT}")


if __name__ == "__main__":
    main()
