import { test } from "node:test";
import assert from "node:assert/strict";
import data from "../infra/data/scenario/library-v1.json";
import { generateRun, frameAt, summarizeRun, summarizeBatch, computeBatch, type MotionConfig, type DefenseUnit, sectorAt, protectionRule } from "./mass-motion";
import { factoryUnits } from "./factory-campus";
import { initialClock, transitionClock, clockAt, formatTime, type Library } from "./scenario-playback";

const library = data as Library;
const config: MotionConfig = { durationMs: 5400000, count: 500, seed: 42, scatter: .25 };
test("seed reproduces schedules and bearings; zero temporal scatter only fixes timing", () => {
  assert.deepEqual(generateRun(config, library, 3), generateRun(config, library, 3));
  assert.notDeepEqual(generateRun(config, library, 3).objects, generateRun(config, library, 4).objects);
  const times = (index: number) => generateRun({ ...config, scatter: 0 }, library, index).objects.map(o => [o.startMs, o.endMs]);
  assert.deepEqual(times(3), times(4));
  const bearings = (scatter: number, index: number) => generateRun({ ...config, scatter }, library, index).objects.map(o => o.bearingDeg);
  assert.deepEqual(bearings(0, 3), bearings(.5, 3));
  assert.notDeepEqual(bearings(0, 3), bearings(0, 4));
});
test("all schedules fit their horizon; statuses and interpolation agree at boundaries", () => {
  for (const durationMs of [1800000, 3600000, 5400000]) for (const count of [1, 100, 300, 500, 1000]) {
    const run = generateRun({ ...config, durationMs, count }, library, 0);
    assert.equal(run.objects.length, count);
    for (const object of run.objects) assert.ok(object.startMs >= 0 && object.endMs <= durationMs && object.endMs > object.startMs);
    const first = run.objects[0];
    const before = frameAt(run, first.startMs - 1);
    assert.ok(!before.markers.some(m => m.id === first.id));
    const atStart = frameAt(run, first.startMs);
    const marker = atStart.markers.find(m => m.id === first.id)!;
    assert.deepEqual([marker.xM, marker.yM, marker.zM], [first.start.xM, first.start.yM, first.start.zM]);
    assert.ok(!frameAt(run, first.endMs).markers.some(m => m.id === first.id));
    for (const t of [0, durationMs / 2, durationMs]) {
      const frame = frameAt(run, t);
      assert.equal(frame.waiting + frame.markers.length + frame.finished, count);
    }
    assert.equal(frameAt(run, durationMs).finished, count);
  }
});
test("invalid inputs and incompatible scene fail before generation", () => {
  for (const patch of [{ count: 0 }, { count: 1001 }, { count: 1.5 }, { seed: -1 }, { seed: 2 ** 32 }, { seed: NaN }, { scatter: .6 }, { scatter: Infinity }, { durationMs: 240000 }, { durationMs: 5460000 }, { durationMs: 1800001 }, { durationMs: NaN }, { durationMs: Infinity }]) {
    assert.throws(() => generateRun({ ...config, ...patch }, library, 0));
  }
  assert.throws(() => generateRun(config, library, -1));
  assert.throws(() => generateRun(config, library, 1.5));
  assert.deepEqual(generateRun(config, { ...library, tracks: [] }, 0), generateRun(config, library, 0));
  assert.throws(() => generateRun(config, { ...library, scene: { ...library.scene, version: 999 } }, 0));
});
test("intermediate slider values work and uniform timing has equal appearance intervals", () => {
  const run = generateRun({ ...config, durationMs: 37 * 60000, count: 237, scatter: 0 }, library, 0);
  const interval = (run.durationMs - 240000) / 236;
  run.objects.forEach((object, index) => {
    assert.equal(object.durationMs, 240000);
    assert.ok(Math.abs(object.startMs - index * interval) < 1e-8);
  });
  assert.equal(frameAt(run, run.durationMs).finished, 237);
});
test("exact event sweep handles simultaneous end/start and nearest-rank quantiles", () => {
  const objects = [[0, 10], [5, 15], [10, 20]].map(([startMs, endMs], id) => ({ ...generateRun(config, library, 0).objects[id], sector: id % 2, startMs, endMs, durationMs: endMs - startMs }));
  const result = summarizeRun({ objects, durationMs: 20, index: 0, seed: 1 });
  assert.equal(result.peak, 2);
  assert.equal(result.mean, 1.5);
  assert.deepEqual(result.sectorPeaks, [1, 1, 0, 0, 0, 0, 0, 0]);  assert.deepEqual(result.curve, [{ timeMs: 0, active: 1 }, { timeMs: 5, active: 2 }, { timeMs: 10, active: 2 }, { timeMs: 15, active: 1 }, { timeMs: 20, active: 0 }]);
  assert.deepEqual(summarizeBatch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(peak => ({ peak, mean: 1, sectorPeaks: Array(8).fill(peak), neutralizedRate: peak / 10 }))),
    { min: 1, median: 5, p90: 9, max: 10, meanActive: 1, sectorP90: Array(8).fill(9), neutralizedRates: { min: .1, median: .5, p90: .9, max: 1 } });
});
test("batch uses the same runs, reports completion and supports cancellation", async () => {
  const progress: number[] = [];
  const results = await computeBatch(config, library, 100, new AbortController().signal, n => progress.push(n));
  assert.equal(results.length, 100);
  assert.equal(progress.at(-1), 100);
  assert.equal(results[17].peak, summarizeRun(generateRun(config, library, 17)).peak);
  const cancel = new AbortController();
  await assert.rejects(computeBatch(config, library, 500, cancel.signal, () => cancel.abort()), { name: "AbortError" });
});
test("90-minute clock can seek, accelerate, pause and finish without four-minute clamping", () => {
  const duration = 5400000;
  let clock = transitionClock(initialClock, { type: "seek", timeMs: 5300000, now: 10 }, duration);
  clock = transitionClock(clock, { type: "rate", rate: 60, now: 10 }, duration);
  clock = transitionClock(clock, { type: "play", now: 10 }, duration);
  assert.equal(clockAt(clock, 1010, duration).timeMs, 5360000);
  clock = transitionClock(clock, { type: "pause", now: 1010 }, duration);
  assert.equal(clockAt(clock, 2000, duration).timeMs, 5360000);
  assert.equal(formatTime(duration, duration), "90:00");
  assert.equal(transitionClock(clock, { type: "seek", timeMs: duration, now: 2010 }, duration).status, "ended");
});

