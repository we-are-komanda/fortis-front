// Copyright (c) 2026 studio-public-demos. MIT License.
// Source: https://github.com/studio-public-demos/factory-bim
// Revision: 5c6462976981a074e809628eb2a85af3febacfe6
// Adapted: typed helpers, corrected tree-trunk arguments, stable element IDs and disposal.
// Full license: ./factory-bim-model.LICENSE.txt
// Illustrative BIM-style geometry, NOT an IFC/Revit or surveyed plant model.
import * as THREE from "three";
import { factoryBuildings } from "../domain/factory-campus";

export const FACTORY_BIM_LAYERS = [
  { id: "foundation", label: "Фундаменты" },
  { id: "floor", label: "Перекрытия" },
  { id: "columns", label: "Колонны" },
  { id: "beams", label: "Балки" },
  { id: "walls", label: "Наружные стены" },
  { id: "interiorWalls", label: "Перегородки" },
  { id: "doors", label: "Двери" },
  { id: "windows", label: "Окна" },
  { id: "roof", label: "Кровля" },
  { id: "cladding", label: "Обшивка" },
  { id: "equipment", label: "Оборудование" },
  { id: "ductwork", label: "Вентиляция" },
  { id: "electrical", label: "Электрика" },
  { id: "plumbing", label: "Трубопроводы" },
  { id: "landscaping", label: "Территория" },
] as const;

