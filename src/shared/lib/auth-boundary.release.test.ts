import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { readJson } from "./api-client";
import { useDefenseProjectStore } from "./use-defense-project-store";

test("workspace renders without authentication plumbing", () => {
 assert.equal(existsSync("src/proxy.ts"), false);
 assert.equal(existsSync("src/app/api/auth/login/route.ts"), false);
 const source = readFileSync("src/shared/ui/project-boundary.tsx", "utf8");
 assert.doesNotMatch(source, /auth\/me|login|logout|setAuthenticatedIdentity/);
 assert.match(source, /beforeunload/);
 assert.equal(useDefenseProjectStore.getInitialState().identityId, "shared-workspace");
});

test("401 keeps unsaved project and reports the error without navigating", async () => {
 const project=useDefenseProjectStore.getState().project;
 await assert.rejects(readJson("/api/v1/projects", {fetcher:async()=>new Response(null,{status:401})}), error=>error instanceof Error && error.message.includes("конфигурации доступа"));
 assert.equal(useDefenseProjectStore.getState().project,project);
});
