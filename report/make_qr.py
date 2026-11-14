"""QR codes for the report's title page, one per link in report.qmd's front matter (links: label, url, qr).
Run again whenever a link changes:  ../.venv/bin/python make_qr.py"""
import re
from pathlib import Path

import segno
import yaml

here = Path(__file__).parent
front = re.match(r"---\n(.*?)\n---\n", (here / "report.qmd").read_text(), re.S).group(1)
for link in yaml.safe_load(front).get("links", []):
    out = here / link["qr"]
    out.parent.mkdir(parents=True, exist_ok=True)
    segno.make(link["url"], error="m").save(out, scale=8, border=0, dark="#0b0b0b", light=None)
    print(f"{out.name}: {link['url']}")
