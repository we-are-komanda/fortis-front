import { factoryCampusVersion } from "./factory-campus";

export type VersionRef = { id: string; version: number };
export type SceneManifest = VersionRef & {
  provenance: "synthetic"; radiusM: 10000; coordinateSystem: "local-enu-m";
  terrainVersion: number; enterpriseModelVersion: number;
  assets: { terrain: string; enterprise: string }; authorNote: string;
};
export type Sample = { tMs: number; xM: number; yM: number; zM: number };
export type Track = VersionRef & {
  sceneRef: VersionRef; label: string; directionLabel: string; durationMs: 240000; samples: Sample[];
};
export type Exercise = VersionRef & {
  title: string; objective: string; sceneRef: VersionRef; trackRef: VersionRef;
  events: { id: string; atMs: number; kind: "notice" | "question" | "complete"; title: string; text: string }[];
};
export type Library = { scene: SceneManifest; tracks: Track[]; exercises: Exercise[] };
export const DURATION_MS = 240000;
const sameRef = (a: VersionRef, b: VersionRef) => a?.id === b?.id && a?.version === b?.version;
const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const versioned = (ref: VersionRef) => typeof ref?.id === "string" && ref.id.length > 0 && Number.isInteger(ref.version) && ref.version > 0;
const unique = (items: VersionRef[]) => new Set(items.map(item => item.id)).size === items.length;

// Bundled assets are validated before use; invalid entries never fall back to a newer version.
export function validateLibrary(library: Library) {
  const { scene, tracks, exercises } = library;
  const sceneError = !versioned(scene) || `${scene.id}@${scene.version}` !== factoryCampusVersion || scene.provenance !== "synthetic" || scene.radiusM !== 10000 ||
    scene.coordinateSystem !== "local-enu-m" || scene.terrainVersion !== 2 || scene.enterpriseModelVersion !== 1 ||
    scene.assets?.terrain !== "site-v2.json#terrain" || scene.assets?.enterprise !== factoryCampusVersion
    ? "Повреждён manifest учебной площадки или неизвестна версия ассетов." : null;
  const trackErrors = new Map<string, string>();
  const duplicateTracks = !unique(tracks);
  for (const track of tracks) {
    const samples = track.samples;
    if (duplicateTracks && tracks.filter(item => item.id === track.id).length > 1 ||
      !versioned(track) || !nonempty(track.label) || !nonempty(track.directionLabel) || !sameRef(track.sceneRef, scene) || track.durationMs !== DURATION_MS ||
      !Array.isArray(samples) || samples.length < 2 || samples[0]?.tMs !== 0 || samples.at(-1)?.tMs !== DURATION_MS ||
      samples.some((s, i) => !s || ![s.tMs, s.xM, s.yM, s.zM].every(Number.isFinite) || s.tMs < 0 || s.tMs > DURATION_MS ||
        (i > 0 && s.tMs <= samples[i - 1].tMs) || Math.hypot(s.xM, s.yM) > scene.radiusM)) {
      trackErrors.set(track.id, "Запись повреждена: проверьте версию, координаты и время отсчётов.");
    }
  }
  const entries = exercises.map(exercise => {
    const track = tracks.find(item => sameRef(item, exercise.trackRef));
    const events = exercise.events;
    const error = sceneError ?? (!versioned(exercise) || !nonempty(exercise.title) || !nonempty(exercise.objective) || exercises.filter(item => item.id === exercise.id).length > 1 ||
      !sameRef(exercise.sceneRef, scene) || !track || trackErrors.has(track.id) ||
      !Array.isArray(events) || new Set(events.map(event => event?.id)).size !== events.length ||
      events.some(event => !event || !nonempty(event.id) || !nonempty(event.title) || !nonempty(event.text) || !Number.isFinite(event.atMs) || event.atMs < 0 || event.atMs > DURATION_MS ||
        !["notice", "question", "complete"].includes(event.kind))
      ? "Упражнение недоступно: повреждена запись, события или точная ссылка на версию." : null);
    return { exercise, track, error };
  });
  return { sceneError, trackErrors, entries, valid: entries.filter(entry => !entry.error && entry.track) };
}

export type Clock = { timeMs: number; status: "ready" | "playing" | "paused" | "ended"; rate: 1 | 2 | 4 | 10 | 30 | 60; anchorMs: number };
export type ClockAction = { type: "play" | "pause" | "reset"; now: number } |
  { type: "seek"; timeMs: number; now: number } | { type: "rate"; rate: Clock["rate"]; now: number };
export const initialClock: Clock = { timeMs: 0, status: "ready", rate: 1, anchorMs: 0 };
export const clampTime = (timeMs: number, durationMs = DURATION_MS) => Math.max(0, Math.min(durationMs, Number.isFinite(timeMs) ? timeMs : 0));
export function clockAt(clock: Clock, now: number, durationMs = DURATION_MS): Clock {
  if (clock.status !== "playing") return clock;
  const timeMs = clampTime(clock.timeMs + Math.max(0, now - clock.anchorMs) * clock.rate, durationMs);
  return { ...clock, timeMs, anchorMs: now, status: timeMs === durationMs ? "ended" : "playing" };
}
export function transitionClock(clock: Clock, action: ClockAction, durationMs = DURATION_MS): Clock {
  const current = clockAt(clock, action.now, durationMs);
  if (action.type === "reset") return { ...initialClock, rate: clock.rate, anchorMs: action.now };
  if (action.type === "seek") {
    const timeMs = clampTime(action.timeMs, durationMs);
    return { ...current, timeMs, anchorMs: action.now, status: timeMs === durationMs ? "ended" : timeMs === 0 ? "ready" : "paused" };
  }
  if (action.type === "rate") return { ...current, rate: action.rate };
  if (action.type === "play") return { ...current, timeMs: current.status === "ended" ? 0 : current.timeMs, anchorMs: action.now, status: "playing" };
  return { ...current, status: current.timeMs === durationMs ? "ended" : current.timeMs === 0 ? "ready" : "paused" };
}
export function positionAt(track: Track, timeMs: number): Sample {
  const t = clampTime(timeMs);
  const right = track.samples.findIndex(sample => sample.tMs >= t);
  if (right <= 0) return { ...track.samples[right === 0 ? 0 : track.samples.length - 1], tMs: t };
  const a = track.samples[right - 1], b = track.samples[right];
  const fraction = (t - a.tMs) / (b.tMs - a.tMs);
  return { tMs: t, xM: a.xM + (b.xM - a.xM) * fraction, yM: a.yM + (b.yM - a.yM) * fraction, zM: a.zM + (b.zM - a.zM) * fraction };
}
export function formatTime(timeMs: number, durationMs = DURATION_MS) {
  const seconds = Math.floor(clampTime(timeMs, durationMs) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
