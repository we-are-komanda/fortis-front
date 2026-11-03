export const factoryCampusVersion = "factory-campus@1";
export const factoryCampusSize = 320;
export const factoryCampusZoom = 48;
// Slightly raised finished grade keeps the factory ground clear of the scenario terrain.
export const factoryCampusGrade = 0.2;

// Local ENU metres. Four original-size plots, 40 m between their 120 m grounds.
export const factoryUnits = [
  { id: "F01", name: "Комплекс 1 · северо-запад", x: -80, y: 80 },
  { id: "F02", name: "Комплекс 2 · северо-восток", x: 80, y: 80 },
  { id: "F03", name: "Комплекс 3 · юго-запад", x: -80, y: -80 },
  { id: "F04", name: "Комплекс 4 · юго-восток", x: 80, y: -80 },
] as const;

// Shared by the original procedural generator and the scenario's 2D footprint.
export const factoryBuildings = {
  HALL: { x: -15, z: 0, w: 48, d: 30, wallH: 12 },
  OFFICE: { x: 39, z: -15, w: 22, d: 18, wallH: 8 },
  WAREHOUSE: { x: -15, z: -35, w: 48, d: 16, wallH: 10 },
  DOCK: { x: -15, z: 23, w: 48, d: 7 },
};
