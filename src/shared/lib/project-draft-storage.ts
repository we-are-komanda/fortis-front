import type { DefenseProject } from "@/shared/types/defense-project";
import type { SaveAttempt } from "./project-save-state";
import { businessContent } from "./project-save-state";
import { isRecord } from "./api-client";
import { importDefenseProjectJson } from "./defense-project";

export type DraftScope = { userId: string; enterpriseId: string; projectId: string };
export type ProjectDraft = DraftScope & {
  schemaVersion: 1;
  draft: DefenseProject;
  savedProject: DefenseProject | null;
  businessRevision: number;
  savedAt: string;
  attempt?: SaveAttempt;
};
type StorageResult<T> = { ok: true; value: T } | { ok: false; error: string };
const failure = (): StorageResult<never> => ({ ok: false, error: "Локальное восстановление недоступно: хранилище запрещено, заполнено или содержит повреждённый черновик. Работа в памяти сохранена." });
export function draftStorageKey(scope: DraftScope) {
  return `fortis:draft:${[scope.userId, scope.enterpriseId, scope.projectId].map(encodeURIComponent).join(":")}`;
}
export function writeProjectDraft(record: ProjectDraft, enabled: boolean): StorageResult<boolean> {
  if (!enabled) return { ok: true, value: false };
  try {
    if (!globalThis.localStorage) return failure();
    globalThis.localStorage.setItem(draftStorageKey(record), JSON.stringify(record));
    return { ok: true, value: true };
  } catch { return failure(); }
}
export function readProjectDraft(scope: DraftScope, enabled: boolean): StorageResult<ProjectDraft | null> {
  if (!enabled) return { ok: true, value: null };
  try {
    if (!globalThis.localStorage) return failure();
    const raw = globalThis.localStorage.getItem(draftStorageKey(scope));
    if (!raw) return { ok: true, value: null };
    const value = JSON.parse(raw) as ProjectDraft;
    if (value.schemaVersion !== 1 || value.userId !== scope.userId || value.enterpriseId !== scope.enterpriseId || value.projectId !== scope.projectId || !Number.isSafeInteger(value.businessRevision) || value.businessRevision < 0 || typeof value.savedAt !== "string") return failure();
    const draft = importDefenseProjectJson(JSON.stringify(value.draft));
    if (draft.projectId !== scope.projectId || draft.enterpriseId !== scope.enterpriseId) return failure();
    const savedProject = value.savedProject === null ? null : importDefenseProjectJson(JSON.stringify(value.savedProject));
    if (savedProject && (savedProject.projectId !== scope.projectId || savedProject.enterpriseId !== scope.enterpriseId || savedProject.source !== "backend" || !Number.isSafeInteger(savedProject.version) || savedProject.version! < 1)) return failure();
    if (value.attempt) {
      const attempt = value.attempt;
      if (!isRecord(attempt) || !["create", "update"].includes(String(attempt.kind)) || typeof attempt.body !== "string" || typeof attempt.name !== "string" || !attempt.name.trim() || attempt.name.length > 120 || typeof attempt.startedAt !== "string" || !Number.isFinite(Date.parse(attempt.startedAt)) || !Number.isSafeInteger(attempt.businessRevision) || attempt.businessRevision < 0 || attempt.businessRevision > value.businessRevision || (attempt.verificationRequired !== undefined && typeof attempt.verificationRequired !== "boolean") || (attempt.kind === "create" && (typeof attempt.idempotencyKey !== "string" || !attempt.idempotencyKey.trim() || attempt.idempotencyKey.length > 200))) return failure();
      const sent = importDefenseProjectJson(JSON.stringify(attempt.project));
      if (sent.projectId !== scope.projectId || sent.enterpriseId !== scope.enterpriseId || (attempt.kind === "update" && (!Number.isSafeInteger(sent.version) || sent.version! < 1))) return failure();
      const body = JSON.parse(attempt.body) as unknown;
      if (!isRecord(body) || body.name !== attempt.name || body.enterpriseId !== scope.enterpriseId || typeof body.projectJson !== "string") return failure();
      const bodyProject = importDefenseProjectJson(body.projectJson);
      if (bodyProject.projectId !== scope.projectId || bodyProject.enterpriseId !== scope.enterpriseId || businessContent(bodyProject) !== businessContent(sent)) return failure();
      if (attempt.kind === "update" && body.version !== sent.version) return failure();
    }
    return { ok: true, value: { ...value, draft, savedProject } };
  } catch { return failure(); }
}
export function listDraftScopes(userId: string, enabled: boolean): StorageResult<DraftScope[]> {
  if (!enabled) return { ok: true, value: [] };
  try {
    if (!globalThis.localStorage) return failure();
    const prefix = `fortis:draft:${encodeURIComponent(userId)}:`;
    const scopes: DraftScope[] = [];
    for (let index = 0; index < globalThis.localStorage.length; index++) {
      const key = globalThis.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length).split(":");
      if (suffix.length !== 2) continue;
      const scope = { userId, enterpriseId: decodeURIComponent(suffix[0]), projectId: decodeURIComponent(suffix[1]) };
      if (draftStorageKey(scope) === key) scopes.push(scope);
    }
    return { ok: true, value: scopes };
  } catch { return failure(); }
}
export function removeProjectDraft(scope: DraftScope, enabled: boolean): StorageResult<boolean> {
  if (!enabled) return { ok: true, value: false };
  try { globalThis.localStorage?.removeItem(draftStorageKey(scope)); return { ok: true, value: true }; }
  catch { return failure(); }
}
