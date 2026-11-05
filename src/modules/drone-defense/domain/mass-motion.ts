import { DURATION_MS, validateLibrary, type Library, type Sample } from "./scenario-playback";
import { factoryCampusSize } from "./factory-campus";
import { resolveGameSettings, type GameSettings } from "@/shared/lib/game-settings";

export const motionVersion = "mass-motion@7";
// A schematic training boundary around the whole campus, not equipment coverage.
export const protectionRule = { id: "training-boundary@1", radiusM: factoryCampusSize, signalDurationMs: 60000 } as const;
// Fictional game coefficients, not measured equipment capabilities (ADR-0032).
export type UnitKillParams = Readonly<{
  /** Probability a game attempt has no effect on its target. */
  pPass: number;
}>;

/** Per-asset kill-probability table. Maps asset library key → individual parameters. */
export const unitKillParams: Readonly<Record<string, UnitKillParams>> = {
  "sst-zu-23m1": { pPass: 0.70 },
  "sst-anklav": { pPass: 0.25 },
  "sst-zpk-yakb": { pPass: 0.35 },
  "sst-tpu-12-7": { pPass: 0.40 },
  "sst-bekas": { pPass: 0.20 },
  "sst-zu-23m-1m-ural": { pPass: 0.65 },
};

// Fallback value for unknown assets (backwards-compatible default from original model).
const EFFECTIVE_PASS_FALLBACK = 0.5;

/** Look up kill parameters for a given asset key; falls back to generic default. */
export function getUnitKillParams(assetKey: string): UnitKillParams {
  return Object.hasOwn(unitKillParams, assetKey) ? unitKillParams[assetKey] : { pPass: EFFECTIVE_PASS_FALLBACK };
}

// Fictional game cycles with finite charges; one seeded draw per actual attempt.
export const effectModel = { id: "coverage-neutralization@4" } as const;
// A placed asset instance as used by modeling: local meters, effective conditional TTХ.
export type DefenseUnit = { id: string; assetKey?: string; xM: number; yM: number; radiusM: number; angleDeg: number; rotationDeg: number; quantity: number; gameSettings?: GameSettings };
export type MotionConfig = { durationMs: number; count: number; seed: number; scatter: number };
type Point = Pick<Sample, "xM" | "yM" | "zM">;
export const sectorLabels = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
export const sectorColors = ["#2563eb", "#0284c7", "#0d9488", "#4d7c0f", "#b45309", "#dc2626", "#9333ea", "#db2777"];
export const darkSectorColors = ["#93b8ff", "#7dd3fc", "#5eead4", "#bef264", "#fdba74", "#fca5a5", "#d8b4fe", "#f9a8d4"];
export const sectorAt = (bearingDeg: number) => Math.floor((bearingDeg + 22.5) % 360 / 45);
export type MovingObject = { id: number; bearingDeg: number; sector: number; start: Point; end: Point; startMs: number; endMs: number; durationMs: number; neutralized?: { by: string; units: number; atMs: number; xM: number; yM: number } };
export type MotionMarker = Sample & { id: number; sector: number; tail: Point; triggered?: boolean; neutralized?: boolean; by?: string };
export type MotionRun = { index: number; seed: number; durationMs: number; objects: MovingObject[] };
export type RunSummary = { index: number; seed: number; peak: number; mean: number; sectorPeaks: number[]; neutralized: number; neutralizedRate: number; sectorNeutralized: number[] };
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
const OUTCOME_STREAM_KEY = 0x51ed270b;
// rotationDeg and bearing use the map convention: 0° = north, increasing clockwise.
const sectorCovers = (bearingDeg: number, rotationDeg: number, angleDeg: number) =>
  angleDeg >= 360 || Math.abs((((bearingDeg - rotationDeg) % 360 + 540) % 360) - 180) <= angleDeg / 2 + 1e-9;
