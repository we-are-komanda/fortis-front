import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../public/maps/demo-region/", import.meta.url);
test("offline map is complete, bounded and contains no remote style dependencies", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const style = JSON.parse(await readFile(new URL("style.json", root), "utf8"));
  assert.ok(manifest.tiles <= 3000 && manifest.bytes < 50_000_000);
  assert.ok(!JSON.stringify(style.sources).includes("https://"));
  assert.ok(style.sprite.startsWith("/maps/demo-region/"));
  assert.ok(style.glyphs.startsWith("/maps/demo-region/"));
  const regions = JSON.parse(await readFile(new URL("../src/shared/config/offline-map-regions.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.regions, regions);
  for (const region of regions) {
    const regionStyle = JSON.parse(await readFile(new URL(`style-${region.id}.json`, root), "utf8"));
    assert.deepEqual(regionStyle.sources.openmaptiles.bounds, region.bounds);
    for (let z = 0; z <= manifest.maxzoom; z++) {
      const tile = (lon, lat) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)];
      const [left, top] = tile(region.bounds[0], region.bounds[3]);
      const [right, bottom] = tile(region.bounds[2], region.bounds[1]);
      for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
        assert.ok(manifest.files[`tiles/${z}/${x}/${y}.pbf`], `${region.id}: missing ${z}/${x}/${y}`);
      }
    }
  }
  // Both the bundled legacy demo and the current workspace object must have coverage.
  for (const [lon, lat] of [[37.1, 55.1], [174.7762, -41.2865]]) {
    assert.ok(regions.some(({ bounds: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n));
  }
  const tileCount = Object.keys(manifest.files).filter(path => path.startsWith("tiles/")).length;
  assert.equal(tileCount, manifest.tiles);
  for (const [path, hash] of Object.entries(manifest.files)) {
    const contents = await readFile(new URL(path, root));
    assert.equal(createHash("sha256").update(contents).digest("hex"), hash, path);
  }
});