export function createFactoryBimModel(): THREE.Group {
  const scene = new THREE.Group();
  const layers: Record<string, THREE.Object3D[]> = {};
  const allMeshes: THREE.Mesh[] = [];
  const materialMap = new Map();

function mat(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({ color, ...opts });
  m.userData._originalColor = color;
  return m;
}

const M = {
  foundation: mat(0x8B7355, { roughness: 0.9 }),
  floor: mat(0x9CA3AF, { roughness: 0.6 }),
  floorAlt: mat(0x8B8D91, { roughness: 0.5 }),
  column: mat(0x6B7280, { roughness: 0.4, metalness: 0.2 }),
  beam: mat(0x78716C, { roughness: 0.4, metalness: 0.3 }),
  wall: mat(0xE5E7EB, { roughness: 0.7 }),
  wallAlt: mat(0xD1D5DB, { roughness: 0.7 }),
  interiorWall: mat(0xD1D5DB, { roughness: 0.8 }),
  door: mat(0x60A5FA, { roughness: 0.3, metalness: 0.1 }),
  doorFrame: mat(0x475569, { roughness: 0.4, metalness: 0.3 }),
  window: mat(0x38BDF8, { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.6 }),
  roofPanel: mat(0xDC2626, { roughness: 0.5, metalness: 0.1 }),
  roofTruss: mat(0x57534E, { roughness: 0.4, metalness: 0.4 }),
  cladding: mat(0x94A3B8, { roughness: 0.4, metalness: 0.2 }),
  equipment1: mat(0xF59E0B, { roughness: 0.4, metalness: 0.5 }),
  equipment2: mat(0xEF4444, { roughness: 0.5, metalness: 0.3 }),
  equipment3: mat(0x22C55E, { roughness: 0.4, metalness: 0.4 }),
  conveyor: mat(0x44403C, { roughness: 0.3, metalness: 0.6 }),
  ductwork: mat(0x22D3EE, { roughness: 0.3, metalness: 0.6 }),
  ductworkSmall: mat(0x06B6D4, { roughness: 0.3, metalness: 0.6 }),
  electrical: mat(0xA78BFA, { roughness: 0.3, metalness: 0.4 }),
  pipe: mat(0x2DD4BF, { roughness: 0.3, metalness: 0.5 }),
  pipeSmall: mat(0x14B8A6, { roughness: 0.3, metalness: 0.5 }),
  grass: mat(0x166534, { roughness: 0.95 }),
  asphalt: mat(0x374151, { roughness: 0.9 }),
  concrete: mat(0x78716C, { roughness: 0.85 }),
  parkingLine: mat(0xFBBF24, { roughness: 0.5 }),
  green: mat(0x15803D, { roughness: 0.9 }),
  tree: mat(0x166534, { roughness: 0.9 }),
  treeTrunk: mat(0x78350F, { roughness: 0.9 }),
  loadingDock: mat(0x57534E, { roughness: 0.5, metalness: 0.3 }),
  roofSkylight: mat(0xBAE6FD, { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.5 }),
  steel: mat(0x71717A, { roughness: 0.3, metalness: 0.7 }),
};

Object.values(M).forEach(m => materialMap.set(m.uuid, m));

function createBox(geom: THREE.BufferGeometry, material: THREE.Material, layer: string, position: number[], rotation?: number[] | null, castShadow = true, receiveShadow = true) {
  const mesh = new THREE.Mesh(geom, material);
  if (position) mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.userData.layer = layer;
  mesh.userData.type = material.userData._originalColor !== undefined
    ? (Object.keys(M) as (keyof typeof M)[]).find(k => M[k] === material) || 'unknown' : 'unknown';
  scene.add(mesh);
  if (!layers[layer]) layers[layer] = [];
  layers[layer].push(mesh);
  allMeshes.push(mesh);
  return mesh;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rT: number, rB: number, h: number, s = 12) => new THREE.CylinderGeometry(rT, rB, h, s);

const { HALL, OFFICE, WAREHOUSE, DOCK } = factoryBuildings;

function buildFoundation() {
  createBox(box(HALL.w + 2, 0.8, HALL.d + 2), M.foundation, 'foundation',
    [HALL.x, -0.4, HALL.z]);
  createBox(box(OFFICE.w + 2, 0.8, OFFICE.d + 2), M.foundation, 'foundation',
    [OFFICE.x, -0.4, OFFICE.z]);
  createBox(box(WAREHOUSE.w + 2, 0.8, WAREHOUSE.d + 2), M.foundation, 'foundation',
    [WAREHOUSE.x, -0.4, WAREHOUSE.z]);
  createBox(box(DOCK.w + 1, 0.6, DOCK.d + 1), M.foundation, 'foundation',
    [DOCK.x, -0.3, DOCK.z]);

  const footings = [];
  for (let x = HALL.x - HALL.w / 2; x <= HALL.x + HALL.w / 2; x += 8) {
    for (let z = HALL.z - HALL.d / 2; z <= HALL.z + HALL.d / 2; z += 10) {
      footings.push([x, -1.2, z]);
    }
  }
  for (let x = OFFICE.x - OFFICE.w / 2; x <= OFFICE.x + OFFICE.w / 2; x += 8) {
    for (let z = OFFICE.z - OFFICE.d / 2; z <= OFFICE.z + OFFICE.d / 2; z += 8) {
      footings.push([x, -1.2, z]);
    }
  }
  for (let x = WAREHOUSE.x - WAREHOUSE.w / 2; x <= WAREHOUSE.x + WAREHOUSE.w / 2; x += 8) {
    for (let z = WAREHOUSE.z - WAREHOUSE.d / 2; z <= WAREHOUSE.z + WAREHOUSE.d / 2; z += 10) {
      footings.push([x, -1.2, z]);
    }
  }
  footings.forEach(p => createBox(box(1.8, 0.6, 1.8), M.concrete, 'foundation', p));
}

function buildFloors() {
  createBox(box(HALL.w, 0.3, HALL.d), M.floor, 'floor',
    [HALL.x, 0.15, HALL.z]);
  createBox(box(OFFICE.w, 0.3, OFFICE.d), M.floorAlt, 'floor',
    [OFFICE.x, 0.15, OFFICE.z]);
  createBox(box(WAREHOUSE.w, 0.3, WAREHOUSE.d), M.floor, 'floor',
    [WAREHOUSE.x, 0.15, WAREHOUSE.z]);
  createBox(box(DOCK.w, 0.3, DOCK.d), M.floorAlt, 'floor',
    [DOCK.x, 0.15, DOCK.z]);

  for (let floor = 1; floor <= 2; floor++) {
    createBox(box(OFFICE.w - 0.4, 0.25, OFFICE.d - 0.4), M.floorAlt, 'floor',
      [OFFICE.x, floor * 4, OFFICE.z]);
  }

  const gridMat = new THREE.LineBasicMaterial({ color: 0x6B7280, transparent: true, opacity: 0.15 });
  const gridH = new THREE.Group();
  const step = 2;
  const hw = HALL.w / 2, hd = HALL.d / 2;
  for (let x = -hw; x <= hw; x += step) {
    const pts = [new THREE.Vector3(x, 0.31, -hd), new THREE.Vector3(x, 0.31, hd)];
    gridH.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  for (let z = -hd; z <= hd; z += step) {
    const pts = [new THREE.Vector3(-hw, 0.31, z), new THREE.Vector3(hw, 0.31, z)];
    gridH.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  gridH.position.set(HALL.x, 0, HALL.z);
  gridH.userData.layer = 'floor';
  scene.add(gridH);
}

function buildColumns() {
  const colPositions = [];
  for (let x = HALL.x - HALL.w / 2; x <= HALL.x + HALL.w / 2; x += 8) {
    for (let z = HALL.z - HALL.d / 2; z <= HALL.z + HALL.d / 2; z += 10) {
      colPositions.push([x, HALL.wallH / 2, z]);
    }
  }
  for (let x = WAREHOUSE.x - WAREHOUSE.w / 2; x <= WAREHOUSE.x + WAREHOUSE.w / 2; x += 8) {
    for (let z = WAREHOUSE.z - WAREHOUSE.d / 2; z <= WAREHOUSE.z + WAREHOUSE.d / 2; z += 8) {
      colPositions.push([x, WAREHOUSE.wallH / 2, z]);
    }
  }
  colPositions.forEach(p => createBox(box(0.5, p[1] * 2, 0.5), M.column, 'columns', p));

  // DOM statistics are rendered in Fortis.

  for (let x = OFFICE.x - OFFICE.w / 2 + 2; x <= OFFICE.x + OFFICE.w / 2 - 2; x += 7) {
    for (let z = OFFICE.z - OFFICE.d / 2 + 2; z <= OFFICE.z + OFFICE.d / 2 - 2; z += 7) {
      createBox(box(0.35, OFFICE.wallH * 2, 0.35), M.column, 'columns',
        [x, OFFICE.wallH, z]);
    }
  }
}

function buildBeams() {
  for (let x = HALL.x - HALL.w / 2; x <= HALL.x + HALL.w / 2; x += 8) {
    createBox(box(0.4, 0.5, HALL.d), M.beam, 'beams',
      [x, HALL.wallH - 0.25, HALL.z]);
  }
  for (let z = HALL.z - HALL.d / 2; z <= HALL.z + HALL.d / 2; z += 10) {
    createBox(box(HALL.w, 0.5, 0.4), M.beam, 'beams',
      [HALL.x, HALL.wallH - 0.25, z]);
  }
  for (let x = WAREHOUSE.x - WAREHOUSE.w / 2; x <= WAREHOUSE.x + WAREHOUSE.w / 2; x += 8) {
    createBox(box(0.35, 0.45, WAREHOUSE.d), M.beam, 'beams',
      [x, WAREHOUSE.wallH - 0.25, WAREHOUSE.z]);
  }
  for (let z = WAREHOUSE.z - WAREHOUSE.d / 2; z <= WAREHOUSE.z + WAREHOUSE.d / 2; z += 8) {
    createBox(box(WAREHOUSE.w, 0.45, 0.35), M.beam, 'beams',
      [WAREHOUSE.x, WAREHOUSE.wallH - 0.25, z]);
  }
  for (let floor = 1; floor <= 2; floor++) {
    for (let x = OFFICE.x - OFFICE.w / 2; x <= OFFICE.x + OFFICE.w / 2; x += 7) {
      createBox(box(0.3, 0.3, OFFICE.d), M.beam, 'beams',
        [x, floor * 4 - 0.15, OFFICE.z]);
    }
  }
}

function buildWalls() {
  const hw = HALL.w / 2, hd = HALL.d / 2;
  const hx = HALL.x, hz = HALL.z, hh = HALL.wallH;

  createBox(box(HALL.w, hh, 0.4), M.wall, 'walls', [hx, hh / 2, hz + hd]);
  createBox(box(HALL.w, hh, 0.4), M.wall, 'walls', [hx, hh / 2, hz - hd]);
  createBox(box(0.4, hh, HALL.d), M.wall, 'walls', [hx - hw, hh / 2, hz]);

  createBox(box(0.4, hh, HALL.d * 0.3), M.wall, 'walls',
    [hx + hw, hh / 2, hz + hd * 0.2]);
  createBox(box(0.4, hh, HALL.d * 0.3), M.wall, 'walls',
    [hx + hw, hh / 2, hz - hd * 0.2]);

  for (let i = 0; i < 5; i++) {
    const doorX = hx - hw + 6 + i * 9;
    createBox(box(4.5, 5, 0.5), M.door, 'doors',
      [doorX, 2.5, hz + hd]);
    createBox(box(5.2, 5.5, 0.55), M.doorFrame, 'doors',
      [doorX, 2.75, hz + hd + 0.05], null, false);
  }

  for (let i = 0; i < 4; i++) {
    createBox(box(3, 2, 0.45), M.window, 'windows',
      [hx - hw + 8 + i * 11, hh - 3.5, hz + hd + 0.05], null, false);
    createBox(box(3.4, 2.4, 0.48), M.doorFrame, 'windows',
      [hx - hw + 8 + i * 11, hh - 3.5, hz + hd + 0.03], null, false);
  }

  for (let i = 0; i < 4; i++) {
    createBox(box(3, 2.5, 0.45), M.window, 'windows',
      [hx - hw + 8 + i * 11, hh - 3, hz - hd - 0.05], null, false);
  }

  for (let i = 0; i < 3; i++) {
    createBox(box(0.45, 2, 3), M.window, 'windows',
      [hx - hw - 0.05, hh - 3, hz - hd + 6 + i * 9], null, false);
  }

  const wh = WAREHOUSE.wallH;
  const ww = WAREHOUSE.w / 2, wd = WAREHOUSE.d / 2;
  createBox(box(WAREHOUSE.w, wh, 0.35), M.wallAlt, 'walls',
    [WAREHOUSE.x, wh / 2, WAREHOUSE.z - wd]);
  createBox(box(0.35, wh, WAREHOUSE.d), M.wallAlt, 'walls',
    [WAREHOUSE.x - ww, wh / 2, WAREHOUSE.z]);
  createBox(box(WAREHOUSE.w, wh, 0.35), M.wallAlt, 'walls',
    [WAREHOUSE.x, wh / 2, WAREHOUSE.z + wd]);
  createBox(box(0.35, wh, WAREHOUSE.d * 0.4), M.wallAlt, 'walls',
    [WAREHOUSE.x + ww, wh / 2, WAREHOUSE.z + wd * 0.15]);
  createBox(box(0.35, wh, WAREHOUSE.d * 0.4), M.wallAlt, 'walls',
    [WAREHOUSE.x + ww, wh / 2, WAREHOUSE.z - wd * 0.15]);

  createBox(box(8, 7, 0.35), M.door, 'doors',
    [WAREHOUSE.x + ww, 3.5, WAREHOUSE.z]);

  const oh = OFFICE.wallH;
  const ow = OFFICE.w / 2, od = OFFICE.d / 2;
  for (let side = 0; side < 4; side++) {
    const isXWall = side < 2;
    const sign = side % 2 === 0 ? 1 : -1;
    const wLen = isXWall ? OFFICE.w : OFFICE.d;
    const pos = isXWall
      ? [OFFICE.x, oh / 2, OFFICE.z + sign * od]
      : [OFFICE.x + sign * ow, oh / 2, OFFICE.z];

    createBox(
      isXWall ? box(wLen, oh, 0.3) : box(0.3, oh, wLen),
      M.wallAlt, 'walls', pos
    );

    if (isXWall) {
      for (let i = 0; i < 3; i++) {
        createBox(box(2.5, 1.8, 0.35), M.window, 'windows',
          [OFFICE.x - 7 + i * 7, oh - 3, OFFICE.z + sign * od + sign * 0.05], null, false);
      }
    }
  }

  const lobbyDoorX = OFFICE.x - ow;
  createBox(box(0.35, 3.5, 3.5), M.door, 'doors',
    [lobbyDoorX, 1.75, OFFICE.z]);
  createBox(box(0.38, 3.8, 4), M.doorFrame, 'doors',
    [lobbyDoorX, 1.9, OFFICE.z], null, false);
}

function buildInteriorWalls() {
  createBox(box(0.2, HALL.wallH, HALL.d * 0.6), M.interiorWall, 'interiorWalls',
    [HALL.x - 5, HALL.wallH / 2, HALL.z]);

  createBox(box(0.2, HALL.wallH, HALL.d * 0.5), M.interiorWall, 'interiorWalls',
    [HALL.x + 10, HALL.wallH / 2, HALL.z + 3]);

  for (let floor = 0; floor <= 2; floor++) {
    const fy = floor * 4;
    createBox(box(OFFICE.w * 0.7, 4, 0.15), M.interiorWall, 'interiorWalls',
      [OFFICE.x, fy + 2, OFFICE.z - 2]);
    createBox(box(0.15, 4, OFFICE.d * 0.5), M.interiorWall, 'interiorWalls',
      [OFFICE.x + 3, fy + 2, OFFICE.z + 2]);
    if (floor < 2) {
      createBox(box(1.5, 2.5, 0.15), M.door, 'doors',
        [OFFICE.x - 2, fy + 1.25, OFFICE.z - 2]);
    }
  }

  createBox(box(WAREHOUSE.w * 0.4, WAREHOUSE.wallH, 0.15), M.interiorWall, 'interiorWalls',
    [WAREHOUSE.x - 8, WAREHOUSE.wallH / 2, WAREHOUSE.z]);
}

function buildRoof() {
  const hw = HALL.w / 2, hd = HALL.d / 2;
  const hx = HALL.x, hz = HALL.z, hh = HALL.wallH;

  for (let x = hx - hw + 2; x <= hx + hw - 2; x += 6) {
    const trussVerts = [
      new THREE.Vector3(x - 2.5, 0, -hd + 0.2),
      new THREE.Vector3(x + 2.5, 0, -hd + 0.2),
      new THREE.Vector3(x, 2.8, -hd + 0.2),
      new THREE.Vector3(x - 2.5, 0, -hd + 0.2),
    ];
    const trussGeo = new THREE.BufferGeometry().setFromPoints(trussVerts);
    const trussLine = new THREE.Line(trussGeo, new THREE.LineBasicMaterial({ color: 0x57534E }));
    trussLine.position.y = hh;
    trussLine.userData.layer = 'roof';
    scene.add(trussLine);
    if (!layers['roof']) layers['roof'] = [];
    layers['roof'].push(trussLine);

    createBox(box(5, 0.15, 0.12), M.roofTruss, 'roof',
      [x, hh + 1.4, hz - hd + 0.2]);
    createBox(box(0.12, 2.8, 0.12), M.roofTruss, 'roof',
      [x - 2.5, hh + 1.4, hz - hd + 0.2]);
    createBox(box(0.12, 2.8, 0.12), M.roofTruss, 'roof',
      [x + 2.5, hh + 1.4, hz - hd + 0.2]);
    createBox(box(0.12, 2.8, 0.12), M.roofTruss, 'roof',
      [x, hh + 2.8, hz - hd + 0.2]);

    createBox(box(0.12, 2.8, 0.12), M.roofTruss, 'roof',
      [x - 2.5, hh + 1.4, hz + hd - 0.2]);
    createBox(box(0.12, 2.8, 0.12), M.roofTruss, 'roof',
      [x + 2.5, hh + 1.4, hz + hd - 0.2]);
    createBox(box(0.12, 2.8, 0.12), M.roofTruss, 'roof',
      [x, hh + 2.8, hz + hd - 0.2]);
    createBox(box(5, 0.15, 0.12), M.roofTruss, 'roof',
      [x, hh + 1.4, hz + hd - 0.2]);
  }

  for (let z = hz - hd; z <= hz + hd; z += 5) {
    createBox(box(HALL.w, 0.12, 0.1), M.roofTruss, 'roof',
      [hx, hh + 2.8, z]);
    createBox(box(HALL.w, 0.12, 0.1), M.roofTruss, 'roof',
      [hx, hh + 1.4, z]);
  }

  for (let x = hx - hw; x <= hx + hw; x += 8) {
    for (let z = hz - hd + 1; z <= hz + hd - 1; z += 5) {
      createBox(box(4, 0.1, 3.5), M.roofSkylight, 'roof',
        [x, hh + 2.7, z], null, false);
    }
  }

  const roofBase = hh + 2.9;
  for (let x = hx - hw; x <= hx + hw; x += 4) {
    createBox(box(3.8, 0.08, hd * 2), M.roofPanel, 'roof',
      [x, roofBase + 0.05, hz], null, false);
  }

  createBox(box(OFFICE.w, 0.2, OFFICE.d), M.wallAlt, 'roof',
    [OFFICE.x, OFFICE.wallH + 0.1, OFFICE.z]);
  createBox(box(OFFICE.w - 0.3, 0.3, OFFICE.d - 0.3), M.cladding, 'roof',
    [OFFICE.x, OFFICE.wallH + 0.25, OFFICE.z], null, false);

  for (let x = WAREHOUSE.x - WAREHOUSE.w / 2; x <= WAREHOUSE.x + WAREHOUSE.w / 2; x += 4) {
    createBox(box(3.8, 0.1, WAREHOUSE.d), M.roofPanel, 'roof',
      [x, WAREHOUSE.wallH + 0.05, WAREHOUSE.z], null, false);
  }
}

function buildCladding() {
  const hd = HALL.d / 2;
  for (let i = 0; i < 12; i++) {
    const y = 0.5 + i;
    if (y > HALL.wallH - 0.5) break;
    createBox(box(HALL.w, 0.05, 0.05), M.cladding, 'cladding',
      [HALL.x, y, HALL.z + hd + 0.22], null, false);
  }
}

function buildEquipment() {
  for (let i = 0; i < 5; i++) {
    const ex = HALL.x - 16 + i * 8;
    const ez = HALL.z - 8;
    createBox(box(5, 3.5, 2.5), M.equipment1, 'equipment',
      [ex, 1.75 + 0.3, ez]);
    createBox(box(3, 0.3, 1.5), M.equipment2, 'equipment',
      [ex, 3.5 + 0.3, ez]);
    createBox(box(0.3, 2, 0.3), M.equipment1, 'equipment',
      [ex + 1.5, 1 + 0.3, ez + 1]);
    createCylinder(ex - 2, ez, M.equipment3, 0.6, 3);
    createCylinder(ex + 2, ez - 1, M.equipment2, 0.5, 2.5);
  }

  for (let i = 0; i < 4; i++) {
    const ex = HALL.x - 12 + i * 10;
    const ez = HALL.z + 6;
    createBox(box(6, 1.5, 3), M.equipment2, 'equipment',
      [ex, 0.75 + 0.3, ez]);
    createBox(box(0.2, 3, 3), M.steel, 'equipment',
      [ex + 3, 1.5 + 0.3, ez]);
  }

  for (let x = HALL.x - 14; x <= HALL.x + 14; x += 7) {
    createBox(box(0.5, 0.3, HALL.d - 4), M.conveyor, 'equipment',
      [x, 1.2, HALL.z]);
    createBox(box(0.3, 0.6, 0.3), M.conveyor, 'equipment',
      [x - 2.5, 0.9, HALL.z - HALL.d / 2 + 3]);
    createBox(box(0.3, 0.6, 0.3), M.conveyor, 'equipment',
      [x - 2.5, 0.9, HALL.z + HALL.d / 2 - 3]);
  }

  for (let i = 0; i < 3; i++) {
    const wx = WAREHOUSE.x - 12 + i * 12;
    const wz = WAREHOUSE.z;
    createBox(box(8, 5, 6), M.equipment3, 'equipment',
      [wx, 2.5, wz]);
    createBox(box(7.5, 0.3, 5.5), M.floorAlt, 'equipment',
      [wx, 5, wz], null, false);
    for (let shelf = 0; shelf < 4; shelf++) {
      createBox(box(7, 0.15, 5), M.steel, 'equipment',
        [wx, 1.2 + shelf * 1.2, wz], null, false);
    }
  }

  createCylinder(HALL.x + 20, HALL.z - 10, M.equipment2, 1.5, 6);
  createCylinder(HALL.x + 20, HALL.z + 10, M.equipment2, 1.2, 5);

  for (let i = 0; i < 3; i++) {
    const dx = DOCK.x - 12 + i * 12;
    createBox(box(5, 2, 4), M.loadingDock, 'equipment',
      [dx, 1, DOCK.z]);
    createBox(box(3, 0.2, 5), M.steel, 'equipment',
      [dx, 2.1, DOCK.z]);
  }

  for (let i = 0; i < 6; i++) {
    const tx = DOCK.x - 18 + i * 7;
    createBox(box(4, 2.5, 2.5), M.doorFrame, 'equipment',
      [tx, 1.25, DOCK.z + DOCK.d / 2 + 2]);
    createBox(box(2, 1.2, 1), M.equipment1, 'equipment',
      [tx, 0.6, DOCK.z + DOCK.d / 2 + 4]);
    createBox(box(0.4, 0.4, 1.5), M.conveyor, 'equipment',
      [tx - 1, 0.2, DOCK.z + DOCK.d / 2 + 1.5]);
    createBox(box(0.4, 0.4, 1.5), M.conveyor, 'equipment',
      [tx + 1, 0.2, DOCK.z + DOCK.d / 2 + 1.5]);
    createCylinder(tx - 1.5, DOCK.z + DOCK.d / 2 + 0.5, M.conveyor, 0.5, 0.5);
    createCylinder(tx + 1.5, DOCK.z + DOCK.d / 2 + 0.5, M.conveyor, 0.5, 0.5);
  }

  for (let i = 0; i < 4; i++) {
    const bx = OFFICE.x - 6 + i * 4;
    createBox(box(2, 1, 2), M.equipment2, 'equipment',
      [bx, 0.5, OFFICE.z + OFFICE.d / 2 - 2]);
  }
}

function createCylinder(x: number, z: number, material: THREE.Material, radius: number, height: number) {
  const mesh = new THREE.Mesh(cyl(radius, radius, height, 16), material);
  mesh.position.set(x, height / 2 + 0.3, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.layer = 'equipment';
  scene.add(mesh);
  if (!layers['equipment']) layers['equipment'] = [];
  layers['equipment'].push(mesh);
  allMeshes.push(mesh);
  return mesh;
}

function buildDuctwork() {
  const dy = HALL.wallH - 1.5;
  for (let z = HALL.z - 12; z <= HALL.z + 12; z += 8) {
    createBox(box(HALL.w - 4, 1.2, 1.2), M.ductwork, 'ductwork',
      [HALL.x, dy, z]);
    for (let x = HALL.x - 20; x <= HALL.x + 20; x += 8) {
      createCylinderDuct(x, z, M.ductworkSmall, 0.3, 2.5, 'ductwork');
    }
  }

  createBox(box(1, 1, OFFICE.d - 2), M.ductwork, 'ductwork',
    [OFFICE.x - 4, OFFICE.wallH - 1, OFFICE.z]);

  for (let z = WAREHOUSE.z - 6; z <= WAREHOUSE.z + 6; z += 6) {
    createBox(box(WAREHOUSE.w - 4, 0.9, 0.9), M.ductwork, 'ductwork',
      [WAREHOUSE.x, WAREHOUSE.wallH - 1, z]);
  }
}

function createCylinderDuct(x: number, z: number, material: THREE.Material, radius: number, height: number, layer: string) {
  const mesh = new THREE.Mesh(cyl(radius, radius, height, 8), material);
  mesh.position.set(x, height / 2 + HALL.wallH - 2.5, z);
  mesh.castShadow = true;
  mesh.userData.layer = layer;
  scene.add(mesh);
  if (!layers[layer]) layers[layer] = [];
  layers[layer].push(mesh);
  allMeshes.push(mesh);
}

function buildElectrical() {
  const eh = HALL.wallH - 0.5;
  for (let x = HALL.x - HALL.w / 2 + 2; x <= HALL.x + HALL.w / 2 - 2; x += 16) {
    createBox(box(0.1, 0.8, 0.6), M.electrical, 'electrical',
      [HALL.x - HALL.w / 2 + 0.15, eh, x]);
  }

  for (let x = HALL.x - 18; x <= HALL.x + 18; x += 10) {
    createBox(box(0.8, 0.5, 0.3), M.electrical, 'electrical',
      [x, eh - 1, HALL.z + HALL.d / 2 - 0.2]);
  }

  for (let i = 0; i < 3; i++) {
    createBox(box(1.5, 1.2, 0.3), M.electrical, 'electrical',
      [OFFICE.x - OFFICE.w / 2 + 0.2, 2 + i * 4, OFFICE.z - 3 + i * 3]);
  }

  for (let x = WAREHOUSE.x - 20; x <= WAREHOUSE.x + 20; x += 14) {
    createBox(box(0.6, 0.4, 0.3), M.electrical, 'electrical',
      [x, WAREHOUSE.wallH - 0.5, WAREHOUSE.z - WAREHOUSE.d / 2 + 0.2]);
  }
}

function buildPlumbing() {
  const pw = HALL.wallH - 2;
  for (let x = HALL.x - 20; x <= HALL.x + 20; x += 12) {
    createPipeRun(x, HALL.z - HALL.d / 2 + 0.5, HALL.z + HALL.d / 2 - 0.5, pw, M.pipe, 'plumbing');
  }

  createPipeRun(OFFICE.x, OFFICE.z - OFFICE.d / 2, OFFICE.z + OFFICE.d / 2, OFFICE.wallH - 1, M.pipeSmall, 'plumbing');

  for (let x = WAREHOUSE.x - 20; x <= WAREHOUSE.x + 20; x += 10) {
    createPipeRun(x, WAREHOUSE.z - WAREHOUSE.d / 2, WAREHOUSE.z + WAREHOUSE.d / 2, WAREHOUSE.wallH - 1.5, M.pipeSmall, 'plumbing');
  }

  for (let z = HALL.z - 10; z <= HALL.z + 10; z += 5) {
    createBox(box(0.15, 0.15, 8), M.pipe, 'plumbing',
      [HALL.x - 22, pw - 1, z]);
  }
}

function createPipeRun(x: number, zStart: number, zEnd: number, y: number, material: THREE.Material, layer: string) {
  const len = zEnd - zStart;
  createBox(box(0.2, 0.2, len), material, layer, [x, y, zStart + len / 2]);
  createBoxCylinder(x, zStart, y, material, layer, 0.15, 0.5);
  createBoxCylinder(x, zEnd, y, material, layer, 0.15, 0.5);
}

function createBoxCylinder(x: number, z: number, y: number, material: THREE.Material, layer: string, r: number, h: number) {
  const mesh = new THREE.Mesh(cyl(r, r, h, 8), material);
  mesh.position.set(x, y - h / 2, z);
  mesh.userData.layer = layer;
  scene.add(mesh);
  if (!layers[layer]) layers[layer] = [];
  layers[layer].push(mesh);
  allMeshes.push(mesh);
}

function buildLandscaping() {
  createBox(box(120, 0.15, 120), M.grass, 'landscaping', [0, -0.075, 0]);

  createBox(box(HALL.w + 40, 0.2, HALL.d + DOCK.d + 16), M.asphalt, 'landscaping',
    [HALL.x, 0.1, HALL.z + DOCK.d / 2 - 3]);

  createBox(box(OFFICE.w + 20, 0.2, 12), M.asphalt, 'landscaping',
    [OFFICE.x, 0.1, OFFICE.z - OFFICE.d / 2 - 8]);

  for (let i = 0; i < 6; i++) {
    createBox(box(2.5, 0.12, 4.5), M.parkingLine, 'landscaping',
      [DOCK.x - 15 + i * 6, 0.25, DOCK.z + DOCK.d / 2 + 5]);
  }

  createBox(box(WAREHOUSE.w + 10, 0.2, 8), M.asphalt, 'landscaping',
    [WAREHOUSE.x, 0.1, WAREHOUSE.z - WAREHOUSE.d / 2 - 6]);

  const treePositions = [
    [50, 20], [-55, 25], [55, -40], [-55, -45],
    [55, 10], [-55, 10], [50, -10], [-50, -20],
    [65, -25], [-65, 30], [60, 35], [-60, 40],
    [45, -55], [-45, -55], [30, -50], [-30, -50],
  ];
  treePositions.forEach(([tx, tz]) => {
    createBoxCylinder(tx, tz, 2.5, M.treeTrunk, 'landscaping', 0.3, 2.5);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 6), M.tree);
    crown.position.set(tx, 4, tz);
    crown.castShadow = true;
    crown.userData.layer = 'landscaping';
    scene.add(crown);
    if (!layers['landscaping']) layers['landscaping'] = [];
    layers['landscaping'].push(crown);
    allMeshes.push(crown);
  });

  const roadMarkMat = new THREE.LineBasicMaterial({ color: 0xFBBF24 });
  for (let x = HALL.x - 15; x <= HALL.x + 15; x += 3) {
    const pts = [
      new THREE.Vector3(x, 0.25, DOCK.z + DOCK.d / 2 + 2),
      new THREE.Vector3(x + 1.5, 0.25, DOCK.z + DOCK.d / 2 + 2),
    ];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), roadMarkMat);
    line.userData.layer = 'landscaping';
    scene.add(line);
    if (!layers['landscaping']) layers['landscaping'] = [];
    layers['landscaping'].push(line);
  }

  createBox(box(4, 0.08, 0.15), M.green, 'landscaping',
    [OFFICE.x + 2, 0.25, OFFICE.z - OFFICE.d / 2 - 2]);
  createBox(box(4, 0.08, 0.15), M.green, 'landscaping',
    [OFFICE.x + 8, 0.25, OFFICE.z - OFFICE.d / 2 - 2]);
}


  buildFoundation();
  buildFloors();
  buildColumns();
  buildBeams();
  buildWalls();
  buildInteriorWalls();
  buildRoof();
  buildCladding();
  buildEquipment();
  buildDuctwork();
  buildElectrical();
  buildPlumbing();
  buildLandscaping();

  const root = new THREE.Group();
  root.name = "Factory_BIM_Model";
  const groups = new Map();
  for (const definition of FACTORY_BIM_LAYERS) {
    const group = new THREE.Group();
    group.name = "BIM_" + definition.id;
    group.userData.layer = definition.id;
    groups.set(definition.id, group);
    root.add(group);
  }
  for (const element of [...scene.children]) {
    const layer = element.userData.layer;
    const group = groups.get(layer);
    (group || root).add(element);
    if (!element.name) element.name = (element.userData.type || "Element") + "_" + (layer || "other");
  }
  let number = 0;
  root.traverse(element => {
    if (!(element instanceof THREE.Mesh || element instanceof THREE.Line)) return;
    const layer = String(element.userData.layer ?? element.parent?.userData.layer ?? "");
    element.userData = { ...element.userData, layer, objectId: `factory-${layer}-${++number}`, sourceVersion: FACTORY_BIM_REVISION };
    element.name = element.userData.objectId;
  });
  root.updateMatrixWorld(true);
  return root;
}

export const FACTORY_BIM_REVISION = "5c6462976981a074e809628eb2a85af3febacfe6";

export function disposeFactoryBimModel(model: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