// Split at circle/sector boundaries; reflex sectors may produce two separate windows.
export function coverageIntervals(unit: DefenseUnit, start: Point, end: Point): [number, number][] {
  const dx = end.xM - start.xM, dy = end.yM - start.yM;
  const lengthSq = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSq) || lengthSq <= 0) return [];
  const ox = start.xM - unit.xM, oy = start.yM - unit.yM;
  const a = lengthSq, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - unit.radiusM * unit.radiusM;
  const candidates = [0, 1];
  const discriminant = b * b - 4 * a * c;
  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    candidates.push((-b - root) / (2 * a), (-b + root) / (2 * a));
  }
  if (unit.angleDeg < 360) for (const side of [-1, 1]) {
    const angle = ((unit.rotationDeg % 360) + side * unit.angleDeg / 2) * Math.PI / 180;
    const rx = Math.sin(angle), ry = Math.cos(angle);
    const cross = dx * ry - dy * rx;
    if (Math.abs(cross) > 1e-9) candidates.push((oy * rx - ox * ry) / cross);
  }
  const cuts = [...new Set(candidates.filter(s => s >= 0 && s <= 1))].sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (let i = 1; i < cuts.length; i++) {
    const from = cuts[i - 1], to = cuts[i];
    if (to - from < 1e-12) continue;
    const s = (from + to) / 2, x = ox + s * dx, y = oy + s * dy;
    const bearingDeg = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    if (Math.hypot(x, y) <= unit.radiusM + 1e-7 && sectorCovers(bearingDeg, unit.rotationDeg, unit.angleDeg)) {
      const previous = intervals.at(-1);
      if (previous && Math.abs(previous[1] - from) < 1e-12) previous[1] = to;
      else intervals.push([from, to]);
    }
  }
  return intervals;
}
function validateDefenseUnits(units: DefenseUnit[]) {
  if (!Array.isArray(units)) throw new Error("Некорректная конфигурация средств.");
  const ids = new Set<string>();
  for (const unit of units) {
    if (!unit || typeof unit.id !== "string" || !unit.id || ids.has(unit.id)) throw new Error("Некорректная конфигурация средств.");
    ids.add(unit.id);
    if (![unit.xM, unit.yM, unit.rotationDeg, unit.radiusM, unit.angleDeg].every(Number.isFinite) || unit.radiusM <= 0 || !(unit.angleDeg > 0) || unit.angleDeg > 360 ||
      !Number.isSafeInteger(unit.quantity) || unit.quantity < 1 || (unit.assetKey !== undefined && typeof unit.assetKey !== "string")) throw new Error("Некорректная конфигурация средств.");
    resolveGameSettings(unit.gameSettings);
  }
  if (units.reduce((sum, unit) => sum + unit.quantity, 0) > 1000) throw new Error("Игровой прогон поддерживает до 1000 экземпляров средств. Уменьшите количество.");
}

