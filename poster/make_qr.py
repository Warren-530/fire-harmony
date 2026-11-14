"""QR codes for the poster, from LINKS in poster.typ. Run again whenever a link changes: ../.venv/bin/python make_qr.py"""
import re
from pathlib import Path

import segno

here = Path(__file__).parent
for url, qr in re.findall(r'url: "([^"]+)", qr: "([^"]+)"', (here / "poster.typ").read_text()):
    out = here / qr
    out.parent.mkdir(parents=True, exist_ok=True)
    segno.make(url, error="m").save(out, scale=8, border=0, dark="#0b0b0b", light=None)
    print(f"{out.name}: {url}")
