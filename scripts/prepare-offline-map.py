"""Download bounded OpenFreeMap areas, within its offline-use limits."""
import concurrent.futures
import gzip
import hashlib
import json
import math
from pathlib import Path
import threading
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / "public/maps/demo-region"
REGIONS = json.loads((ROOT.parents[2] / "src/shared/config/offline-map-regions.json").read_text())
MAX_ZOOM = 14
LIMIT = 45_000_000  # Headroom below the provider's 50 MB / 3,000-tile ceiling.
LOCK = threading.Lock()
sizes = {}


def download(url, relative):
    path = ROOT / relative
    if path.exists():
        data = path.read_bytes()
    else:
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "FortisDemo/0.1 (offline-region; github.com/Ramilko37/fortis-front)", "Accept-Encoding": "identity"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    data = response.read()
                    if response.headers.get("Content-Encoding") == "gzip":
                        data = gzip.decompress(data)
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    with LOCK:
        sizes[relative] = len(data)
        if sum(sizes.values()) > LIMIT:
            raise RuntimeError("Offline area exceeds download budget; reduce the bounds/zoom")
    return data


def tile(lon, lat, zoom):
    n = 2 ** zoom
    return (int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    style = json.loads(download("https://tiles.openfreemap.org/styles/bright", "source-style.json"))
    metadata = json.loads(download("https://tiles.openfreemap.org/planet", "source-tilejson.json"))
    requests = set()
    for region in REGIONS:
        bounds = region["bounds"]
        for z in range(MAX_ZOOM + 1):
            left, top = tile(bounds[0], bounds[3], z)
            right, bottom = tile(bounds[2], bounds[1], z)
            for x in range(left, right + 1):
                for y in range(top, bottom + 1):
                    requests.add((metadata["tiles"][0].format(z=z, x=x, y=y), f"tiles/{z}/{x}/{y}.pbf"))
    requests = sorted(requests)
    tile_count = len(requests)
    assert tile_count <= 3000
    for suffix in [".json", ".png", "@2x.json", "@2x.png"]:
        requests.append((style["sprite"] + suffix, "sprite" + suffix))
    fonts = sorted({font for layer in style["layers"] for font in layer.get("layout", {}).get("text-font", [])})
    for font in fonts:
        for start in [*range(0, 2048, 256), 8192, 65280]:
            glyph_range = f"{start}-{start + 255}"
            url = style["glyphs"].replace("{fontstack}", urllib.parse.quote(font)).replace("{range}", glyph_range)
            requests.append((url, f"fonts/{font}/{glyph_range}.pbf"))
    print(f"Downloading {tile_count} tiles + local fonts/sprites, max 4 requests", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for index, _ in enumerate(pool.map(lambda args: download(*args), requests), 1):
            if index % 50 == 0:
                print(f"{index}/{len(requests)} files, {sum(sizes.values()) / 1e6:.1f} MB", flush=True)
    style["layers"] = [layer for layer in style["layers"] if layer.get("source") != "ne2_shaded"]
    style["glyphs"] = "/maps/demo-region/fonts/{fontstack}/{range}.pbf"
    style["sprite"] = "/maps/demo-region/sprite"
    for region in REGIONS:
        style["name"] = "Fortis — " + region["title"]
        style["sources"] = {"openmaptiles": {"type": "vector", "tiles": ["/maps/demo-region/tiles/{z}/{x}/{y}.pbf"], "bounds": region["bounds"], "minzoom": 0, "maxzoom": MAX_ZOOM}}
        serialized = json.dumps(style, ensure_ascii=False, separators=(",", ":"))
        (ROOT / f"style-{region['id']}.json").write_text(serialized)
        if region == REGIONS[0]:
            (ROOT / "style.json").write_text(serialized)
    manifest = {"regions": REGIONS, "maxzoom": MAX_ZOOM, "tiles": tile_count, "bytes": sum(sizes.values()), "source": metadata["tiles"][0], "attribution": "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors", "files": {relative: hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() for relative in sizes}}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"Offline map ready: {tile_count} tiles, {manifest['bytes'] / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
