import type { DefenseProject } from "@/shared/types/defense-project";
import type { ProjectRef } from "@/shared/types/finance";

export type SaveStatus = "loading" | "saved" | "dirty" | "saving" | "offline_draft" | "conflict" | "error";
export type SaveAttempt = {
  kind: "create" | "update";
  project: DefenseProject;
  name: string;
  body: string;
  idempotencyKey?: string;
  businessRevision: number;
  startedAt: string;
};

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)]));
  return value;
}
export function businessContent(project: DefenseProject): string {
  const { projectId, version, source, updatedAt, activeLayerId, selectedAssetId, selectedObjectId, mode, ...business } = project;
  void projectId; void version; void source; void updatedAt; void activeLayerId; void selectedAssetId; void selectedObjectId; void mode;
  return JSON.stringify(sorted({ ...business,
    layers: project.layers.map(({ isActive, isVisible, isLocked, ...layer }) => { void isActive; void isVisible; void isLocked; return layer; }),
    placedObjects: project.placedObjects.map(({ isVisibleOnMap, updatedAt, ...object }) => { void isVisibleOnMap; void updatedAt; return object; }),
  }));
}
export function savedProjectRef(project: DefenseProject | null): ProjectRef | null {
  return project?.source === "backend" && project.projectId && Number.isSafeInteger(project.version) && project.version! > 0
    ? { projectId: project.projectId, projectVersion: project.version! } : null;
}
export function classifySaveVerification(sent: DefenseProject, current: DefenseProject): "saved" | "retry" | "conflict" {
  if (sent.projectId !== current.projectId || sent.enterpriseId !== current.enterpriseId || !savedProjectRef(current) || !sent.version) return "conflict";
  if (current.version === sent.version) return "retry";
  return current.version! > sent.version && businessContent(current) === businessContent(sent) ? "saved" : "conflict";
}
