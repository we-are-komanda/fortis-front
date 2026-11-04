import { DURATION_MS, validateLibrary, type Library, type Sample } from "./scenario-playback";
import { factoryCampusSize } from "./factory-campus";

export const motionVersion = "mass-motion@5";
// A schematic training boundary around the whole campus, not equipment coverage.
export const protectionRule = { id: "training-boundary@1", radiusM: factoryCampusSize, signalDurationMs: 60000 } as const;
// Individual kill-probability parameters per asset (see ADR-0032, E2).
// pPass = probability the drone passes undamaged through one encounter with this asset.
// Values are analytical assumptions derived from effective engagement zones and known system
// characteristics (catalog: Каталог_АО_ССТ_2026-11-03.md).
// Future: effectiveRadiusMultiplier enables height/weather/RCS multipliers (E6+).
export type UnitKillParams = Readonly<{
  /** Probability drone survives (passes) a single engagement encounter. */
  pPass: number;
  /** Multiplier applied to effective radius for height / weather / RCS effects. */
  effectiveRadiusMultiplier?: number;
}>;

/** Per-asset kill-probability table. Maps asset library key → individual parameters. */
export const unitKillParams: Record<string, UnitKillParams> = {
  // ЗУ-23М1: dual-barrel 23mm anti-aircraft gun; large footprint but lower precision vs small UAVs
  "ЗУ-23М1":               { pPass: 0.70 },
  // Анклав: short-range SAM (KZRK) with radar+IIR guidance; high single-shot effectiveness
  "Анклав":                 { pPass: 0.25 },
  // ЗПК-ЯкБ: Yak-B remote weapon station combo; moderate effectiveness
  "ЗПК-ЯкБ":                { pPass: 0.35 },
  // ТПУ-12,7мм: remote turret 12.7mm heavy machine gun; long range, better than 23mm on small targets
  "ТПУ-12,7 мм":            { pPass: 0.40 },
  // Бекас: scout-strike UCAV (counter-UAV role at close range)
  "Бекас":                  { pPass: 0.20 },
  // ЗУ-23М-1М на базе УРАЛ 4320: mobile twin-23mm; slightly better mobility => marginally better engagement
  "ЗУ-23М-1М на базе УРАЛ 4320": { pPass: 0.65 },
};

// Fallback value for unknown assets (backwards-compatible default from original model).
const EFFECTIVE_PASS_FALLBACK = 0.5;

/** Look up kill parameters for a given asset key; falls back to generic default. */
export function getUnitKillParams(assetKey: string): UnitKillParams {
  return unitKillParams[assetKey] ?? { pPass: EFFECTIVE_PASS_FALLBACK };
}

// Conditional equipment outcome model: coverage geometry + one seeded draw per object.
// Each unit now uses its own unitKillParams.pPass instead of a flat unitProbability.
export const effectModel = { id: "coverage-neutralization@2" } as const;
// A placed asset instance as used by modeling: local meters, effective conditional TTХ.
export type DefenseUnit = { id: string; xM: number; yM: number; radiusM: number; angleDeg: number; rotationDeg: number; quantity: number };
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
  angleDeg >= 360 || Math.abs(((bearingDeg - rotationDeg + 540) % 360) - 180) <= angleDeg / 2;
