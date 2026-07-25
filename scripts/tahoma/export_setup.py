#!/usr/bin/env python3
"""Leest de Somfy TaHoma-setup uit (Overkiz) en schrijft naar inventaris/export/.

Werkt in twee standen, gestuurd door TAHOMA_MODE in .env:

  cloud  - gebruikersnaam + wachtwoord van je TaHoma-account. Ondersteunt
           alles, inclusief scenario's. Rate limits tijdens piekuren.
  local  - developer mode + token op de gateway (poort 8443). Sneller en
           werkt zonder internet, maar géén scenario's en géén climate.

Let op: Somfy heeft developer mode op sommige gateways (o.a. de Connectivity
Kit) uitgeschakeld. Werkt local niet, gebruik dan cloud.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "inventaris" / "export"


def laad_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for regel in env.read_text().splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#") or "=" not in regel:
            continue
        sleutel, waarde = regel.split("=", 1)
        os.environ.setdefault(sleutel.strip(), waarde.strip().strip("\"'"))


def maak_client(session):
    """Bouwt een OverkizClient. pyoverkiz heeft twee API-stijlen gehad;
    we proberen de nieuwe (credentials-objecten) en vallen terug op de oude."""
    from pyoverkiz.client import OverkizClient  # type: ignore

    mode = os.environ.get("TAHOMA_MODE", "cloud").lower()

    if mode == "local":
        host = os.environ["TAHOMA_LOCAL_HOST"]
        token = os.environ["TAHOMA_LOCAL_TOKEN"]
        verify_ssl = os.environ.get("TAHOMA_VERIFY_SSL", "true").lower() == "true"
        from pyoverkiz.const import OverkizServer  # type: ignore

        server = OverkizServer(
            name="Somfy TaHoma (local)",
            endpoint=f"https://{host}:8443/enduser-mobile-web/1/enduserAPI/",
            manufacturer="Somfy",
            configuration_url=None,
        )
        try:
            from pyoverkiz.auth.credentials import LocalTokenCredentials  # type: ignore

            return OverkizClient(
                server=server,
                credentials=LocalTokenCredentials(token),
                session=session,
                verify_ssl=verify_ssl,
            )
        except ImportError:
            return OverkizClient(
                username="",
                password="",
                token=token,
                session=session,
                verify_ssl=verify_ssl,
                server=server,
            )

    # cloud
    gebruiker = os.environ["TAHOMA_USERNAME"]
    wachtwoord = os.environ["TAHOMA_PASSWORD"]
    servernaam = os.environ.get("TAHOMA_SERVER", "SOMFY_EUROPE").upper()

    try:
        from pyoverkiz.auth.credentials import UsernamePasswordCredentials  # type: ignore
        from pyoverkiz.enums import Server  # type: ignore

        return OverkizClient(
            server=getattr(Server, servernaam),
            credentials=UsernamePasswordCredentials(gebruiker, wachtwoord),
            session=session,
        )
    except ImportError:
        from pyoverkiz.const import SUPPORTED_SERVERS  # type: ignore

        return OverkizClient(
            username=gebruiker,
            password=wachtwoord,
            session=session,
            server=SUPPORTED_SERVERS[servernaam.lower()],
        )


def vereenvoudig(device) -> dict:
    return {
        "label": getattr(device, "label", None),
        "device_url": getattr(device, "device_url", None),
        "type": str(getattr(device, "widget", "") or getattr(device, "ui_class", "")),
        "controllable_name": getattr(device, "controllable_name", None),
        "beschikbaar": getattr(device, "available", None),
        "commando_namen": sorted(
            {getattr(c, "command_name", str(c)) for c in getattr(device, "definition", None).commands}
        )
        if getattr(device, "definition", None) is not None
        else [],
        "toestanden": {
            getattr(s, "name", "?"): getattr(s, "value", None)
            for s in (getattr(device, "states", None) or [])
        },
    }


async def main() -> int:
    laad_env()
    import aiohttp  # type: ignore

    mode = os.environ.get("TAHOMA_MODE", "cloud").lower()
    print(f"TaHoma uitlezen in '{mode}'-modus ...")

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    async with aiohttp.ClientSession() as session:
        client = maak_client(session)
        async with client:
            await client.login()
            devices = await client.get_devices()

            scenarios = []
            if mode != "local":
                try:
                    scenarios = [
                        {"oid": s.oid, "label": s.label} for s in await client.get_scenarios()
                    ]
                except Exception as err:  # noqa: BLE001
                    print(f"  scenario's overgeslagen: {err}")

    resultaat = {
        "bron": "tahoma",
        "modus": mode,
        "opgehaald_op": datetime.now(timezone.utc).isoformat(),
        "apparaten": [vereenvoudig(d) for d in devices],
        "scenarios": scenarios,
    }

    pad = EXPORT_DIR / "tahoma.json"
    pad.write_text(json.dumps(resultaat, indent=2, ensure_ascii=False, default=str))

    print(f"\n{len(devices)} apparaten, {len(scenarios)} scenario's")
    for d in devices:
        print(f"  - {getattr(d, 'label', '?')}  ({getattr(d, 'widget', '')})")
    print(f"\nGeschreven: {pad}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyError as err:
        print(f"Ontbrekende instelling in .env: {err}")
        sys.exit(1)
    except Exception as err:  # noqa: BLE001
        print(f"Mislukt: {err}")
        sys.exit(1)
