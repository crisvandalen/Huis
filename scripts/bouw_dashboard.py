#!/usr/bin/env python3
"""Bouwt dashboard/index.html uit de JSON-exports in inventaris/export/.

Eén los HTML-bestand, geen server nodig: dubbelklikken opent het. Bedoeld als
overzicht van wat er in huis hangt, niet als live besturing.
"""

from __future__ import annotations

import html
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "inventaris" / "export"
UIT = ROOT / "dashboard" / "index.html"

KLEUREN = {
    "homey": "#1f6feb",
    "tahoma": "#c9700f",
    "appletv": "#6e40c9",
}


def lees(naam: str) -> dict | None:
    pad = EXPORT_DIR / naam
    if not pad.exists():
        return None
    return json.loads(pad.read_text())


def esc(x) -> str:
    return html.escape(str(x if x is not None else ""))


def rijen_homey(data) -> list[dict]:
    if not data:
        return []
    return [
        {
            "bron": "homey",
            "naam": a.get("naam"),
            "plek": a.get("zone") or "—",
            "soort": a.get("klasse") or "—",
            "detail": ", ".join(a.get("capabilities", [])[:6]),
        }
        for a in data.get("apparaten", [])
    ]


def rijen_tahoma(data) -> list[dict]:
    if not data:
        return []
    return [
        {
            "bron": "tahoma",
            "naam": a.get("label"),
            "plek": "—",
            "soort": a.get("type") or "—",
            "detail": ", ".join(sorted(a.get("toestanden", {}).keys())[:4]),
        }
        for a in data.get("apparaten", [])
    ]


def rijen_appletv(data) -> list[dict]:
    if not data:
        return []
    return [
        {
            "bron": "appletv",
            "naam": a.get("naam"),
            "plek": "—",
            "soort": "media",
            "detail": ", ".join(d["protocol"] for d in a.get("diensten", [])),
        }
        for a in data.get("apparaten", [])
    ]


def main() -> None:
    bronnen = {
        "homey": lees("homey.json"),
        "tahoma": lees("tahoma.json"),
        "appletv": lees("appletv.json"),
    }
    rijen = rijen_homey(bronnen["homey"]) + rijen_tahoma(bronnen["tahoma"]) + rijen_appletv(
        bronnen["appletv"]
    )

    per_bron = Counter(r["bron"] for r in rijen)
    per_plek: dict[str, int] = defaultdict(int)
    for r in rijen:
        per_plek[r["plek"]] += 1

    ontbreekt = [naam for naam, d in bronnen.items() if d is None]

    kaarten = "".join(
        f'<div class="kaart"><div class="getal" style="color:{KLEUREN[b]}">{n}</div>'
        f'<div class="label">{b}</div></div>'
        for b, n in sorted(per_bron.items())
    )
    kaarten += (
        f'<div class="kaart"><div class="getal">{len(rijen)}</div>'
        f'<div class="label">totaal</div></div>'
    )

    tabelrijen = "".join(
        f'<tr data-bron="{r["bron"]}">'
        f'<td><span class="pil" style="background:{KLEUREN[r["bron"]]}">{r["bron"]}</span></td>'
        f"<td>{esc(r['naam'])}</td><td>{esc(r['plek'])}</td>"
        f"<td>{esc(r['soort'])}</td><td class=\"zacht\">{esc(r['detail'])}</td></tr>"
        for r in sorted(rijen, key=lambda r: (r["plek"], str(r["naam"])))
    )

    waarschuwing = (
        f'<p class="waarschuwing">Nog geen export voor: {", ".join(ontbreekt)}. '
        f"Draai <code>make inventaris</code>.</p>"
        if ontbreekt
        else ""
    )

    doc = f"""<!doctype html>
<html lang="nl">
<meta charset="utf-8">
<title>Huis — inventaris</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {{ color-scheme: light dark; --rand:#8883; --zacht:#8a8a8a; }}
  body {{ font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         margin:0; padding:2rem clamp(1rem,4vw,3rem); }}
  h1 {{ font-size:1.5rem; margin:0 0 .25rem; }}
  .zacht {{ color:var(--zacht); }}
  .kaarten {{ display:flex; gap:.75rem; flex-wrap:wrap; margin:1.5rem 0; }}
  .kaart {{ border:1px solid var(--rand); border-radius:10px; padding:.9rem 1.4rem; min-width:96px; }}
  .getal {{ font-size:1.9rem; font-weight:600; line-height:1; }}
  .label {{ font-size:.8rem; color:var(--zacht); text-transform:uppercase; letter-spacing:.04em; }}
  table {{ border-collapse:collapse; width:100%; }}
  th,td {{ text-align:left; padding:.5rem .7rem; border-bottom:1px solid var(--rand); }}
  th {{ font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; color:var(--zacht); }}
  .pil {{ color:#fff; border-radius:99px; padding:.1rem .55rem; font-size:.72rem; }}
  .waarschuwing {{ border-left:3px solid #d9822b; padding:.5rem .8rem; background:#d9822b18; }}
  code {{ font-size:.85em; }}
  button {{ font:inherit; border:1px solid var(--rand); background:none; color:inherit;
            border-radius:99px; padding:.25rem .8rem; cursor:pointer; }}
  button[aria-pressed="true"] {{ background:#8882; }}
</style>
<h1>Huis — inventaris</h1>
<p class="zacht">Gegenereerd op {datetime.now().strftime('%d-%m-%Y %H:%M')} · momentopname, geen live status</p>
{waarschuwing}
<div class="kaarten">{kaarten}</div>
<p>
  <button aria-pressed="true" data-filter="alles">alles</button>
  {"".join(f'<button aria-pressed="false" data-filter="{b}">{b}</button>' for b in sorted(per_bron))}
</p>
<table>
  <thead><tr><th>bron</th><th>naam</th><th>plek</th><th>soort</th><th>details</th></tr></thead>
  <tbody>{tabelrijen}</tbody>
</table>
<script>
  const knoppen = document.querySelectorAll("button[data-filter]");
  knoppen.forEach(k => k.addEventListener("click", () => {{
    knoppen.forEach(a => a.setAttribute("aria-pressed", String(a === k)));
    const f = k.dataset.filter;
    document.querySelectorAll("tbody tr").forEach(tr => {{
      tr.style.display = (f === "alles" || tr.dataset.bron === f) ? "" : "none";
    }});
  }}));
</script>
</html>
"""

    UIT.parent.mkdir(parents=True, exist_ok=True)
    UIT.write_text(doc)
    print(f"{len(rijen)} apparaten -> {UIT}")


if __name__ == "__main__":
    main()
