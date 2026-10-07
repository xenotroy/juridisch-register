"""KOOP source acquisition. Sources are content-addressed and never overwritten."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
REPO = "https://repository.officiele-overheidspublicaties.nl"
REGULATIONS = {"BWBR0010346": "Arbeidsomstandighedenwet", "BWBR0008498": "Arbeidsomstandighedenbesluit"}

def fetch(url: str, folder: Path, expected_hash: str | None = None) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    # Reuse a previously verified state; manifests and WTI are checked afresh.
    for meta_path in folder.glob("*.source.json"):
        meta = json.loads(meta_path.read_text())
        file = ROOT / meta["file"]
        if expected_hash and meta["url"] == url and file.exists():
            data = file.read_bytes()
            if hashlib.sha256(data).hexdigest() == meta["sha256"] and meta.get("manifest_sha512") == expected_hash:
                return meta
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "VaultTek-legal-register/0.1 (local research)"})
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read()
                final_url = response.url
            ET.fromstring(data)  # Reject error pages, malformed XML and truncated responses.
            digest = hashlib.sha256(data).hexdigest()
            path = folder / (digest + ".xml")
            if not path.exists():
                path.write_bytes(data)
            meta = {"url": url, "resolved_url": final_url, "file": str(path.relative_to(ROOT)),
                    "sha256": digest, "sha512": hashlib.sha512(data).hexdigest(), "bytes": len(data),
                    "retrieved_at": datetime.now(timezone.utc).isoformat(), "parser_version": "0.1.0",
                    "manifest_sha512": expected_hash,
                    "koop_hash_verified": bool(expected_hash) and hashlib.sha512(data).hexdigest() == expected_hash,
                    "xml_parseable": True}
            meta_path = folder / (digest + ".source.json")
            if not meta_path.exists():
                meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
            return meta
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)
    raise AssertionError("unreachable")

def acquire(regulation_id: str) -> dict:
    base = f"{REPO}/bwb/{regulation_id}/"
    folder = ROOT / "data/raw/bwb" / regulation_id
    manifest_source = fetch(base + regulation_id + ".manifest.xml", folder / "manifests")
    manifest = ET.parse(ROOT / manifest_source["file"]).getroot()
    wti = fetch(base + manifest.findtext("metadata/wti_locatie"), folder / "wti")
    jobs = []
    for expression in manifest.findall("expression"):
        for manifestation in expression.findall("manifestation"):
            if manifestation.get("label") != "xml":
                continue
            for item in manifestation.findall("item"):
                if item.get("_deleted") == "true":
                    continue
                label = expression.get("label")
                meta = {c.tag: c.text for c in expression.find("metadata")}
                url = base + label + "/xml/" + item.get("label")
                jobs.append((url, folder / "states", manifestation.findtext("metadata/hashcode"), label, meta))
    def get(job):
        url, dest, digest, label, metadata = job
        return {"label": label, **metadata, "source": fetch(url, dest, digest)}
    with ThreadPoolExecutor(max_workers=3) as executor:
        states = list(executor.map(get, jobs))
    result = {"id": regulation_id, "title": REGULATIONS[regulation_id], "manifest": manifest_source,
              "wti": wti, "manifest_generated": manifest.get("gegenereerd"), "states": states}
    output = ROOT / "data/source-index" / (regulation_id + ".json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"{regulation_id}: {len(states)} states; {sum(s['source']['bytes'] for s in states):,} bytes", flush=True)
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--regulation", choices=list(REGULATIONS))
    parser.add_argument("--publication", help="Official publication identifier, e.g. stb-2022-483")
    args = parser.parse_args()
    if args.publication:
        identifier = args.publication
        if not __import__('re').fullmatch(r'(stb|stcrt|kst)-[A-Za-z0-9-]+', identifier):
            parser.error("Invalid publication identifier")
        meta = fetch(f"{REPO}/externe-publicaties/{identifier}/{identifier}.xml", ROOT / "data/raw/publications" / identifier)
        index = ROOT / "data/source-index/publications.json"
        sources = json.loads(index.read_text()) if index.exists() else {}
        sources[identifier] = meta
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text(json.dumps(sources, indent=2) + "\n")
        print(identifier, meta['bytes'])
    else:
        for identifier in ([args.regulation] if args.regulation else REGULATIONS):
            acquire(identifier)