// Applies only abstract game rules; supplied objects are the fresh, unmodified schedule.
export function resolveGameEffects(objects: MovingObject[], units: DefenseUnit[], random: () => number) {
  validateDefenseUnits(units);
  type Window = { object: MovingObject; entry: number; ready: number; exit: number };
  type State = { unit: DefenseUnit; settings: GameSettings; order: number; at: number; charges: number; magazine: number; windows: Window[] };
  const queue: State[] = [];
  const enqueue = (state: State) => {
    let low = 0, high = queue.length;
    while (low < high) {
      const mid = (low + high) >>> 1, other = queue[mid];
      if (other.at < state.at || (other.at === state.at && other.order < state.order)) low = mid + 1;
      else high = mid;
    }
    queue.splice(low, 0, state);
  };
  const nextTime = (state: State) => {
    state.windows = state.windows.filter(window => !window.object.neutralized && window.exit > state.at);
    let next = Infinity;
    for (const window of state.windows) next = Math.min(next, Math.max(state.at, window.ready));
    return next;
  };
  let order = 0;
  for (const unit of [...units].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const settings = resolveGameSettings(unit.gameSettings);
    if (settings.ammunition === 0) continue;
    const windows = objects.flatMap(object => coverageIntervals(unit, object.start, object.end).map(([from, to]) => {
      const entry = object.startMs + from * object.durationMs;
      return { object, entry, ready: entry + settings.reactionMs, exit: Math.min(object.endMs, object.startMs + to * object.durationMs) };
    })).filter(window => window.ready < window.exit).sort((a, b) => a.entry - b.entry || a.object.id - b.object.id);
    if (!windows.length) continue;
    for (let instance = 0; instance < unit.quantity; instance++) {
      const state: State = { unit, settings, order: order++, at: 0, charges: settings.ammunition,
        magazine: Math.min(settings.magazineSize, settings.ammunition), windows };
      state.at = nextTime(state);
      enqueue(state);
    }
  }
  let attempts = 0;
  while (queue.length) {
    const state = queue.shift()!;
    const next = nextTime(state);
    if (!Number.isFinite(next)) continue;
    // Another instance may have removed the next target since this event was queued.
    if (next > state.at) { state.at = next; enqueue(state); continue; }
    const { settings, unit } = state;
    let acted = 0;
    for (const window of state.windows) {
      if (acted >= settings.maxTargets || !state.magazine) break;
      if (window.ready > state.at || window.object.neutralized) continue;
      // ponytail: bounded synchronous game runs; move the solver to a Worker before raising this ceiling.
      if (++attempts > 100000) throw new Error("Слишком много игровых попыток. Уменьшите запас зарядов, количество или темп атак.");
      acted++; state.magazine--; state.charges--;
      if (random() < 1 - getUnitKillParams(unit.assetKey ?? "").pPass) {
        const object = window.object, s = (state.at - object.startMs) / object.durationMs;
        object.neutralized = { by: unit.id, units: 1, atMs: state.at,
          xM: object.start.xM + s * (object.end.xM - object.start.xM), yM: object.start.yM + s * (object.end.yM - object.start.yM) };
      }
    }
    if (!state.charges) continue;
    const reload = state.magazine === 0;
    state.at += Math.max(settings.intervalMs, reload ? settings.reloadMs : 0);
    if (reload) state.magazine = Math.min(settings.magazineSize, state.charges);
    state.at = nextTime(state);
    if (Number.isFinite(state.at)) enqueue(state);
  }
}
export function generateRun(config: MotionConfig, library: Library, index: number, protectionRadiusM: number = protectionRule.radiusM, defenseUnits: DefenseUnit[] = []): MotionRun {
  const { durationMs, count, seed, scatter } = config;
  if ((!Number.isInteger(durationMs / 60000) || durationMs < 1800000 || durationMs > 5400000) || !Number.isInteger(count) || count < 1 || count > 1000 ||
    !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(scatter) || scatter < 0 || scatter > .5 ||
    !Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error("Некорректные параметры массового прогона.");
  const validation = validateLibrary({ scene: library.scene, tracks: [], exercises: [] });
  if (validation.sceneError) throw new Error("Несовместимая версия сцены.");
  if (!Number.isFinite(protectionRadiusM) || protectionRadiusM <= 0 || protectionRadiusM >= library.scene.radiusM) throw new Error("Некорректная граница условной зоны защиты.");
  const runSeed = (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
  // Separate outcome stream: game settings never shift schedules or directions.
  const outcomeRandom = randomSource(runSeed ^ OUTCOME_STREAM_KEY);
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
    const start = point(library.scene.radiusM), end = point(protectionRadiusM);
    const object: MovingObject = { id, bearingDeg, sector: sectorAt(bearingDeg), start, end, durationMs: duration, startMs, endMs: startMs + duration };
    return object;
  });
  resolveGameEffects(objects, defenseUnits, outcomeRandom);
  return { index, seed: runSeed, durationMs, objects };
}
export function frameAt(run: MotionRun, timeMs: number) {
  let waiting = 0, finished = 0, neutralized = 0;
  const markers: MotionMarker[] = [];
  const signals: MotionMarker[] = [];
  const intercepts: MotionMarker[] = [];
  const events: MovingObject[] = [];
  for (const object of run.objects) {
    if (timeMs < object.startMs) waiting++;
    else if (object.neutralized && timeMs >= object.neutralized.atMs) {
      neutralized++;
      const hit = object.neutralized;
      intercepts.push({ xM: hit.xM, yM: hit.yM, zM: 0, tMs: hit.atMs, id: object.id, sector: object.sector, tail: { xM: hit.xM, yM: hit.yM, zM: 0 }, neutralized: true, by: hit.by });
    }
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
  intercepts.sort((a, b) => b.tMs - a.tMs || a.id - b.id);
  return { waiting, finished, neutralized, markers, signals, intercepts, events };
}
export function summarizeRun(run: MotionRun) {
  const events = run.objects.flatMap(object => [{ timeMs: object.startMs, delta: 1, sector: object.sector }, { timeMs: object.neutralized?.atMs ?? object.endMs, delta: -1, sector: object.sector }])
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
  const neutralized = run.objects.filter(object => object.neutralized !== undefined).length;
  const sectorNeutralized = Array<number>(8).fill(0);
  run.objects.forEach(object => { if (object.neutralized) sectorNeutralized[object.sector]++; });
  return { index: run.index, seed: run.seed, peak, mean: run.objects.reduce((sum, o) => sum + (o.neutralized?.atMs ?? o.endMs) - o.startMs, 0) / run.durationMs, sectorPeaks, sectorCounts, neutralized,
    neutralizedRate: run.objects.length ? neutralized / run.objects.length : 0, sectorNeutralized, curve };
}
export function summarizeBatch(results: Pick<RunSummary, "peak" | "mean" | "sectorPeaks" | "neutralizedRate">[]) {
  if (!results.length) throw new Error("Пустой пакет.");
  const peaks = results.map(run => run.peak).sort((a, b) => a - b);
  const rates = results.map(run => run.neutralizedRate).sort((a, b) => a - b);
  const sectorP90 = sectorLabels.map((_, sector) => results.map(run => run.sectorPeaks[sector]).sort((a, b) => a - b)[Math.ceil(.9 * results.length) - 1]);
  return { min: peaks[0], median: peaks[Math.ceil(.5 * peaks.length) - 1], p90: peaks[Math.ceil(.9 * peaks.length) - 1], max: peaks.at(-1)!,
    meanActive: results.reduce((sum, run) => sum + run.mean, 0) / results.length, sectorP90,
    neutralizedRates: { min: rates[0], median: rates[Math.ceil(.5 * rates.length) - 1], p90: rates[Math.ceil(.9 * rates.length) - 1], max: rates.at(-1)! } };
}
export async function computeBatch(config: MotionConfig, library: Library, count: number, signal: AbortSignal, onProgress: (completed: number) => void, protectionRadiusM: number = protectionRule.radiusM, defenseUnits: DefenseUnit[] = []) {
  if (count !== 100 && count !== 500) throw new Error("Пакет должен содержать 100 или 500 прогонов.");
  const results: RunSummary[] = [];
  // ponytail: <=1000 objects / 500 runs, yielding every 10 runs; move to a Worker if measured input latency becomes unacceptable.
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const run = generateRun(config, library, index, protectionRadiusM, defenseUnits);
    const { index: runIndex, seed, peak, mean, sectorPeaks, neutralized, neutralizedRate, sectorNeutralized } = summarizeRun(run);
    results.push({ index: runIndex, seed, peak, mean, sectorPeaks, neutralized, neutralizedRate, sectorNeutralized });
    if ((index + 1) % 10 === 0) { onProgress(index + 1); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  signal.throwIfAborted();
  return results;
}