test("continuous 360-degree entries cover all sectors and do not depend on three reference tracks", () => {
  const run = generateRun({ ...config, count: 1000 }, library, 0);
  assert.equal(new Set(run.objects.map(o => o.bearingDeg)).size, 1000);
  const sectors = Array(8).fill(0);
  for (const object of run.objects) {
    sectors[object.sector]++;
    assert.ok(object.bearingDeg >= 0 && object.bearingDeg < 360);
    assert.ok(Math.abs(Math.hypot(object.start.xM, object.start.yM) - 10000) < 1e-8);
    assert.ok(Math.abs(Math.hypot(object.end.xM, object.end.yM) - protectionRule.radiusM) < 1e-8);
    assert.equal(object.start.zM, 0);
    assert.equal(object.end.zM, 0);
    const t = (object.startMs + object.endMs) / 2;
    const marker = frameAt(run, t).markers.find(m => m.id === object.id)!;
    assert.ok(Math.abs(Math.hypot(marker.xM, marker.yM) - (10000 + protectionRule.radiusM) / 2) < 1e-7);
    assert.ok(Math.hypot(marker.tail.xM, marker.tail.yM) > Math.hypot(marker.xM, marker.yM));
  }
  assert.ok(sectors.every(count => count > 80 && count < 180), String(sectors));
  assert.deepEqual([0, 22.499, 22.5, 90, 180, 270, 337.5, 359.999].map(sectorAt), [0, 0, 1, 2, 4, 6, 0, 0]);
  assert.equal(summarizeRun(run).sectorCounts.reduce((a, b) => a + b), 1000);
});
test("training boundary encloses all plots; each arrival produces one replayable signal", () => {
  for (const unit of factoryUnits) for (const dx of [-60, 60]) for (const dy of [-60, 60]) {
    assert.ok(Math.hypot(unit.x + dx, unit.y + dy) < protectionRule.radiusM);
  }
  const run = generateRun({ ...config, count: 1, scatter: 0 }, library, 0);
  const object = run.objects[0];
  const before = frameAt(run, object.endMs - 1);
  assert.equal(before.events.length, 0);
  assert.equal(before.signals.length, 0);
  assert.equal(before.markers.length, 1);
  const at = frameAt(run, object.endMs);
  assert.equal(at.events.length, 1);
  assert.equal(at.finished, 1);
  assert.equal(at.markers.length, 0);
  assert.equal(at.signals[0].triggered, true);
  assert.deepEqual([at.signals[0].xM, at.signals[0].yM], [object.end.xM, object.end.yM]);
  assert.equal(frameAt(run, object.endMs + protectionRule.signalDurationMs - 1).signals.length, 1);
  assert.equal(frameAt(run, object.endMs + protectionRule.signalDurationMs).signals.length, 0);
  assert.equal(frameAt(run, run.durationMs).events.length, 1);
  assert.deepEqual(frameAt(run, object.endMs), at);
  assert.equal(frameAt(run, 0).events.length, 0);
});
test("event history follows scenario time through jumps and has no duplicate arrivals", () => {
  const run = generateRun(config, library, 2);
  for (const t of [run.durationMs, 2700000, 500000, 0, run.durationMs]) {
    const frame = frameAt(run, t);
    assert.equal(frame.events.length, frame.finished);
    assert.equal(new Set(frame.events.map(o => o.id)).size, frame.finished);
    assert.ok(frame.events.every((o, i) => o.endMs <= t && (i === 0 || frame.events[i - 1].endMs >= o.endMs)));
    assert.ok(frame.signals.length + frame.markers.length <= config.count);
  }
});
test("sector event peaks match direct state counts", () => {
  const run = generateRun({ ...config, count: 100 }, library, 7);
  const summary = summarizeRun(run);
  const peaks = Array(8).fill(0);
  for (const { timeMs } of summary.curve) {
    const counts = Array(8).fill(0);
    frameAt(run, timeMs).markers.forEach(marker => counts[marker.sector]++);
    counts.forEach((count, sector) => peaks[sector] = Math.max(peaks[sector], count));
  }
  assert.deepEqual(summary.sectorPeaks, peaks);
});

