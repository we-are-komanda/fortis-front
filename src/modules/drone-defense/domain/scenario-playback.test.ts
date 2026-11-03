import assert from "node:assert/strict";
import { test } from "node:test";
import data from "../infra/data/scenario/library-v1.json";
import site from "../infra/data/scenario/site-v2.json";
import { factoryUnits, factoryCampusVersion } from "./factory-campus";
import { contours, roads, waterOutline, terrainElevation, trees, terrainGrid, workingZoom, zoomPixelsPerKm } from "./scenario-site";
import { clockAt, DURATION_MS, initialClock, positionAt, transitionClock, validateLibrary, type Library } from "./scenario-playback";
const library = data as Library;
test("authored terrain and curved outlines are finite, closed and reproducible", () => {
  assert.ok(contours.length > 10);
  for (const path of [...contours, ...roads, ...terrainGrid, waterOutline]) {
    assert.ok(path.length > 10);
    assert.ok(path.every(point => point.every(Number.isFinite)));
  }
  waterOutline[0].forEach((coordinate, axis) => assert.ok(Math.abs(coordinate - waterOutline.at(-1)![axis]) < 1e-8));
  site.terrain.roads.forEach((road, i) => {
    assert.deepEqual(roads[i][0], road[0]);
    roads[i].at(-1)!.forEach((coordinate, axis) => assert.ok(Math.abs(coordinate - road.at(-1)![axis]) < 1e-8));
  });
  assert.ok(Math.max(...waterOutline.map(point=>point[1])) >= 16000);
  assert.ok(Math.min(...waterOutline.map(point=>point[1])) <= -16000);
  assert.equal(trees.length, site.terrain.forest.count);
  assert.ok(trees.every(point=>point.every(Number.isFinite)));
  for (const [x,y] of waterOutline) assert.ok(terrainElevation(x,y) >= 0 && terrainElevation(x,y) <= 250);
});
test("all authored movement segments clear the revised terrain and buildings", () => {
  for (const track of library.tracks) for(let t=0;t<=240000;t+=1000){
    const p=positionAt(track,t);
    assert.ok(p.zM>terrainElevation(p.xM,p.yM)+100,`${track.id} terrain clearance at ${t}`);
    for(const b of factoryUnits){
      if(Math.abs(p.xM-b.x)<=67&&Math.abs(p.yM-b.y)<=60)assert.ok(p.zM>16.2+70,`${track.id} roof clearance at ${t}`);
    }
  }
});
test("manifest asset fragments resolve to separately versioned local geometry", () => {
  assert.equal(library.scene.assets.terrain, "site-v2.json#terrain");
  assert.equal(library.scene.assets.enterprise, factoryCampusVersion);
  assert.equal(`${library.scene.id}@${library.scene.version}`, factoryCampusVersion);
  assert.equal(site.terrain.version, library.scene.terrainVersion);
  assert.equal(library.scene.enterpriseModelVersion, 1);
  assert.equal(factoryUnits.length, 4);
  for (const x of [-160, 0, 160]) for (const y of [-160, 0, 160]) {
    assert.equal(terrainElevation(x,y), 0, "campus sits on level terrain");
  }
  assert.ok(site.terrain.hills.length > 1 && site.terrain.roads.length > 0 && site.terrain.river.length > 2);
});
test("exact versions, times, finite coordinates, duplicates and isolated errors", () => {
  assert.equal(validateLibrary(library).valid.length, 3);
  const broken = structuredClone(library);
  broken.tracks[0].sceneRef.version = 2;
  assert.equal(validateLibrary(broken).valid.length, 2);
  for (const corrupt of [
    (l: Library) => { l.tracks[0].samples[1].xM = NaN; },
    (l: Library) => { l.tracks[0].samples[1].tMs = 0; },
    (l: Library) => { l.tracks[0].samples.pop(); },
    (l: Library) => { l.tracks[0].samples = []; },
    (l: Library) => { l.exercises[0].trackRef.version = 99; },
    (l: Library) => { l.exercises[0].events[0].atMs = -1; },
    (l: Library) => { l.exercises[0].events[0].atMs = Infinity; },
    (l: Library) => { l.exercises[0].events[1].id = l.exercises[0].events[0].id; },
  ]) {
    const copy = structuredClone(library); corrupt(copy);
    assert.equal(validateLibrary(copy).valid.length, 2);
  }
  const duplicate = structuredClone(library); duplicate.tracks.push(duplicate.tracks[0]);
  assert.equal(validateLibrary(duplicate).valid.length, 2);
  const manifest = structuredClone(library); manifest.scene.terrainVersion = 9;
  assert.ok(validateLibrary(manifest).sceneError);
  assert.equal(validateLibrary(manifest).valid.length, 0);
  const unsupported = structuredClone(library);
  unsupported.scene.version = 2;
  unsupported.tracks.forEach(track => { track.sceneRef.version = 2; });
  unsupported.exercises.forEach(exercise => { exercise.sceneRef.version = 2; });
  assert.ok(validateLibrary(unsupported).sceneError, "a consistent but unsupported manifest cannot silently render v1 assets");
});
test("monotonic time, pause, continuous rate changes, seek, end and replay", () => {
  let clock = transitionClock(initialClock, { type: "play", now: 100 });
  clock = transitionClock(clock, { type: "rate", rate: 2, now: 1100 });
  assert.equal(clock.timeMs, 1000);
  clock = transitionClock(clock, { type: "pause", now: 2100 });
  assert.equal(clock.timeMs, 3000);
  assert.equal(clockAt(clock, 999999).timeMs, 3000);
  clock = transitionClock(clock, { type: "seek", timeMs: -100, now: 2200 });
  assert.equal(clock.status, "ready");
  clock = transitionClock(clock, { type: "seek", timeMs: 300000, now: 2300 });
  assert.equal(clock.status, "ended"); assert.equal(clock.timeMs, DURATION_MS);
  clock = transitionClock(clock, { type: "play", now: 2400 });
  assert.equal(clock.timeMs, 0);
  assert.equal(clockAt(clock, 124000).timeMs, DURATION_MS);
  assert.equal(clockAt(clock, 124000).status, "ended");
  assert.equal(transitionClock(clock, { type: "reset", now: 2500 }).status, "ready");
});
test("all pairs share one time, interpolation and event history are reversible", () => {
  for (const track of library.tracks) {
    assert.deepEqual(positionAt(track, 0), track.samples[0]);
    assert.deepEqual(positionAt(track, DURATION_MS), track.samples.at(-1));
    assert.equal(positionAt(track, track.samples[1].tMs / 2).xM, (track.samples[0].xM + track.samples[1].xM) / 2);
  }
  for (const pair of [[0, 1], [0, 2], [1, 2]]) {
    const t = clockAt(transitionClock(initialClock, { type: "play", now: 0 }), 105000).timeMs;
    assert.equal(positionAt(library.tracks[pair[0]], t).tMs, positionAt(library.tracks[pair[1]], t).tMs);
  }
  const occurred = (t: number) => library.exercises[0].events.filter(e => e.atMs <= t).map(e => e.id);
  assert.deepEqual(occurred(105000), ["notice", "question"]);
  assert.deepEqual(occurred(0), []);
  assert.deepEqual(occurred(105000), ["notice", "question"]);
});

test("working camera keeps the campus readable with nearby terrain at desktop and phone sizes", () => {
  for (const [width,height] of [[1100,600],[650,500],[390,480]]) {
    const campusPixels = .32 * workingZoom * zoomPixelsPerKm(width,height);
    assert.ok(campusPixels >= width * .23 && campusPixels <= width * .5);
  }
  assert.ok(trees.every(([x,y])=>Math.hypot(x,y)<1000), "local woodland is visible near campus");
  assert.ok(site.terrain.hills.some(h=>Math.hypot(h[0],h[1])<1000 && h[3]<=70));
  for(let y=-1000;y<=1000;y+=100) assert.equal(terrainElevation(400+40*Math.sin(y/400),y),0,"river channel is clear");
});
