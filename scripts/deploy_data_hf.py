"""Upload the published data (data/products/v<version>/) to a Hugging Face dataset, so the web app can read it from
anywhere: Hugging Face serves files with CORS and range requests, which DuckDB in the browser needs.

The token comes from ~/nasa_work/.env (a line HF_TOKEN=hf_...) and is never printed.
Usage:  .venv/bin/python scripts/deploy_data_hf.py <hf_user>/<dataset_name> [--private]
Then build the app with VITE_DATA_URL=https://huggingface.co/datasets/<hf_user>/<dataset_name>/resolve/main/v1.0/
"""
import argparse
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from fireharmony import publish as PB  # noqa: E402

CARD = """---
license: cc-by-4.0
pretty_name: Fire Harmony, one consistent global fire record
tags: [wildfire, remote-sensing, nasa, modis, viirs, firms, h3]
---
# Fire Harmony data (version {version})

One consistent record of vegetation fire hotspots for the whole world, November 2000 to {last}, on the NOAA-20 VIIRS
scale: MODIS (Terra, Aqua) and VIIRS (Suomi NPP, NOAA-20, NOAA-21) hotspots from NASA FIRMS, harmonized so that the
switch of satellites leaves no jump. Built for the NASA Space Apps Challenge 2026.

Files (in `v{version}/`): `area_monthly.parquet` (world, continents, countries and states per month), `map_l3` and
`map_l4` (hexagon maps per month), `cell_l3`, `cell_l4` and `l5/` (hexagon series), `clim_*` (normal seasons),
`drivers*.parquet`, `outlook.parquet`, `haze.parquet`, and `meta.json` / `dashboard.json` / `areas.json` / `haze.json`.

Units: hotspots per month on the NOAA-20 VIIRS scale. Modelled months (before 2012) come with 90% ranges (meta.json).

`hotspots/`: every NASA FIRMS hotspot, {hotspots} of them, one file per H3 level 1 region (`l1=<hex>.parquet`, listed in
`hotspots/index.json`), sorted by date in small row groups. Columns: `date` and `time` (UTC, HHMM), `lat`, `lon`,
`satellite`, `daynight`, `frp` (MW), `confidence` (low, nominal, high), `type` (NASA's label, science quality only),
`quality` (sp or nrt), `h3_5` (the level 5 hexagon) and `counted` (true when the harmonized record counts it).

Please cite the project and NASA FIRMS: "MODIS Collection 6.1 and VIIRS 375 m active fire data from NASA FIRMS
(https://firms.modaps.eosdis.nasa.gov/)". We acknowledge the use of data from NASA's Fire Information for Resource
Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS).
"""


def token() -> str:
    env = REPO.parent / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("HF_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("No HF_TOKEN line in ~/nasa_work/.env")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo_id", help="<hf_user>/<dataset_name>")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--skip-hotspots", action="store_true", help="only the app files, not the 6.5 GB of hotspots")
    ap.add_argument("--hotspots-only", action="store_true", help="only the hotspot files (resume after the app files)")
    ap.add_argument("--batch", type=int, default=40, help="hotspot files per commit")
    ap.add_argument("--hotspots-from", type=int, default=None, help=argparse.SUPPRESS)   # internal: one batch, in its own process
    ap.add_argument("--web-only", action="store_true", help="only web/ (the browser's small files), one folder per commit")
    ap.add_argument("--web-folder", default=None, help=argparse.SUPPRESS)                # internal: one folder, in its own process
    ap.add_argument("--site-archive", action="store_true",
                    help="only v<version>/site_data.tar.gz: every app file in one archive, for the web site's build")
    a = ap.parse_args()
    if a.site_archive:
        return upload_site_archive(a.repo_id)
    if a.hotspots_from is not None:
        return upload_hotspot_batch(a.repo_id, a.hotspots_from, a.batch)
    if a.web_folder is not None:
        return upload_web_folder(a.repo_id, a.web_folder)
    if a.web_only:
        return upload_web(a.repo_id)
    from huggingface_hub import HfApi
    import json
    api = HfApi(token=token())
    api.create_repo(a.repo_id, repo_type="dataset", private=a.private, exist_ok=True)
    meta = json.loads(PB.products("meta.json").read_text())
    last = meta["last_month"]
    hs = meta.get("files", {}).get("hotspots", {})
    card = CARD.format(version=PB.VERSION, last=f"{last // 100}-{last % 100:02d}", hotspots=f"{hs.get('rows', 0):,}")
    api.upload_file(path_or_fileobj=card.encode(), path_in_repo="README.md", repo_id=a.repo_id, repo_type="dataset",
                    commit_message="Dataset card")
    # the app's files in one commit, then the hotspot files in batches: a failed batch can simply be run again
    if not a.hotspots_only:
        api.upload_folder(folder_path=str(PB.products()), path_in_repo=f"v{PB.VERSION}", repo_id=a.repo_id, repo_type="dataset",
                          ignore_patterns=["hotspots/*"], commit_message=f"Fire Harmony data v{PB.VERSION}")
    if not a.skip_hotspots:
        # each batch in a fresh process: the upload library keeps memory between commits (2.3 GB after two batches of
        # 120 files), which this machine cannot spare; files already on the hub are skipped, so a rerun resumes
        names = hotspot_names()
        have = set(api.list_repo_files(a.repo_id, repo_type="dataset"))
        n = (len(names) + a.batch - 1) // a.batch
        for k, i in enumerate(range(0, len(names), a.batch), 1):
            todo = [x for x in names[i:i + a.batch] if f"v{PB.VERSION}/hotspots/{x}" not in have]
            if not todo:
                print(f"hotspots: batch {k}/{n} already on the hub", flush=True)
                continue
            subprocess.run([sys.executable, __file__, a.repo_id, "--hotspots-from", str(i), "--batch", str(a.batch)], check=True)
            print(f"hotspots: batch {k}/{n} uploaded ({len(todo)} files)", flush=True)
    print(f"uploaded {PB.products()} to https://huggingface.co/datasets/{a.repo_id}/tree/main/v{PB.VERSION}")
    print(f"VITE_DATA_URL=https://huggingface.co/datasets/{a.repo_id}/resolve/main/v{PB.VERSION}/")


