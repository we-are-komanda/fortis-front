import { DURATION_MS, validateLibrary, type Library, type Sample } from "./scenario-playback";
import { factoryCampusSize } from "./factory-campus";

export const motionVersion = "mass-motion@3";
// A schematic training boundary around the whole campus, not equipment coverage.
export const protectionRule = { id: "training-boundary@1", radiusM: factoryCampusSize, signalDurationMs: 60000 } as const;
export type MotionConfig = { durationMs: number; count: number; seed: number; scatter: number };
type Point = Pick<Sample, "xM" | "yM" | "zM">;
export const sectorLabels = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
export const sectorColors = ["#2563eb", "#0284c7", "#0d9488", "#4d7c0f", "#b45309", "#dc2626", "#9333ea", "#db2777"];
export const darkSectorColors = ["#93b8ff", "#7dd3fc", "#5eead4", "#bef264", "#fdba74", "#fca5a5", "#d8b4fe", "#f9a8d4"];
export const sectorAt = (bearingDeg: number) => Math.floor((bearingDeg + 22.5) % 360 / 45);
export type MovingObject = { id: number; bearingDeg: number; sector: number; start: Point; end: Point; startMs: number; endMs: number; durationMs: number };
export type MotionMarker = Sample & { id: number; sector: number; tail: Point; triggered?: boolean };
export type MotionRun = { index: number; seed: number; durationMs: number; objects: MovingObject[] };
export type RunSummary = { index: number; seed: number; peak: number; mean: number; sectorPeaks: number[] };
export const defaultMotionConfig: MotionConfig = { durationMs: 3600000, count: 300, seed: 42, scatter: .25 };