// First intersection of the radial path (start→end) with the unit coverage circle, as path parameter s∈[0,1].
function coverageEntry(unit: DefenseUnit, start: Point, end: Point): { s: number; bearingDeg: number } | null {
  const dx = end.xM - start.xM, dy = end.yM - start.yM;
  const lengthSq = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSq) || lengthSq <= 0) return null;
  const ox = start.xM - unit.xM, oy = start.yM - unit.yM;
  const a = lengthSq, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - unit.radiusM * unit.radiusM;
  let s: number;
  if (c <= 0) s = 0;
  else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    s = (-b - root) / (2 * a);
    if (s < 0 || s > 1) s = (-b + root) / (2 * a);
    if (s < 0 || s > 1) return null;
  }
  const sClamped = Math.min(1, Math.max(0, s));
  const px = start.xM + sClamped * dx, py = start.yM + sClamped * dy;
  const bearing = (Math.atan2(px - unit.xM, py - unit.yM) * 180 / Math.PI + 360) % 360;
  if (!sectorCovers(bearing, unit.rotationDeg, unit.angleDeg)) return null;
  return { s: Number.isFinite(s) ? s : sClamped, bearingDeg: bearing };
}
function validateDefenseUnits(units: DefenseUnit[]) {
  if (!Array.isArray(units)) throw new Error("Некорректная конфигурация средств.");
  const ids = new Set<string>();
  for (const unit of units) {
    if (!unit || typeof unit.id !== "string" || !unit.id || ids.has(unit.id)) throw new Error("Некорректная конфигурация средств.");
    ids.add(unit.id);
    if (![unit.xM, unit.yM, unit.rotationDeg].every(Number.isFinite) || unit.radiusM <= 0 || !(unit.angleDeg > 0) || unit.angleDeg > 360 ||
      !Number.isInteger(unit.quantity) || unit.quantity < 1) throw new Error("Некорректная конфигурация средств.");
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
  validateDefenseUnits(defenseUnits);
  const runSeed = (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
  // One draw per object in a dedicated stream: coverage config cannot shift temporal/direction randomness.
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
    let hitCount = 0;
    let firstCovering: { by: string; s: number; xM: number; yM: number } | null = null;
    // Collect one pPass draw per unit instance across all covering zones.
    const survivors: number[] = [];
    const outcome = outcomeRandom();
    // Union-of-circles: collect (s, unitId) pairs, sort by s, merge overlapping
    // intervals by proximity along trajectory, count distinct units in each group.
    const EPSILON_S = 1e-6;
    type _Entry = { s: number; id: string };
    const entries: _Entry[] = [];
    for (const unit of defenseUnits) {
      const entry = coverageEntry(unit, start, end);
      if (!entry) continue;
      entries.push({ s: entry.s, id: unit.id });
      hitCount += unit.quantity;
      const kp = getUnitKillParams(unit.id);
      for (let i = 0; i < unit.quantity; i++) {
        survivors.push(kp.pPass);
      }
      const xM = start.xM + entry.s * (end.xM - start.xM), yM = start.yM + entry.s * (end.yM - start.yM);
      if (!firstCovering || entry.s < firstCovering.s) firstCovering = { by: unit.id, s: entry.s, xM, yM };
    }
    // Deduplicate hitCount by merging overlapping intervals along trajectory parameter s.
    if (entries.length > 0) {
      entries.sort((a, b) => a.s - b.s);
      const groups: _Entry[][] = [[entries[0]]];
      for (let i = 1; i < entries.length; i++) {
        const prev = groups[groups.length - 1];
        const lastS = prev[prev.length - 1].s;
        if (Math.abs(entries[i].s - lastS) <= EPSILON_S) {
          prev.push(entries[i]);
        } else {
          groups.push([entries[i]]);
        }
      }
      hitCount = 0;
      for (const group of groups) {
        hitCount += new Set(group.map(e => e.id)).size;
      }
    }
    const survivalProduct = survivors.reduce((acc, p) => acc * p, 1);
    const neutralizedProbability = 1 - survivalProduct;
    if (firstCovering && outcome < neutralizedProbability) {
      object.neutralized = { by: firstCovering.by, units: hitCount,
        atMs: startMs + firstCovering.s * duration, xM: firstCovering.xM, yM: firstCovering.yM };
    }
    return object;
  });
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
  const neutralized = run.objects.filter(object => object.neutralized !== undefined).length;
  const sectorNeutralized = Array<number>(8).fill(0);
  run.objects.forEach(object => { if (object.neutralized) sectorNeutralized[object.sector]++; });
  return { index: run.index, seed: run.seed, peak, mean: run.objects.reduce((sum, o) => sum + o.durationMs, 0) / run.durationMs, sectorPeaks, sectorCounts, neutralized,
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