def upload_site_archive(repo_id: str) -> None:
    """All the files the web app reads (every published file except hotspots/) in one gzip tar archive. The site's
    build downloads this one file and unpacks it: fetching the 12,000 small files one by one takes the build half an
    hour and runs into the hub's request limits. Run it again whenever the published files change."""
    import tarfile
    import tempfile
    from huggingface_hub import HfApi
    root = PB.products()
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.relative_to(root).parts[0] != "hotspots")
    with tempfile.TemporaryDirectory(dir=REPO.parent / "tmp") as tmp:
        out = Path(tmp) / "site_data.tar.gz"
        with tarfile.open(out, "w:gz", compresslevel=6) as tar:
            for f in files:
                tar.add(f, arcname=f.relative_to(root).as_posix(), recursive=False)
        mb = out.stat().st_size / 1e6
        print(f"site archive: {len(files)} files, {mb:.0f} MB", flush=True)
        HfApi(token=token()).upload_file(path_or_fileobj=str(out), path_in_repo=f"v{PB.VERSION}/site_data.tar.gz",
                                         repo_id=repo_id, repo_type="dataset",
                                         commit_message=f"Site archive: {len(files)} app files, {mb:.0f} MB")
    print(f"uploaded https://huggingface.co/datasets/{repo_id}/resolve/main/v{PB.VERSION}/site_data.tar.gz")


def web_folders() -> list[str]:
    """The folders of web/ that hold files, deepest first is not needed: each is uploaded with its own files only."""
    root = PB.products("web")
    return sorted({p.parent.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()})


def upload_web(repo_id: str) -> None:
    for i, folder in enumerate(web_folders(), 1):
        subprocess.run([sys.executable, __file__, repo_id, "--web-folder", folder], check=True)
        print(f"web: {i}/{len(web_folders())} {folder} uploaded", flush=True)
    print(f"web files uploaded to https://huggingface.co/datasets/{repo_id}/tree/main/v{PB.VERSION}/web")


def upload_web_folder(repo_id: str, folder: str) -> None:
    from huggingface_hub import HfApi
    api = HfApi(token=token())
    root = PB.products("web")
    src = root if folder == "." else root / folder
    names = sorted(f.name for f in src.iterdir() if f.is_file())
    target = f"v{PB.VERSION}/web" + ("" if folder == "." else f"/{folder}")
    api.upload_folder(folder_path=str(src), path_in_repo=target, repo_id=repo_id, repo_type="dataset",
                      allow_patterns=names, commit_message=f"Web files: {folder} ({len(names)} files)")


def hotspot_names() -> list[str]:
    return sorted(f.name for f in PB.products("hotspots").iterdir() if f.is_file())


def upload_hotspot_batch(repo_id: str, start: int, count: int) -> None:
    from huggingface_hub import HfApi
    api = HfApi(token=token())
    have = set(api.list_repo_files(repo_id, repo_type="dataset"))
    todo = [x for x in hotspot_names()[start:start + count] if f"v{PB.VERSION}/hotspots/{x}" not in have]
    if todo:
        api.upload_folder(folder_path=str(PB.products("hotspots")), path_in_repo=f"v{PB.VERSION}/hotspots", repo_id=repo_id,
                          repo_type="dataset", allow_patterns=todo, commit_message=f"Hotspots {start + 1} to {start + len(todo)}")


if __name__ == "__main__":
    main()
