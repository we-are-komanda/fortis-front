import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";

const savedEnv = { ...process.env };
let seen = { body: "", origin: "", ip: "", key: "" };
let calls = 0;
let status = 201;
let acceptedBody = '{"requestId":"synthetic-receipt","status":"received"}';
const server = createServer(async (req, res) => {
  calls++;
  let body = "";
  for await (const part of req) body += part;
  seen = { body, origin: String(req.headers.origin ?? ""), ip: String(req.headers["x-forwarded-for"] ?? ""), key: String(req.headers["idempotency-key"] ?? "") };
  res.writeHead(status, { "content-type": "application/json", "retry-after": "60" });
  res.end(status < 300 ? acceptedBody : '{"error":{"code":"synthetic_failure"}}');
});
before(async () => {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  process.env.BACKEND_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.FORTIS_RUNTIME_MODE = "workspace";
  process.env.FORTIS_LOCAL_DEVELOPMENT = "true";
  process.env.FORTIS_DEMO_FORM_ORIGIN = "https://frontend.test";
  process.env.FORTIS_DEMO_CONSENT_VERSION = "synthetic-test-only";
  process.env.FORTIS_DEMO_CONSENT_TEXT = "Synthetic fixture text; not a publication policy";
  process.env.FORTIS_TRUSTED_CLIENT_IP_HEADER = "x-test-edge-client-ip";
  delete process.env.FORTIS_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_FORTIS_API_BASE_URL;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  process.env = savedEnv;
});
const payload = { name: "Synthetic Person", organization: "Fixture", email: "synthetic@example.test", comment: "Test only", consent: true, consentVersion: "synthetic-test-only" };
function request(body = JSON.stringify(payload), headers: Record<string, string> = {}) {
  return new Request("https://frontend.test/api/public/demo-requests", { method: "POST", body, headers: {
    origin: "https://frontend.test", "content-type": "application/json", "idempotency-key": "synthetic-lead-attempt",
    "x-test-edge-client-ip": "192.0.2.25", "x-forwarded-for": "198.51.100.200", ...headers,
  } });
}
test("demo collection is disabled without explicit complete publication configuration", async () => {
  const { GET, POST } = await import("@/app/api/public/demo-requests/route");
  delete process.env.FORTIS_DEMO_REQUESTS_ENABLED;
  const before = calls;
  assert.deepEqual(await (await GET()).json(), { enabled: false });
  assert.equal((await POST(request())).status, 503);
  process.env.FORTIS_DEMO_REQUESTS_ENABLED = "true";
  const text = process.env.FORTIS_DEMO_CONSENT_TEXT;
  delete process.env.FORTIS_DEMO_CONSENT_TEXT;
  assert.equal((await POST(request())).status, 503);
  process.env.FORTIS_DEMO_CONSENT_TEXT = text;
  assert.equal(calls, before);
});
test("public form blocks wrong origin, non-JSON and streamed oversized bodies before forwarding", async () => {
  const { POST } = await import("@/app/api/public/demo-requests/route");
  const before = calls;
  assert.equal((await POST(request(undefined, { origin: "https://other.test" }))).status, 403);
  assert.equal((await POST(request(undefined, { origin: "null" }))).status, 403);
  assert.equal((await POST(request(undefined, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request("x".repeat(16 * 1024 + 1)))).status, 413);
  assert.equal(calls, before);
});
test("public form forwards only validated edge identity and durable acknowledgement", async () => {
  const { POST } = await import("@/app/api/public/demo-requests/route");
  const response = await POST(request());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { requestId: "synthetic-receipt", status: "received" });
  assert.deepEqual(seen, { body: JSON.stringify(payload), origin: "https://frontend.test", ip: "192.0.2.25", key: "synthetic-lead-attempt" });
  assert.equal((await POST(request(undefined, { "x-test-edge-client-ip": "192.0.2.25, 192.0.2.26" }))).status, 503);
  for (status of [400, 409, 429, 503]) {
    const failed = await POST(request());
    assert.equal(failed.status, status);
    assert.equal(failed.headers.get("retry-after"), "60");
    assert.equal((await failed.json()).error.code, "synthetic_failure");
  }
  status = 201;
});
test("generic API proxy cannot forward browser-controlled origin or IP into the trusted form channel", async () => {
  const { POST } = await import("@/app/api/v1/[...path]/route");
  const incoming = request();
  await POST(new Request("https://frontend.test/api/v1/demo-requests", incoming));
  assert.equal(seen.origin, "");
  assert.equal(seen.ip, "");
});
test("public form rejects a successful response that does not acknowledge a durable receipt", async () => {
  const { POST } = await import("@/app/api/public/demo-requests/route");
  acceptedBody = '{"status":"ok"}';
  try { assert.equal((await POST(request())).status, 502); }
  finally { acceptedBody = '{"requestId":"synthetic-receipt","status":"received"}'; }
});
test("demo client requires a receipt and preserves the same key on manual retry", async () => {
  const { sendDemoRequest } = await import("./demo-request-api");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => originalFetch(typeof input === "string" && input.startsWith("/") ? process.env.BACKEND_URL + input : input, init);
  try {
    status = 503;
    await assert.rejects(sendDemoRequest(payload, "retained-client-attempt"));
    assert.equal(seen.key, "retained-client-attempt");
    status = 201;
    const result = await sendDemoRequest(payload, "retained-client-attempt");
    assert.equal(result.requestId, "synthetic-receipt");
    assert.equal(seen.key, "retained-client-attempt");
    assert.deepEqual(JSON.parse(seen.body), payload);
    acceptedBody = '{"status":"ok"}';
    await assert.rejects(sendDemoRequest(payload, "retained-client-attempt"), { name: "FortisProtocolError" });
  } finally {
    globalThis.fetch = originalFetch; status = 201;
    acceptedBody = '{"requestId":"synthetic-receipt","status":"received"}';
  }
});
