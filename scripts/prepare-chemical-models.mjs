// Reproducible, offline preparation of the five Meshy source GLBs.
// ponytail: supports this verified single-mesh batch; use a glTF pipeline for animated/multi-mesh assets.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MeshoptSimplifier } from "../node_modules/.pnpm/node_modules/meshoptimizer/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = `${root}assets/chemical-pilot-2026-10-20`;
const out = `${root}public/models/chemical-pilot-v1`;
const specs = [
  ["M01-pump", 120000, 0, 3],
  ["M03-heat-exchanger", 50000, 0, 7],
  ["M04-cooling-tower", 80000, 0, 8],
  ["M07-scrubber", 60000, 1, 10],
  ["M16-tanker-truck", 80000, 0, 12],
];
const sha = (data) => createHash("sha256").update(data).digest("hex");
await MeshoptSimplifier.ready;
await mkdir(out, { recursive: true });
const report = [];
for (const [id, target, scaleAxis, lengthM] of specs) {
  const input = await readFile(`${sourceRoot}/models/${id}/${id}-source.glb`);
  assert.equal(input.readUInt32LE(0), 0x46546c67);
  const jsonLength = input.readUInt32LE(12);
  const gltf = JSON.parse(input.subarray(20, 20 + jsonLength).toString());
  const bin = input.subarray(28 + jsonLength);
  assert.equal(gltf.meshes.length, 1);
  assert.equal(gltf.meshes[0].primitives.length, 1);
  assert.deepEqual(gltf.nodes, [{ mesh: 0, matrix: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }]);
  const primitive = gltf.meshes[0].primitives[0];
  assert.equal(primitive.mode, 4);
  assert.deepEqual(Object.keys(primitive.attributes).sort(), ["NORMAL", "POSITION", "TEXCOORD_0"]);
  function accessor(index) {
    const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView];
    assert(!a.sparse && !v.byteStride && !a.normalized);
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const Type = a.componentType === 5126 ? Float32Array : Uint32Array;
    assert([5126, 5125].includes(a.componentType));
    return new Type(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * width).slice();
  }
  const positions = accessor(primitive.attributes.POSITION);
  const normals = accessor(primitive.attributes.NORMAL);
  const uv = accessor(primitive.attributes.TEXCOORD_0);
  const indices = accessor(primitive.indices);
  const attributes = new Float32Array(positions.length / 3 * 5);
  for (let i = 0; i < positions.length / 3; i++) {
    attributes.set(normals.subarray(i * 3, i * 3 + 3), i * 5);
    attributes.set(uv.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
    indices, positions, 3, attributes, 5, [.1, .1, .1, .3, .3], null,
    target * 3, .002,
  );
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(reduced);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  const scale = lengthM / (max[scaleAxis] - min[scaleAxis]);
  const center = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const nextPositions = new Float32Array(vertexCount * 3);
  const nextNormals = new Float32Array(vertexCount * 3);
  const nextUv = new Float32Array(vertexCount * 2);
  for (let i = 0; i < remap.length; i++) {
    if (remap[i] === 0xffffffff) continue;
    for (let c = 0; c < 3; c++) nextPositions[remap[i] * 3 + c] = (positions[i * 3 + c] - center[c]) * scale;
    nextNormals.set(normals.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    nextUv.set(uv.subarray(i * 2, i * 2 + 2), remap[i] * 2);
  }
  const originalImages = gltf.images.map(image => {
    const view = gltf.bufferViews[image.bufferView];
    return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  });
  const chunks = [], views = [];
  let offset = 0;
  function addView(data, target) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    const padding = (4 - bytes.length % 4) % 4;
    chunks.push(Buffer.alloc(padding));
    offset += bytes.length + padding;
    return views.length - 1;
  }
  gltf.accessors = [];
  function addAccessor(data, type, componentType, target, bounds = false) {
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const a = { bufferView: addView(data, target), componentType, count: data.length / width, type };
    if (bounds) {
      a.min = Array(width).fill(Infinity); a.max = Array(width).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        a.min[i % width] = Math.min(a.min[i % width], data[i]);
        a.max[i % width] = Math.max(a.max[i % width], data[i]);
      }
    }
    gltf.accessors.push(a);
    return gltf.accessors.length - 1;
  }
  primitive.attributes = {
    POSITION: addAccessor(nextPositions, "VEC3", 5126, 34962, true),
    NORMAL: addAccessor(nextNormals, "VEC3", 5126, 34962),
    TEXCOORD_0: addAccessor(nextUv, "VEC2", 5126, 34962),
  };
  primitive.indices = addAccessor(reduced, "SCALAR", 5125, 34963);
  gltf.images.forEach((image, i) => { image.bufferView = addView(originalImages[i]); });
  gltf.bufferViews = views;
  gltf.buffers = [{ byteLength: offset }];
  gltf.asset.generator = "Fortis offline meshoptimizer 1.1.1; Meshy 7.1 source";
  gltf.asset.extras = { synthetic: true, units: "metres", up: "Y", pivot: "bottom-center", sourceSha256: sha(input) };
  const json = Buffer.from(JSON.stringify(gltf));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + offset, 8);
  header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(offset); binHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, paddedJson, binHeader, ...chunks]);
  assert.equal(output.length, output.readUInt32LE(8));
  assert(reduced.length < indices.length && reduced.length % 3 === 0);
  assert(nextPositions.every(Number.isFinite) && nextNormals.every(Number.isFinite) && nextUv.every(Number.isFinite));
  assert(reduced.every(index => index < vertexCount));
  const bounds = gltf.accessors[primitive.attributes.POSITION];
  assert(Math.abs(bounds.min[1]) < .03 * lengthM);
  const dimensionsM = bounds.max.map((v, i) => +(v - bounds.min[i]).toFixed(3));
  await writeFile(`${out}/${id}.glb`, output);
  const item = { id, sourceTriangles: indices.length / 3, triangles: reduced.length / 3, bytes: output.length,
    dimensionsM, axisOrder: "X,Y-up,Z", scale, simplificationError: error, sha256: sha(output),
    sourceSha256: sha(input), textureSha256: originalImages.map(sha), texturesUnchanged: true };
  report.push(item);
  console.log(JSON.stringify(item));
}
await writeFile(`${out}/manifest.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${root}src/modules/drone-defense/infra/data/scenario/chemical-models-v1.json`,
  JSON.stringify(report.map(({ id, triangles, dimensionsM, bytes }) => ({ id, triangles, dimensionsM, bytes })), null, 2) + "\n");
