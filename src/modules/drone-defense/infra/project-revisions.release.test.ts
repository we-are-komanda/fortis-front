import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createWorkspaceDefenseProject } from "@/shared/lib/defense-project";

const savedEnv = { ...process.env };
const project = { ...createWorkspaceDefenseProject(), projectId: "project-a", version: 7 };
let lastRequest = { url: "", key: "", body: "" };
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  lastRequest = { url: req.url!, key: String(req.headers["idempotency-key"] ?? ""), body };
  if (req.url?.includes("projectVersion=99")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":{"code":"revision_not_found"}}');
    return;
  }
  res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.method === "POST" ? { projectId: "project-a", version: 1 } : project));
});
before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.BACKEND_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.FORTIS_RUNTIME_MODE = "workspace";
  process.env.FORTIS_LOCAL_DEVELOPMENT = "true";
  delete process.env.FORTIS_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_FORTIS_API_BASE_URL;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env = savedEnv;
});
test("project BFF selects the requested revision without letting query override the resource ID", async () => {
  const { GET } = await import("@/app/api/defense/projects/[id]/route");
  const response = await GET(new Request("http://frontend.test/api/defense/projects/project-a?projectVersion=7&id=project-b"), { params: Promise.resolve({ id: "project-a" }) });
  assert.equal(response.status, 200);
  assert.equal(lastRequest.url, "/api/v1/projects/export?id=project-a&projectVersion=7");
  assert.equal((await response.json()).version, 7);
  const missing = await GET(new Request("http://frontend.test/api/defense/projects/project-a?projectVersion=99"), { params: Promise.resolve({ id: "project-a" }) });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "revision_not_found");
});
test("project creation preserves the caller's idempotency key through the BFF", async () => {
  const { POST } = await import("@/app/api/defense/projects/route");
  const body = JSON.stringify({ name: "Synthetic", projectJson: JSON.stringify(project) });
  const response = await POST(new Request("http://frontend.test/api/defense/projects", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "synthetic-attempt-1" }, body,
  }));
  assert.equal(response.status, 201);
  assert.equal(lastRequest.key, "synthetic-attempt-1");
  assert.equal(lastRequest.body, body);
});
test("release API client selects a revision and sends a stable caller-supplied creation key", async () => {
  const { loadVariant, saveVariantAsNew } = await import("./api-client");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => originalFetch(
    typeof input === "string" && input.startsWith("/") ? process.env.BACKEND_URL + input : input, init,
  );
  try {
    await loadVariant("project-a", undefined, 7);
    assert.equal(lastRequest.url, "/api/defense/projects/project-a?projectVersion=7");
    await saveVariantAsNew({ name: "Synthetic", project, idempotencyKey: "synthetic-client-attempt" });
    assert.equal(lastRequest.key, "synthetic-client-attempt");
    await saveVariantAsNew({ name: "Synthetic", project });
    assert.match(lastRequest.key, /^[a-f0-9-]{36}$/);
  } finally { globalThis.fetch = originalFetch; }
});
