#!/usr/bin/env python3
"""Leest 50five/Shell Recharge laadsessie-exports (.xlsx) in en schrijft ze naar
een groeiend logboek:

    inventaris/export/laadpaal-sessies.csv   (id,start,eind,kwh,kaart,euro_backend)

Zet je geëxporteerde rapporten in  inventaris/import/50five/  (of geef een pad
mee). Sessies worden op ID ontdubbeld, dus je kunt elke maand een nieuwe export
neerzetten zonder dubbelingen. Daarna rekent kosten-bijwerken.mjs de sessies af
tegen je dynamische FlexPrijs en vergelijkt met de vaste vergoeding.

Gebruik:
    python3 scripts/50five/laadpaal_import.py [pad-naar-xlsx-of-map]

Kolommen in de 50five-export: ID, Startdatum, Einddatum, Locatie, Klant, Kaart,
Energie (kWh), Te ontvangen, ...
"""
from __future__ import annotations
import sys, csv, glob
from pathlib import Path
from datetime import datetime

try:
    import openpyxl
except ImportError:
    print("openpyxl ontbreekt. Installeer: pip install openpyxl --break-system-packages")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
IMPORT_DIR = ROOT / "inventaris" / "import" / "50five"
UIT = ROOT / "inventaris" / "export" / "laadpaal-sessies.csv"


def lees_bestaand() -> dict[str, dict]:
    sessies: dict[str, dict] = {}
    if UIT.exists():
        with open(UIT, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                sessies[r["id"]] = r
    return sessies


def parse_xlsx(pad: Path) -> list[dict]:
    wb = openpyxl.load_workbook(pad, data_only=True)
    ws = wb.active
    rijen = list(ws.iter_rows(values_only=True))
    if not rijen:
        return []
    kop = [str(c).strip().lower() if c else "" for c in rijen[0]]

    def kol(*namen):
        for n in namen:
            for i, h in enumerate(kop):
                if n in h:
                    return i
        return -1

    i_id = kol("id")
    i_start = kol("startdatum", "start")
    i_eind = kol("einddatum", "eind", "end")
    i_kaart = kol("kaart", "card")
    i_kwh = kol("energie", "kwh")
    i_euro = kol("te ontvangen", "bedrag", "amount")
    uit = []
    for r in rijen[1:]:
        if i_id < 0 or r[i_id] is None:
            continue
        s, e = r[i_start], r[i_eind]
        if not isinstance(s, datetime) or not isinstance(e, datetime):
            continue
        uit.append({
            "id": str(r[i_id]),
            "start": s.strftime("%Y-%m-%dT%H:%M:%S"),
            "eind": e.strftime("%Y-%m-%dT%H:%M:%S"),
            "kwh": f"{float(r[i_kwh] or 0):.3f}",
            "kaart": str(r[i_kaart] or ""),
            "euro_backend": f"{float(r[i_euro] or 0):.4f}",
        })
    return uit


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg:
        p = Path(arg)
        bestanden = [p] if p.is_file() else sorted(p.glob("*.xlsx"))
    else:
        bestanden = sorted(Path(g) for g in glob.glob(str(IMPORT_DIR / "*.xlsx")))
    if not bestanden:
        print(f"Geen .xlsx gevonden. Zet je 50five-export in {IMPORT_DIR} of geef een pad mee.")
        sys.exit(1)

    sessies = lees_bestaand()
    nieuw = 0
    for b in bestanden:
        for s in parse_xlsx(b):
            if s["id"] not in sessies:
                nieuw += 1
            sessies[s["id"]] = s
        print(f"  gelezen: {b.name}")

    UIT.parent.mkdir(parents=True, exist_ok=True)
    velden = ["id", "start", "eind", "kwh", "kaart", "euro_backend"]
    rijen = sorted(sessies.values(), key=lambda r: r["start"])
    with open(UIT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=velden)
        w.writeheader()
        w.writerows(rijen)

    tot_kwh = sum(float(r["kwh"]) for r in rijen)
    print(f"\n✓ {len(rijen)} sessies in logboek ({nieuw} nieuw), {tot_kwh:.0f} kWh totaal.")
    print(f"  {UIT}")
    print("  Draai nu: node scripts/homey/kosten-bijwerken.mjs")


if __name__ == "__main__":
    main()
