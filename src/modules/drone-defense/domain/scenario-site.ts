import asset from "../infra/data/scenario/site-v2.json";
export const site = {
  ...asset.terrain,
  terrainVersion: asset.terrain.version, enterpriseModelVersion: 1,
};
export const trackColors: Record<string, string> = { north: "#2563eb", east: "#b45309", southwest: "#7c3aed" };
export const darkTrackColors: Record<string, string> = { north: "#87b4ff", east: "#f5b46a", southwest: "#c1a0ff" };
// Deterministic local woodland in metres, shared by 2D and 3D.
export const trees = site.forest.positions;
export type ScenarioLayers = { terrain: boolean; enterprise: boolean; tracks: boolean; radius: boolean };

export function terrainElevation(xM: number, yM: number) {
  const hills = site.hills.reduce((sum, [x, y, radius, height]) =>
    sum + height * Math.exp(-2 * (((xM - x) / radius) ** 2 + ((yM - y) / radius) ** 2)), 0);
  const edge = Math.min(1, Math.max(0, (Math.max(Math.abs(xM), Math.abs(yM)) - 170) / 160));
  const bank = Math.min(1, Math.max(0, (Math.abs(xM - (400 + 40 * Math.sin(yM / 400))) - 25) / 50));
  return Math.max(0, hills - 2) * edge * edge * (3 - 2 * edge) * bank;
}

export const contours = site.hills.flatMap(([x, y, hillRadius]) =>
  [.35, .55, .75, .95, 1.15].map(scale =>
    Array.from({ length: 97 }, (_, index) => {
      const angle = index / 96 * Math.PI * 2;
      const radius = scale * hillRadius;
      return [x + Math.cos(angle) * radius * (1 + .08 * Math.sin(angle * 3)), y + Math.sin(angle) * radius * .72];
    })));

// Fixed interpolation of authored geometry, shared by 2D and 3D; no route generation.
export function smoothGeometry(points: number[][], closed = false) {
  const count = closed ? points.length : points.length - 1;
  return Array.from({ length: count * 12 + 1 }, (_, step) => {
    const index = Math.min(count - 1, Math.floor(step / 12));
    const t = step === count * 12 ? 1 : step / 12 - index;
    const point = (offset: number) => points[closed ? (index + offset + points.length) % points.length : Math.max(0, Math.min(points.length - 1, index + offset))];
    const [a, b, c, d] = [-1, 0, 1, 2].map(point);
    return [0, 1].map(axis => .5 * (2 * b[axis] + (-a[axis] + c[axis]) * t + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t + (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t));
  });
}
export const waterOutline = smoothGeometry(site.river, true);
export const roads = site.roads.map(road => smoothGeometry(road));

// Faint reference map tessellation follows the surface; one batched draw in 3D.
export const terrainGrid = Array.from({length: 47}, (_, i) => -16100 + i * 700).flatMap(axis => [
  Array.from({length: 65}, (_, i) => [axis, -16000 + i * 500]),
  Array.from({length: 65}, (_, i) => [-16000 + i * 500, axis]),
]);

// Camera presets change the view, never the physical dimensions of the scene.
export const workingZoom = 24;
export function zoomPixelsPerKm(width: number, height: number) {
  return Math.min(width * .48, height * .58) / (10 / 1.06);
}
