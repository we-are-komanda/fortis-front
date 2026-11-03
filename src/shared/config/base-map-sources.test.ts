// Run: pnpm exec tsx src/shared/config/base-map-sources.test.ts

import {
  createBaseMapSources,
  getAvailableBaseMapSources,
  resolveDefaultBaseMapSourceId,
  resolveMapStyle,
} from "@/shared/config/base-map-sources";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function testEnv(env: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...env } as NodeJS.ProcessEnv;
}

const defaultSources = createBaseMapSources(testEnv());

const openFreeMap = defaultSources.find((source) => source.id === "openfreemap-bright");
assert(openFreeMap, "registry must include openfreemap-bright");
assert(openFreeMap.type === "vector-style-url", "openfreemap-bright must be a vector style source");
assert(
  resolveMapStyle(openFreeMap) === "https://tiles.openfreemap.org/styles/bright",
  "openfreemap-bright must resolve to the official Bright style URL",
);

const osmStandard = defaultSources.find((source) => source.id === "osm-standard");
assert(osmStandard, "registry must include osm-standard");
const osmStyle = resolveMapStyle(osmStandard);
assert(typeof osmStyle !== "string", "raster xyz sources must resolve to an inline MapLibre style");
const osmRasterSource = osmStyle.sources.raster;
assert(
  osmRasterSource.type === "raster" &&
    "tiles" in osmRasterSource &&
    osmRasterSource.tiles?.[0] === "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "osm-standard must resolve to the official OSM raster tile endpoint",
);

const topographic = defaultSources.find((source) => source.id === "topographic");
assert(topographic, "registry must include topographic source");
const topographicStyle = resolveMapStyle(topographic);
assert(typeof topographicStyle !== "string", "topographic raster source must resolve to an inline style");
const topographicRasterSource = topographicStyle.sources.raster;
assert(
  topographicRasterSource.type === "raster" &&
    "tiles" in topographicRasterSource &&
    topographicRasterSource.tiles?.[0] === "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  "topographic source must default to the OpenTopoMap raster endpoint",
);

const satelliteDemo = defaultSources.find((source) => source.id === "satellite-demo");
assert(satelliteDemo && !satelliteDemo.enabled, "satellite-demo must stay disabled until explicitly configured");

const internalByDefault = defaultSources.find((source) => source.id === "internal-basemap");
assert(internalByDefault?.enabled, "internal basemap must provide a local closed-contour fallback");
assert(internalByDefault.type === "local-style-json", "default internal basemap must use an offline local style");

const closedContourSources = getAvailableBaseMapSources(testEnv({
  NEXT_PUBLIC_FORTIS_ALLOW_EXTERNAL_BASEMAPS: "false",
}));
assert(
  closedContourSources.length === 1 && closedContourSources[0].id === "internal-basemap",
  "closed contour mode must hide external basemaps and leave only the internal source",
);
assert(
  resolveDefaultBaseMapSourceId(closedContourSources, testEnv({
    NEXT_PUBLIC_FORTIS_DEFAULT_BASEMAP: "openfreemap-bright",
  })) === "internal-basemap",
  "closed contour mode must fall back to an allowed internal source when the configured default is external",
);

const configuredInternal = createBaseMapSources(testEnv({
  NEXT_PUBLIC_FORTIS_INTERNAL_BASEMAP_STYLE_URL: "/maps/internal/style.json",
}));
const configuredInternalSource = configuredInternal.find((source) => source.id === "internal-basemap");
assert(configuredInternalSource?.type === "vector-style-url", "internal basemap style URL env must override local fallback type");
assert(
  resolveMapStyle(configuredInternalSource) === "/maps/internal/style.json",
  "internal basemap style URL env must be passed through as the selected style",
);

const yandexEnv = testEnv({ NEXT_PUBLIC_FORTIS_YANDEX_MAPS_API_KEY: "test-key&injected=1" });
const yandexSources = getAvailableBaseMapSources(yandexEnv);
const yandex = yandexSources.find(source => source.id === "yandex-maps");
assert(yandex, "Yandex Tiles API must be available when a key is configured");
assert(!getAvailableBaseMapSources(testEnv()).some(source => source.id === "yandex-maps"), "Yandex must stay unavailable without a key");
assert(!getAvailableBaseMapSources({...yandexEnv, NEXT_PUBLIC_FORTIS_ALLOW_EXTERNAL_BASEMAPS: "false"}).some(source => source.id === "yandex-maps"), "Closed contour must exclude Yandex even with a key");
const yandexStyle = resolveMapStyle(yandex);
assert(typeof yandexStyle !== "string", "Yandex must use the existing raster renderer");
const yandexRaster = yandexStyle.sources.raster;
assert(yandexRaster.type === "raster" && yandexRaster.tiles?.length === 1, "Yandex must have one official tile endpoint");
const yandexUrl = new URL(yandexRaster.tiles[0]);
assert(yandexUrl.origin === "https://tiles.api-maps.yandex.ru", "Yandex tiles must use the official API");
assert(yandexUrl.searchParams.get("apikey") === "test-key&injected=1" && !yandexUrl.searchParams.has("injected"), "API key must be escaped as a query value");
assert(yandexUrl.searchParams.get("projection") === "web_mercator", "Yandex must match DeckGL and MapLibre coordinates");
assert(yandexRaster.maxzoom === 20 && yandexRaster.tileSize === 256, "Zoom beyond 20 must overzoom supported Yandex tiles");
assert(resolveDefaultBaseMapSourceId(yandexSources, yandexEnv) === "yandex-maps", "Configured Yandex must become the default");
assert(resolveDefaultBaseMapSourceId(yandexSources, {...yandexEnv, NEXT_PUBLIC_FORTIS_DEFAULT_BASEMAP: "osm-standard"}) === "osm-standard", "An explicit default must still be respected");
