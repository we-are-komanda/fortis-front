import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createWorkspaceDefenseProject } from "./defense-project";
import { draftStorageKey, readProjectDraft, writeProjectDraft, listDraftScopes } from "./project-draft-storage";
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
