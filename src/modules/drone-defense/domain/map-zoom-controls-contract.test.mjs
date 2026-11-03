import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gisBoardSource = readFileSync("src/modules/drone-defense/ui/gis-board.tsx", "utf8");

assert(
  gisBoardSource.includes('aria-label="Приблизить карту"') &&
    gisBoardSource.includes('onClick={() => adjustMapZoom(1)}') &&
    gisBoardSource.includes('aria-label="Отдалить карту"') &&
    gisBoardSource.includes('onClick={() => adjustMapZoom(-1)}'),
  "GisBoard must expose clickable map zoom controls",
);
assert(
  gisBoardSource.includes("adjustMapZoom"),
  "GisBoard zoom controls must update the controlled deck.gl view state",
);
assert(
  gisBoardSource.includes("const deckControllerOptions") &&
    gisBoardSource.includes("scrollZoom: { speed: 0.00125 / 3, smooth: true }") &&
    gisBoardSource.includes("controller={deckControllerOptions}"),
  "GisBoard must slow down touchpad wheel zoom through explicit deck.gl controller options",
);
assert(
  gisBoardSource.includes("handleMapWheelZoomGuard") &&
    gisBoardSource.includes('addEventListener("wheel", handleMapWheelZoomGuard, { passive: false })'),
  "GisBoard must install a non-passive wheel guard on the map container",
);
assert(
  gisBoardSource.includes("event.ctrlKey || event.metaKey") && gisBoardSource.includes("event.preventDefault()"),
  "GisBoard must block browser page zoom gestures inside the map",
);
assert(
  gisBoardSource.includes("handleMapGestureZoomGuard") && gisBoardSource.includes('addEventListener("gesturestart"'),
  "GisBoard must block WebKit gesture zoom events inside the map",
);

console.log("map-zoom-controls-contract.test.mjs: map zoom controls and page zoom guard are wired");
