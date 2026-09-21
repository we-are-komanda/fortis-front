import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createWorkspaceDefenseProject } from "./defense-project";
import { draftStorageKey, readProjectDraft, writeProjectDraft, listDraftScopes, removeProjectDraft } from "./project-draft-storage";
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); });
const scope = { userId: "A", enterpriseId: "E", projectId: "P" };
const record = { schemaVersion: 1 as const, ...scope, draft: { ...createWorkspaceDefenseProject(), enterpriseId: "E", projectId: "P" }, savedProject: null, businessRevision: 3, savedAt: "2026-09-20T00:00:00Z" };
test("scopes use all identities and never read legacy or other-user keys", () => {
  const map = new Map<string, string>([["fortis-defense-project", JSON.stringify(record)], ["fortis-defense-project:user:A", JSON.stringify(record)]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (key: string, value: string) => map.set(key, value), getItem: (key: string) => map.get(key) ?? null, key: (index: number) => [...map.keys()][index] ?? null, get length() { return map.size; } } });
  assert.equal(draftStorageKey(scope), "fortis:draft:A:E:P");
  assert.deepEqual(listDraftScopes("A", true), { ok: true, value: [] });
  assert.equal(writeProjectDraft(record, true).ok, true);
  assert.equal(readProjectDraft(scope, true).ok, true);
  assert.deepEqual(listDraftScopes("B", true), { ok: true, value: [] });
  assert.deepEqual(readProjectDraft({ ...scope, enterpriseId: "other" }, true), { ok: true, value: null });
});
test("quota and security/getter failures become recovery errors instead of exceptions", () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
  assert.equal(writeProjectDraft(record, true).ok, false);
  assert.equal(readProjectDraft(scope, true).ok, false);
  assert.deepEqual(writeProjectDraft(record, false), { ok: true, value: false });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem() { throw new DOMException("full", "QuotaExceededError"); } } });
  assert.equal(writeProjectDraft(record, true).ok, false);
});
test("corrupt JSON and cross-scope envelopes are rejected without deleting stored data", () => {
  for (const raw of ["{broken", JSON.stringify({ ...record, userId: "B" }), JSON.stringify({ ...record, draft: null })]) {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => raw } });
    assert.equal(readProjectDraft(scope, true).ok, false);
  }
});
test("attempt replay metadata must match its scoped project and exact request body", () => {
  const withAttempt = { ...record, attempt: { kind: "create" as const, project: record.draft, name: "copy", body: "{}", idempotencyKey: "same-key", businessRevision: 3, startedAt: "2026-09-20T00:00:00Z" } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => JSON.stringify(withAttempt) } });
  assert.equal(readProjectDraft(scope, true).ok, false);
  const forgedScope = { ...withAttempt, attempt: { ...withAttempt.attempt, body: JSON.stringify({ name: "copy", enterpriseId: "other", projectJson: JSON.stringify(withAttempt.draft) }) } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => JSON.stringify(forgedScope) } });
  assert.equal(readProjectDraft(scope, true).ok, false);
});
test("draft scopes with delimiter characters remain isolated by user, enterprise and project", () => {
  const ownScope = { userId: "A:B", enterpriseId: "E/F", projectId: "P:1" };
  const otherScope = { userId: "A", enterpriseId: "B:E/F", projectId: "P:1" };
  const ownRecord = { ...record, ...ownScope, draft: { ...record.draft, enterpriseId: ownScope.enterpriseId, projectId: ownScope.projectId } };
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  } });
  assert.deepEqual(writeProjectDraft(ownRecord, true), { ok: true, value: true });
  assert.deepEqual(listDraftScopes("A:B", true), { ok: true, value: [ownScope] });
  assert.deepEqual(listDraftScopes("A", true), { ok: true, value: [] });
  for (const other of [otherScope, { ...ownScope, enterpriseId: "E" }, { ...ownScope, projectId: "P" }]) {
    assert.deepEqual(readProjectDraft(other, true), { ok: true, value: null });
    removeProjectDraft(other, true);
  }
  assert.equal(readProjectDraft(ownScope, true).ok, true);
  removeProjectDraft(ownScope, true);
  assert.deepEqual(readProjectDraft(ownScope, true), { ok: true, value: null });
});
test("reload preserves the exact frozen create body and key alongside a newer draft", () => {
  const sent = { ...record.draft, projectName: "sent name" };
  const attempt = {
    kind: "create" as const, name: "copy", project: sent, businessRevision: 2,
    body: JSON.stringify({ name: "copy", enterpriseId: "E", projectJson: JSON.stringify(sent) }),
    idempotencyKey: "frozen-create-key", startedAt: "2026-09-20T00:00:00Z",
  };
  const stored = { ...record, draft: { ...sent, projectName: "newer local edit" }, attempt };
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  } });
  writeProjectDraft(stored, true);
  const loaded = readProjectDraft(scope, true);
  assert.ok(loaded.ok && loaded.value);
  assert.equal(loaded.value.draft.projectName, "newer local edit");
  assert.equal(loaded.value.attempt?.project.projectName, "sent name");
  assert.equal(loaded.value.attempt?.body, attempt.body);
  assert.equal(loaded.value.attempt?.idempotencyKey, attempt.idempotencyKey);
  assert.ok(loaded.value.attempt?.idempotencyKey);
});