// Mulberry32, frozen with mass-motion@2; index changes the seed modulo 2^32.
function randomSource(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
export function generateRun(config: MotionConfig, library: Library, index: number): MotionRun {
  const { durationMs, count, seed, scatter } = config;
  if ((!Number.isInteger(durationMs / 60000) || durationMs < 1800000 || durationMs > 5400000) || !Number.isInteger(count) || count < 1 || count > 1000 ||
    !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(scatter) || scatter < 0 || scatter > .5 ||
    !Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error("Некорректные параметры массового прогона.");
  const validation = validateLibrary({ scene: library.scene, tracks: [], exercises: [] });
  if (validation.sceneError) throw new Error("Несовместимая версия сцены.");
  const runSeed = (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
  const random = randomSource(runSeed);
  const directionRandom = randomSource(runSeed ^ 0xa511e9b3);
  const objects = Array.from({ length: count }, (_, id) => {
    const bearingDeg = 360 * directionRandom();
    const angle = bearingDeg * Math.PI / 180;
    // Plan-view symbols approach a training boundary; height and flight dynamics are not modeled.
    const point = (radius: number): Point => ({ xM: radius * Math.sin(angle), yM: radius * Math.cos(angle), zM: 0 });
    const duration = DURATION_MS * (1 + scatter * (2 * random() - 1));
    const slot = count > 1 ? id / (count - 1) : 0;
    const startMs = ((1 - scatter) * slot + scatter * random()) * (durationMs - duration);
    return { id, bearingDeg, sector: sectorAt(bearingDeg), start: point(library.scene.radiusM), end: point(protectionRule.radiusM), durationMs: duration, startMs, endMs: startMs + duration };
  });
  return { index, seed: runSeed, durationMs, objects };
}
export function frameAt(run: MotionRun, timeMs: number) {
  let waiting = 0, finished = 0;
  const markers: MotionMarker[] = [];
  const signals: MotionMarker[] = [];
  const events: MovingObject[] = [];
  for (const object of run.objects) {
    if (timeMs < object.startMs) waiting++;
    else if (timeMs >= object.endMs) {
      finished++;
      events.push(object);
      if (timeMs - object.endMs < protectionRule.signalDurationMs) signals.push({ ...object.end, tMs: object.endMs, id: object.id, sector: object.sector, tail: object.end, triggered: true });
    }
    else {
      const progress = (timeMs - object.startMs) / object.durationMs;
      const point = (fraction: number): Point => ({ xM: object.start.xM + (object.end.xM - object.start.xM) * fraction,
        yM: object.start.yM + (object.end.yM - object.start.yM) * fraction, zM: object.start.zM + (object.end.zM - object.start.zM) * fraction });
      markers.push({ ...point(progress), tMs: timeMs, id: object.id, sector: object.sector, tail: point(Math.max(0, progress - .04)) });
    }
  }
  // Derive from scenario time, so seeks/replays cannot duplicate or lose events.
  events.sort((a, b) => b.endMs - a.endMs || a.id - b.id);
  return { waiting, finished, markers, signals, events };
}
export function summarizeRun(run: MotionRun) {
  const events = run.objects.flatMap(object => [{ timeMs: object.startMs, delta: 1, sector: object.sector }, { timeMs: object.endMs, delta: -1, sector: object.sector }])
    .sort((a, b) => a.timeMs - b.timeMs || a.delta - b.delta);
  let active = 0, peak = 0;
  const sectorActive = Array<number>(8).fill(0), sectorPeaks = Array<number>(8).fill(0), sectorCounts = Array<number>(8).fill(0);
  run.objects.forEach(object => sectorCounts[object.sector]++);
  const curve: { timeMs: number; active: number }[] = [{ timeMs: 0, active: 0 }];
  for (let i = 0; i < events.length;) {
    const timeMs = events[i].timeMs;
    do { const event = events[i++]; active += event.delta; sectorActive[event.sector] += event.delta; } while (i < events.length && events[i].timeMs === timeMs);
    peak = Math.max(peak, active);
    sectorActive.forEach((count, sector) => sectorPeaks[sector] = Math.max(sectorPeaks[sector], count));
    if (curve.at(-1)!.timeMs === timeMs) curve.pop();
    curve.push({ timeMs, active });
  }
  if (curve.at(-1)!.timeMs < run.durationMs) curve.push({ timeMs: run.durationMs, active: 0 });
  return { index: run.index, seed: run.seed, peak, mean: run.objects.reduce((sum, o) => sum + o.durationMs, 0) / run.durationMs, sectorPeaks, sectorCounts, curve };
}
export function summarizeBatch(results: Pick<RunSummary, "peak" | "mean" | "sectorPeaks">[]) {
  if (!results.length) throw new Error("Пустой пакет.");
  const peaks = results.map(run => run.peak).sort((a, b) => a - b);
  const sectorP90 = sectorLabels.map((_, sector) => results.map(run => run.sectorPeaks[sector]).sort((a, b) => a - b)[Math.ceil(.9 * results.length) - 1]);
  return { min: peaks[0], median: peaks[Math.ceil(.5 * peaks.length) - 1], p90: peaks[Math.ceil(.9 * peaks.length) - 1], max: peaks.at(-1)!,
    meanActive: results.reduce((sum, run) => sum + run.mean, 0) / results.length, sectorP90 };
}
export async function computeBatch(config: MotionConfig, library: Library, count: number, signal: AbortSignal, onProgress: (completed: number) => void) {
  if (count !== 100 && count !== 500) throw new Error("Пакет должен содержать 100 или 500 прогонов.");
  const results: RunSummary[] = [];
  // ponytail: <=1000 objects / 500 runs, yielding every 10 runs; move to a Worker if measured input latency becomes unacceptable.
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const { index: runIndex, seed, peak, mean, sectorPeaks } = summarizeRun(generateRun(config, library, index));
    results.push({ index: runIndex, seed, peak, mean, sectorPeaks });
    if ((index + 1) % 10 === 0) { onProgress(index + 1); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  signal.throwIfAborted();
  return results;
}
