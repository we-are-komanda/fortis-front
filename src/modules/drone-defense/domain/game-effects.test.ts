import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageIntervals, resolveGameEffects, type DefenseUnit, type MovingObject } from "./mass-motion";
import { defaultGameSettings, resolveGameSettings } from "@/shared/lib/game-settings";

const object = (id = 0, endMs = 10000): MovingObject => ({ id, bearingDeg: 0, sector: 0,
  start: { xM: 0, yM: 100, zM: 0 }, end: { xM: 0, yM: 10, zM: 0 }, startMs: 0, endMs, durationMs: endMs });
const unit = (settings = {}): DefenseUnit => ({ id: "u1", xM: 0, yM: 0, radiusM: 200, angleDeg: 360, rotationDeg: 0, quantity: 1,
  gameSettings: { ...defaultGameSettings, intervalMs: 1000, reactionMs: 0, magazineSize: 2, ammunition: 4, reloadMs: 3000, ...settings } });

test("attempt interval, shared magazine and reload determine actual hit time", () => {
  const objects = [object()];
  const draws = [.9, .9, .9, 0];
  resolveGameEffects(objects, [unit()], () => draws.shift()!);
  // Attempts at 0, 1s, reload until 4s, then 5s.
  assert.equal(objects[0].neutralized?.atMs, 5000);
  assert.equal(draws.length, 0);
  assert.equal(objects[0].neutralized?.by, "u1");
});

test("finite and empty ammunition; reload does not create reserve charges", () => {
  for (const ammunition of [0, 1, 3]) {
    const objects = [object()]; let attempts = 0;
    resolveGameEffects(objects, [unit({ ammunition })], () => { attempts++; return .99; });
    assert.equal(attempts, ammunition);
    assert.equal(objects[0].neutralized, undefined);
  }
});

test("reaction and zone exit gate attempts; boundary arrival wins a time tie", () => {
  for (const reactionMs of [10000, 11000]) {
    const objects = [object()];
    resolveGameEffects(objects, [unit({ reactionMs })], () => { assert.fail("already outside"); });
    assert.equal(objects[0].neutralized, undefined);
  }
  const objects = [object()];
  resolveGameEffects(objects, [unit({ reactionMs: 2000 })], () => 0);
  assert.equal(objects[0].neutralized?.atMs, 2000);
  const leaves = [object()];
  resolveGameEffects(leaves, [{ ...unit({ reactionMs: 2000 }), yM: 100, radiusM: 9 }], () => { assert.fail("left the zone during reaction"); });
});

test("cycle capacity causes saturation; quantity gives independent resources", () => {
  const run = (quantity: number, maxTargets: number, ammunition = 10) => {
    const objects = [object(0, 2000), object(1, 2000), object(2, 2000)];
    resolveGameEffects(objects, [{ ...unit({ intervalMs: 5000, maxTargets, magazineSize: 10, ammunition }), quantity }], () => 0);
    return objects.map(o => o.neutralized?.atMs);
  };
  assert.deepEqual(run(1, 1), [0, undefined, undefined]);
  assert.deepEqual(run(1, 2), [0, 0, undefined]);
  assert.deepEqual(run(1, 3, 1), [0, undefined, undefined]);
  assert.deepEqual(run(3, 1, 1), [0, 0, 0]);
});

test("later zones cannot affect an earlier hit; removed targets consume no more ammo", () => {
  const objects = [object(0), object(1)]; let attempts = 0;
  resolveGameEffects(objects, [{ ...unit({ reactionMs: 5000 }), id: "a-late" }, unit()], () => { attempts++; return 0; });
  assert.equal(attempts, 2);
  assert.deepEqual(objects.map(o => [o.neutralized?.by, o.neutralized?.atMs]), [["u1", 0], ["u1", 1000]]);
});

test("settings default only when absent; malformed numbers fail at the boundary", () => {
  assert.deepEqual(resolveGameSettings(undefined), defaultGameSettings);
  for (const patch of [{ intervalMs: 0 }, { reactionMs: NaN }, { reloadMs: Infinity }, { magazineSize: 1.5 }, { ammunition: -1 }, { maxTargets: 0 }]) {
    assert.throws(() => resolveGameSettings({ ...defaultGameSettings, ...patch }));
  }
  assert.throws(() => resolveGameSettings(null));
  assert.throws(() => resolveGameSettings({ intervalMs: 1000 }));
});

test("reflex sector re-entry restarts reaction; no attempts happen in the gap or on a tangent", () => {
  const path = { ...object(0, 8000), start: { xM: -2, yM: -1, zM: 0 }, end: { xM: 2, yM: -1, zM: 0 } };
  const coverage = { ...unit({ reactionMs: 1500, magazineSize: 10, ammunition: 10 }), radiusM: 3, angleDeg: 270 };
  const intervals = coverageIntervals(coverage, path.start, path.end);
  assert.equal(intervals.length, 2);
  for (const [i, expected] of [0, .25, .75, 1].entries()) assert.ok(Math.abs(intervals.flat()[i] - expected) < 1e-10);
  const draws = [.99, 0];
  resolveGameEffects([path], [coverage], () => draws.shift()!);
  assert.equal(draws.length, 0);
  assert.ok(Math.abs(path.neutralized!.atMs - 7500) < 1e-8);
  assert.deepEqual(coverageIntervals({ ...unit(), radiusM: 1 }, { xM: -2, yM: 1, zM: 0 }, { xM: 2, yM: 1, zM: 0 }), []);
});

test("a zero reload duration cannot bypass the cycle interval; a partial last magazine is respected", () => {
  const objects = [object()]; const draws = [.99, .99, 0];
  resolveGameEffects(objects, [unit({ reloadMs: 0, magazineSize: 2, ammunition: 3 })], () => draws.shift()!);
  assert.equal(objects[0].neutralized?.atMs, 2000);
  assert.equal(draws.length, 0);
});

test("work limits fail explicitly instead of returning a truncated game result", () => {
  assert.throws(() => resolveGameEffects([object()], [{ ...unit(), quantity: 1001 }], () => 0), /1000/);
  assert.throws(() => resolveGameEffects([object(0, 120000)], [{ ...unit({ ammunition: 10000, magazineSize: 1000 }), quantity: 1000 }], () => .99), /Слишком много/);
});
