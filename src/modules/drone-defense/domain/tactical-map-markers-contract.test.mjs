import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const gisBoardSource = readFileSync("src/modules/drone-defense/ui/gis-board.tsx", "utf8");
const markerSource = readFileSync("src/modules/drone-defense/ui/map-object-marker.tsx", "utf8");

assert(!gisBoardSource.includes("new IconLayer<BuiltPlacementIcon>"), "Default map object markers must not use bitmap IconLayer previews");
assert(gisBoardSource.includes("<MapObjectMarker"), "GisBoard must render tactical MapObjectMarker overlay markers");
assert(markerSource.includes("<DefenseAssetSymbol"), "MapObjectMarker must use the shared documented tactical symbol");
assert(markerSource.includes("MapMarkerState"), "MapObjectMarker must support marker states");
assert(markerSource.includes("getAssetMarkerIcon"), "MapObjectMarker must map assets to pictograms");
assert(markerSource.includes("shouldShowLabel"), "MapObjectMarker must hide labels except selected, hovered, or close zoom");
assert(markerSource.includes("markerBadge"), "MapObjectMarker must render quantity badges");
assert(!markerSource.includes("placement.isConflict ?"), "MapObjectMarker must not render conflict-specific states");
assert(markerSource.includes("aria-label"), "MapObjectMarker must expose accessible labels");

console.log("tactical-map-markers-contract.test.mjs: tactical map marker contract passed");
