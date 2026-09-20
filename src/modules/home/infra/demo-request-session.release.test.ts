import assert from "node:assert/strict";
import { test } from "node:test";
import { setAuthenticatedIdentity, useSessionStore } from "@/shared/lib/session-state";
import { sendDemoRequest } from "./demo-request-api";

test("public form errors preserve the workspace identity and input page", async () => {
  const original = globalThis.fetch;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sideEffects: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/", search: "", replace: (url: string) => sideEffects.push(url) },
    dispatchEvent: () => sideEffects.push("access event"),
  } });
  try {
    for (const status of [401, 403, 404]) {
      setAuthenticatedIdentity("existing-workspace-user");
      globalThis.fetch = async () => Response.json({ error: { code: "form_unavailable" } }, { status });
      await assert.rejects(sendDemoRequest({ name: "Test User", organization: "Fixture", email: "user@example.test", comment: "", consent: true, consentVersion: "test" }, "same-key"));
      assert.equal(useSessionStore.getState().userId, "existing-workspace-user");
    }
    assert.deepEqual(sideEffects, []);
  } finally {
    globalThis.fetch = original;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    setAuthenticatedIdentity(null);
  }
});
