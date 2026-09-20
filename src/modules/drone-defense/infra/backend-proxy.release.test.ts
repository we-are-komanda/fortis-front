import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";

const savedEnv = { ...process.env };
let status = 200;
let body: string | Buffer = '{"items":[],"totalItems":0}';
let delay = 0;
let headersFirst = false;
let contentType = "application/json";
let lastRequest = { url: "", method: "", auth: "", body: "" };
const server = createServer(async (req, res) => {
  let input = "";
  for await (const chunk of req) input += chunk;
  lastRequest = { url: req.url!, method: req.method!, auth: req.headers.authorization ?? "", body: input };
  if (headersFirst) { res.writeHead(status, { "content-type": contentType }); res.flushHeaders(); }
  setTimeout(() => {
    if (!res.headersSent) res.writeHead(status, { "content-type": contentType, "x-request-id": "upstream-test", "content-disposition": 'attachment; filename="test.bin"' });
    res.end(body);
  }, delay);
});
let base = "";
before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.BACKEND_URL = base;
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
function request(path = "/api/defense/projects") {
  return new Request(`http://frontend.test${path}`, { headers: { cookie: "access-token=synthetic" } });
}
test("BFF preserves upstream error status and body, including HTML and empty bodies", async () => {
  const { GET } = await import("@/app/api/auth/me/route");
  for (const code of [401, 403, 404, 409, 500]) {
    for (const payload of ['{"errors":"synthetic"}', "<html>error</html>", ""]) {
      status = code; body = payload;
      const res = await GET(request());
      assert.equal(res.status, code);
      assert.equal(await res.text(), payload);
      assert.equal(res.headers.get("x-request-id"), "upstream-test");
    }
  }
});
test("projects rejects an empty successful body instead of returning 200 null", async () => {
  status = 200; body = "";
  const { GET } = await import("@/app/api/defense/projects/route");
  assert.equal((await GET(request())).status, 502);
});
test("BFF and API v1 share target, query and auth; legitimate empty stays empty", async () => {
  status = 200; body = '{"items":[],"totalItems":0}';
  const { GET: bff } = await import("@/app/api/defense/projects/route");
  const first = await bff(request("/api/defense/projects?limit=2&name=a%20b"));
  assert.deepEqual(await first.json(), { items: [], totalItems: 0 });
  assert.equal(lastRequest.url, "/api/v1/projects?limit=2&name=a%20b");
  assert.equal(lastRequest.auth, "Bearer synthetic");
  const { GET } = await import("@/app/api/v1/[...path]/route");
  const res = await GET(request("/api/v1/enterprises/?limit=2"));
  assert.equal(lastRequest.url, "/api/v1/enterprises?limit=2");
  assert.deepEqual(await res.json(), { items: [], totalItems: 0 });
});
test("binary documents preserve bytes/status/content type and mutation method/body", async () => {
  const { GET, POST } = await import("@/app/api/v1/[...path]/route");
  status = 206; body = Buffer.from([0, 255, 1, 128]); contentType = "application/octet-stream";
  const res = await GET(request("/api/v1/assets/documents/download?id=synthetic"));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-type"), contentType);
  assert.match(res.headers.get("content-disposition")!, /test.bin/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), body);
  status = 201; body = '{}'; contentType = "application/json";
  await POST(new Request("http://frontend.test/api/v1/assets", { method: "POST", body: "synthetic body" }));
  assert.equal(lastRequest.method, "POST"); assert.equal(lastRequest.body, "synthetic body");
});
test("missing configuration fails without network fallback; conflicts fail", async () => {
  const { GET } = await import("@/app/api/auth/me/route");
  delete process.env.BACKEND_URL; delete process.env.FORTIS_LOCAL_DEVELOPMENT;
  const res = await GET(request());
  assert.equal(res.status, 503);
  assert.ok((await res.json()).error.requestId);
  process.env.BACKEND_URL = base;
  process.env.FORTIS_LOCAL_DEVELOPMENT = "true";
  process.env.FORTIS_API_BASE_URL = "https://other.test";
  assert.equal((await GET(request())).status, 503);
  delete process.env.FORTIS_API_BASE_URL;
});
test("connection refused is 502; deadline is 504 with request id", async () => {
  const { GET } = await import("@/app/api/auth/me/route");
  process.env.BACKEND_URL = "http://127.0.0.1:1";
  const refused = await GET(request());
  assert.equal(refused.status, 502); assert.ok((await refused.json()).error.requestId);
  process.env.BACKEND_URL = base; process.env.FORTIS_API_TIMEOUT_MS = "25";
  delay = 100; status = 200; body = '{}';
  const res = await GET(request());
  assert.equal(res.status, 504); assert.ok((await res.json()).error.requestId);
  delay = 0; delete process.env.FORTIS_API_TIMEOUT_MS;
});
test("workspace ignores query demo; demo route is explicit and marked", async () => {
  const { GET } = await import("@/app/api/defense/facilities/route");
  process.env.FORTIS_RUNTIME_MODE = "workspace";
  assert.equal((await GET(request("/api/defense/facilities?demo=nak&visualDemo=true"))).status, 404);
  process.env.FORTIS_RUNTIME_MODE = "demo";
  const demo = await GET(request());
  assert.equal(demo.status, 200); assert.equal(demo.headers.get("x-fortis-runtime-mode"), "demo");
  assert.ok((await demo.json()).length > 0);
  process.env.FORTIS_RUNTIME_MODE = "workspace";
});
test("JSON helper rejects malformed success and wrong list shape", async () => {
  const { readJson } = await import("@/shared/lib/api-client");
  status = 200; body = "not JSON";
  await assert.rejects(readJson(base), (err: unknown) => (err as { code: string }).code === "protocol_error");
  const { requireListItems } = await import("@/shared/lib/api-client");
  assert.throws(() => requireListItems({ unexpected: [] }), /некорректные данные/);
});
test("JSON adaptation deadline includes the response body, not only headers", async () => {
  status = 200; body = '{"items":[],"totalItems":0}'; delay = 100; headersFirst = true;
  process.env.FORTIS_API_TIMEOUT_MS = "25";
  try {
    const { GET } = await import("@/app/api/defense/projects/route");
    assert.equal((await GET(request())).status, 504);
  } finally { headersFirst = false; delay = 0; delete process.env.FORTIS_API_TIMEOUT_MS; }
});
