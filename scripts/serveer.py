#!/usr/bin/env python3
"""Serveert het dashboard lokaal, mét werkende ververs-knop.

    make serve          → http://localhost:8321

Serveert de héle dashboard-map (index + energie/kosten/laadadvies/
batterijsimulator + de PWA-bestanden), zodat de app-tabbalk werkt. De pagina
krijgt alleen in deze modus een ververs-knop; die roept /ververs aan, draait
de Homey-export en de generator opnieuw, en de pagina herlaadt zichzelf.

Alleen bereikbaar vanaf deze Mac (bindt op 127.0.0.1).
"""

from __future__ import annotations

import http.server
import json
import mimetypes
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = ROOT / "dashboard"
POORT = int(os.environ.get("HUIS_POORT", "8321"))   # op de VPS: 8765 (Caddy)


def ververs() -> tuple[bool, str]:
    """Draait de exports en de generator. Geeft (gelukt, logtekst) terug."""
    log = []
    stappen = [
        # eerst git pull: haalt o.a. de door Cowork gepushte data/mail-agenda.json
        # binnen; niet-fataal (geen repo of geen netwerk = gewoon doorgaan)
        ("git-pull", ["git", "pull", "-q", "--ff-only"], False),
        ("homey-export", ["node", str(ROOT / "scripts/homey/export-devices.mjs")], True),
    ]
    # Ring-cameralog is optioneel: alleen als de OAuth-token er is, en een
    # mislukking mag de verversing niet blokkeren.
    if (ROOT / "scripts/homey/.homey-cloud-token.json").exists():
        stappen.append(("ring-log", ["node", str(ROOT / "scripts/homey/ring-log.mjs")], False))
    stappen.append(("dashboard", [sys.executable, str(ROOT / "scripts/bouw_dashboard.py")], True))

    for naam, cmd, verplicht in stappen:
        try:
            uit = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=90)
            log.append(f"[{naam}] exit {uit.returncode}\n{uit.stdout}{uit.stderr}".strip())
            if uit.returncode != 0 and verplicht:
                return False, "\n".join(log)
        except subprocess.TimeoutExpired:
            log.append(f"[{naam}] time-out")
            if verplicht:
                return False, "\n".join(log)
    return True, "\n".join(log)


class Handler(http.server.BaseHTTPRequestHandler):
    def _stuur(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bestand(self) -> Path | None:
        """Zet het pad om naar een bestand binnen dashboard/, of None."""
        rel = self.path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if rel in ("", "index.html"):
            return DASHBOARD_DIR / "index.html"
        doel = (DASHBOARD_DIR / rel).resolve()
        # geen path-traversal buiten de map
        if DASHBOARD_DIR.resolve() not in doel.parents and doel != DASHBOARD_DIR.resolve():
            return None
        return doel if doel.is_file() else None

    def do_GET(self) -> None:  # noqa: N802
        doel = self._bestand()
        if doel and doel.is_file():
            ctype = mimetypes.guess_type(str(doel))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            self._stuur(200, doel.read_bytes(), ctype)
        elif self.path in ("/", "/index.html"):
            self._stuur(200, "<p>Nog geen dashboard. Klik ververs of draai make dashboard.</p>"
                        .encode(), "text/html; charset=utf-8")
        else:
            self._stuur(404, b"niet gevonden", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/ververs":
            gelukt, log = ververs()
            self._stuur(200 if gelukt else 500,
                        json.dumps({"gelukt": gelukt, "log": log}).encode(),
                        "application/json")
        else:
            self._stuur(404, b"niet gevonden", "text/plain")

    def log_message(self, fmt, *args):  # stiller
        if "/ververs" in (args[0] if args else ""):
            print(f"  ververs-aanvraag: {args[1] if len(args) > 1 else ''}")


def main() -> None:
    server = http.server.HTTPServer((os.environ.get("HUIS_HOST", "127.0.0.1"), POORT), Handler)
    print(f"Dashboard: http://localhost:{POORT}  (stoppen: Ctrl+C)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGestopt.")


if __name__ == "__main__":
    main()
