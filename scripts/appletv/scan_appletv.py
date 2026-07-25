#!/usr/bin/env python3
"""Scant het netwerk op Apple TV's (en andere AirPlay-apparaten) met pyatv.

Draai dit op de Mac, op hetzelfde netwerk als de Apple TV. Het schrijft
inventaris/export/appletv.json en toont welke protocollen nog gepaird moeten
worden.

Pairen doe je daarna per protocol:
    .venv/bin/atvremote --id <identifier> --protocol companion pair

Of laat de wizard het doen:
    .venv/bin/atvremote wizard
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "inventaris" / "export"

# Protocollen die pairing nodig hebben voordat je ze kunt gebruiken.
PAIRING_NODIG = {"companion", "airplay", "raop"}


async def main() -> int:
    import pyatv  # type: ignore

    print("Scannen (ongeveer 5 seconden) ...")
    loop = asyncio.get_running_loop()
    gevonden = await pyatv.scan(loop, timeout=5)

    apparaten = []
    for atv in gevonden:
        diensten = []
        for service in atv.services:
            naam = str(service.protocol).split(".")[-1].lower()
            diensten.append(
                {
                    "protocol": naam,
                    "poort": service.port,
                    "pairing_nodig": naam in PAIRING_NODIG,
                    "credentials_aanwezig": bool(service.credentials),
                }
            )
        apparaten.append(
            {
                "naam": atv.name,
                "adres": str(atv.address),
                "identifier": atv.identifier,
                "model": str(getattr(atv, "device_info", "")),
                "diensten": diensten,
            }
        )

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    pad = EXPORT_DIR / "appletv.json"
    pad.write_text(
        json.dumps(
            {
                "bron": "appletv",
                "opgehaald_op": datetime.now(timezone.utc).isoformat(),
                "apparaten": apparaten,
            },
            indent=2,
            ensure_ascii=False,
        )
    )

    if not apparaten:
        print("Niets gevonden. Staat de Mac op hetzelfde (niet-gast) netwerk?")
    for a in apparaten:
        print(f"\n{a['naam']}  {a['adres']}")
        print(f"  identifier: {a['identifier']}")
        for d in a["diensten"]:
            markering = "gepaird" if d["credentials_aanwezig"] else (
                "PAIREN" if d["pairing_nodig"] else "-"
            )
            print(f"    {d['protocol']:<12} poort {d['poort']:<6} {markering}")

    print(f"\nGeschreven: {pad}")
    print("Zet de identifier van je Apple TV in .env als APPLETV_ID.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except ImportError:
        print("pyatv ontbreekt. Draai eerst: make setup")
        sys.exit(1)
