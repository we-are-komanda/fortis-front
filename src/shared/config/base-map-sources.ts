import type { StyleSpecification } from "maplibre-gl";

export type BaseMapSourceType =
  | "vector-style-url"
  | "raster-xyz"
  | "wmts"
  | "local-style-json"
  | "pmtiles";

export type BaseMapSourceCategory =
  | "base"
  | "topographic"
  | "satellite"
  | "internal"
  | "custom";

export interface BaseMapSource {
  id: string;
  title: string;
  description?: string;
  category: BaseMapSourceCategory;
  type: BaseMapSourceType;
  url?: string;
  tiles?: string[];
  styleUrl?: string;
  styleJson?: StyleSpecification;
  minZoom?: number;
  maxZoom?: number;
  tileSize?: 256 | 512;
  attribution?: string;
  enabled: boolean;
  isExternal: boolean;
  isOpenData?: boolean;
  isSelfHostedReady?: boolean;
  requiresApiKey?: boolean;
  requiresLicenseCheck?: boolean;
  allowedInClosedContour?: boolean;
}

const openFreeMapAttribution =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const osmAttribution =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const openTopoMapAttribution =
  'Map data: © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | DEM: <a href="http://viewfinderpanoramas.org" target="_blank" rel="noreferrer">SRTM</a>, <a href="https://sonny.4lima.de/" target="_blank" rel="noreferrer">Sonny</a> | Map style: © <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC-BY-SA</a>)';

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseCsv(value: string | undefined) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRequiredString(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildRasterStyle(source: BaseMapSource): StyleSpecification {
  if (!source.tiles?.length) {
    throw new Error(`Basemap source "${source.id}" is missing raster tiles.`);
  }

  return {
    version: 8,
    sources: {
      raster: {
        type: "raster",
        tiles: source.tiles,
        tileSize: source.tileSize ?? 256,
        attribution: source.attribution,
      },
    },
    layers: [
      {
        id: `${source.id}-raster`,
        type: "raster",
        source: "raster",
      },
    ],
  };
}

function buildInternalBaseMapSource(env: NodeJS.ProcessEnv): BaseMapSource {
  const styleUrl = readRequiredString(env.NEXT_PUBLIC_FORTIS_INTERNAL_BASEMAP_STYLE_URL);
  if (styleUrl) {
    return {
      id: "internal-basemap",
      title: "Internal basemap",
      description: "Локальная или self-hosted подложка для закрытого контура.",
      category: "internal",
      type: "vector-style-url",
      styleUrl,
      attribution: readRequiredString(env.NEXT_PUBLIC_FORTIS_INTERNAL_BASEMAP_ATTRIBUTION),
      enabled: true,
      isExternal: false,
      isSelfHostedReady: true,
      allowedInClosedContour: true,
    };
  }

  const internalTiles = parseCsv(env.NEXT_PUBLIC_FORTIS_INTERNAL_BASEMAP_TILES);
  if (internalTiles?.length) {
    const internalType = env.NEXT_PUBLIC_FORTIS_INTERNAL_BASEMAP_TYPE === "wmts" ? "wmts" : "raster-xyz";
    return {
      id: "internal-basemap",
      title: "Internal basemap",
      description: "Self-hosted raster/WMTS подложка для закрытого контура.",
      category: "internal",
      type: internalType,
      tiles: internalTiles,
      attribution: readRequiredString(env.NEXT_PUBLIC_FORTIS_INTERNAL_BASEMAP_ATTRIBUTION),
      tileSize: 256,
      enabled: true,
      isExternal: false,
      isSelfHostedReady: true,
      allowedInClosedContour: true,
    };
  }

  return {
    id: "internal-basemap",
    title: "Локальная карта · 2 района",
    description: "Два района по 20×20 км: Завод Альфа и Тестовое предприятие. Без интернета.",
    category: "internal",
    type: "local-style-json",
    url: "/maps/demo-region/style.json",
    attribution: openFreeMapAttribution,
    enabled: true,
    isExternal: false,
    isSelfHostedReady: true,
    allowedInClosedContour: true,
  };
}

export function createBaseMapSources(env: NodeJS.ProcessEnv = process.env): BaseMapSource[] {
  const topographicTiles =
    parseCsv(env.NEXT_PUBLIC_FORTIS_TOPOGRAPHIC_BASEMAP_TILES) ?? ["https://tile.opentopomap.org/{z}/{x}/{y}.png"];
  const satelliteTiles = parseCsv(env.NEXT_PUBLIC_FORTIS_SATELLITE_BASEMAP_TILES);

  return [
    {
      id: "openfreemap-bright",
      title: "OpenFreeMap Bright",
      description: "Open-source OSM-based vector style for demo/dev.",
      category: "base",
      type: "vector-style-url",
      styleUrl: "https://tiles.openfreemap.org/styles/bright",
      attribution: openFreeMapAttribution,
      enabled: true,
      isExternal: true,
      isOpenData: true,
      isSelfHostedReady: true,
      allowedInClosedContour: false,
    },
    {
      id: "osm-standard",
      title: "OSM Standard",
      description: "Dev/demo raster fallback. Not a production dependency.",
      category: "base",
      type: "raster-xyz",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxZoom: 19,
      attribution: osmAttribution,
      enabled: true,
      isExternal: true,
      isOpenData: true,
      requiresLicenseCheck: true,
      allowedInClosedContour: false,
    },
    {
      id: "topographic",
      title: "Topographic",
      description: "Configurable topo raster source for demo and planning contexts.",
      category: "topographic",
      type: "raster-xyz",
      tiles: topographicTiles,
      tileSize: 256,
      maxZoom: 17,
      attribution: readRequiredString(env.NEXT_PUBLIC_FORTIS_TOPOGRAPHIC_BASEMAP_ATTRIBUTION) ?? openTopoMapAttribution,
      enabled: topographicTiles.length > 0,
      isExternal: true,
      isOpenData: true,
      isSelfHostedReady: true,
      requiresLicenseCheck: true,
      allowedInClosedContour: false,
    },
    {
      id: "satellite-demo",
      title: "Satellite demo",
      description: "Optional satellite/orthophoto source enabled only after legal review.",
      category: "satellite",
      type: env.NEXT_PUBLIC_FORTIS_SATELLITE_BASEMAP_TYPE === "wmts" ? "wmts" : "raster-xyz",
      tiles: satelliteTiles,
      tileSize: 256,
      attribution: readRequiredString(env.NEXT_PUBLIC_FORTIS_SATELLITE_BASEMAP_ATTRIBUTION),
      enabled: Boolean(satelliteTiles?.length),
      isExternal: true,
      requiresLicenseCheck: true,
      allowedInClosedContour: false,
    },
    buildInternalBaseMapSource(env),
  ];
}

export function getAvailableBaseMapSources(env: NodeJS.ProcessEnv = process.env) {
  const allowExternalBaseMaps = parseBoolean(env.NEXT_PUBLIC_FORTIS_ALLOW_EXTERNAL_BASEMAPS, true);
  return createBaseMapSources(env).filter((source) => {
    if (!source.enabled) return false;
    if (allowExternalBaseMaps) return true;
    return source.allowedInClosedContour === true;
  });
}

export function resolveDefaultBaseMapSourceId(
  availableSources = getAvailableBaseMapSources(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const configuredDefault = readRequiredString(env.NEXT_PUBLIC_FORTIS_DEFAULT_BASEMAP);
  if (configuredDefault && availableSources.some((source) => source.id === configuredDefault)) {
    return configuredDefault;
  }

  const preferredDefault = availableSources.find((source) => source.id === "openfreemap-bright");
  if (preferredDefault) return preferredDefault.id;

  const fallback = availableSources[0];
  if (!fallback) {
    throw new Error("No basemap sources are available for the current Fortis environment.");
  }

  return fallback.id;
}

export function resolveMapStyle(source: BaseMapSource): string | StyleSpecification {
  switch (source.type) {
    case "vector-style-url": {
      if (!source.styleUrl) {
        throw new Error(`Basemap source "${source.id}" is missing styleUrl.`);
      }
      return source.styleUrl;
    }
    case "raster-xyz":
    case "wmts":
      return buildRasterStyle(source);
    case "local-style-json": {
      if (source.styleJson) return source.styleJson;
      if (source.url) return source.url;
      throw new Error(`Basemap source "${source.id}" is missing local style JSON.`);
    }
    case "pmtiles":
      throw new Error(`Basemap source "${source.id}" requires PMTiles support, which is not enabled in this build.`);
    default:
      return buildRasterStyle(source);
  }
}