const originUnit = (quantity = 1): DefenseUnit => ({ id: "u1", xM: 0, yM: 0, radiusM: 1000, angleDeg: 360, rotationDeg: 0, quantity });
test("coverage draws are deterministic, per-object and independent of coverage config", () => {
  assert.deepEqual(generateRun(config, library, 3, protectionRule.radiusM, [originUnit()]), generateRun(config, library, 3, protectionRule.radiusM, [originUnit()]));
  // Routes never depend on placed coverage: timings and geometry stay identical.
  const without = generateRun(config, library, 3), withUnit = generateRun(config, library, 3, protectionRule.radiusM, [originUnit()]);
  assert.deepEqual(without.objects.map(o => ({ id: o.id, bearingDeg: o.bearingDeg, sector: o.sector, start: o.start, end: o.end, startMs: o.startMs, endMs: o.endMs, durationMs: o.durationMs })),
    withUnit.objects.map(o => ({ id: o.id, bearingDeg: o.bearingDeg, sector: o.sector, start: o.start, end: o.end, startMs: o.startMs, endMs: o.endMs, durationMs: o.durationMs })));
});
test("neutralized objects stop at coverage entry and never reach the boundary", () => {
  const base = generateRun(config, library, 5, protectionRule.radiusM, []);
  const run = generateRun(config, library, 5, protectionRule.radiusM, [originUnit()]);
  const neutralizedObjects = run.objects.filter(object => object.neutralized !== undefined);
  assert.ok(neutralizedObjects.length > 0 && neutralizedObjects.length < run.objects.length, String(neutralizedObjects.length));
  for (const object of neutralizedObjects) {
    // Unit sits on the shared radial line, so entry fraction is the radius ratio along the path.
    const fraction = object.neutralized!.atMs - object.startMs === 0 ? 0 : (object.neutralized!.atMs - object.startMs) / object.durationMs;
    assert.ok(Number.isFinite(fraction) && fraction >= 0 && fraction < 1);
    assert.ok(Math.abs(Math.hypot(object.neutralized!.xM, object.neutralized!.yM) - (10000 - fraction * (10000 - protectionRule.radiusM))) < 1e-6);
    assert.ok(Math.abs(Math.hypot(object.neutralized!.xM, object.neutralized!.yM) - 1000) < 1e-6);
    const frame = frameAt(run, object.neutralized!.atMs);
    assert.ok(frame.intercepts.some(marker => marker.id === object.id && marker.neutralized && marker.by === "u1"));
    assert.ok(!frame.markers.some(marker => marker.id === object.id));
    assert.ok(!frame.events.some(event => event.id === object.id));
  }
  assert.ok(base.objects.every(object => object.neutralized === undefined));
  const last = neutralizedObjects.at(-1)!;
  assert.ok(!frameAt(run, last.neutralized!.atMs - 1).intercepts.some(marker => marker.id === last.id));
  for (const t of [0, run.durationMs / 2, run.durationMs]) {
    const frame = frameAt(run, t);
    assert.equal(frame.waiting + frame.markers.length + frame.finished + frame.neutralized, run.objects.length);
  }
});
test("more covering units can only raise neutralization; sectors and quantities gate the outcome", () => {
  const base = new Set(generateRun(config, library, 9, protectionRule.radiusM, [originUnit()]).objects.filter(object => object.neutralized !== undefined).map(object => object.id));
  const stronger = new Set(generateRun(config, library, 9, protectionRule.radiusM, [originUnit(), { id: "u2", xM: 0, yM: 0, radiusM: 1000, angleDeg: 360, rotationDeg: 0, quantity: 3 }]).objects.filter(object => object.neutralized !== undefined).map(object => object.id));
  assert.ok(stronger.size >= base.size && [...base].every(id => stronger.has(id)), `${base.size} -> ${stronger.size}`);
  assert.ok(base.size > 0 && stronger.size > base.size);
  // Conditional zone: only objects whose approach line crosses the north-facing sector can be covered.
  const sectorUnit: DefenseUnit = { id: "s1", xM: 0, yM: 0, radiusM: 1000, angleDeg: 90, rotationDeg: 0, quantity: 1 };
  const sectorRun = generateRun(config, library, 11, protectionRule.radiusM, [sectorUnit]);
  for (const object of sectorRun.objects.filter(object => object.neutralized !== undefined)) {
    const diff = Math.abs(((object.bearingDeg + 540) % 360) - 180);
    assert.ok(diff <= 45, `${object.bearingDeg}`);
  }
  assert.ok(sectorRun.objects.some(object => object.neutralized !== undefined));
});
test("defense unit validation rejects broken configurations", () => {
  for (const unit of [{ id: "", xM: 0, yM: 0, radiusM: 100, angleDeg: 360, rotationDeg: 0, quantity: 1 },
    { id: "u", xM: NaN, yM: 0, radiusM: 100, angleDeg: 360, rotationDeg: 0, quantity: 1 },
    { id: "u", xM: 0, yM: 0, radiusM: 0, angleDeg: 360, rotationDeg: 0, quantity: 1 },
    { id: "u", xM: 0, yM: 0, radiusM: 100, angleDeg: 0, rotationDeg: 0, quantity: 1 },
    { id: "u", xM: 0, yM: 0, radiusM: 100, angleDeg: 400, rotationDeg: 0, quantity: 1 },
    { id: "u", xM: 0, yM: 0, radiusM: 100, angleDeg: 360, rotationDeg: 0, quantity: 0 },
    { id: "u", xM: 0, yM: 0, radiusM: 100, angleDeg: 360, rotationDeg: 0, quantity: 1.5 }]) {
    assert.throws(() => generateRun(config, library, 0, protectionRule.radiusM, [unit as DefenseUnit]));
  }
  assert.throws(() => generateRun(config, library, 0, protectionRule.radiusM, [originUnit(), originUnit()]));
});
