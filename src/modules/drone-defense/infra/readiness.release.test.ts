import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";

test("frontend liveness is independent of config/dependencies; readiness checks both", async () => {
  const { GET: live } = await import("@/app/api/health/live/route");
  const { GET: ready } = await import("@/app/api/health/ready/route");
  const saved = { ...process.env };
  let status = 200;
  const server = createServer((req, res) => { assert.equal(req.url, "/_/readiness"); res.writeHead(status); res.end('{}'); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    process.env.FORTIS_RUNTIME_MODE = "workspace";
    delete process.env.BACKEND_URL; delete process.env.FORTIS_LOCAL_DEVELOPMENT;
    delete process.env.FORTIS_API_BASE_URL; delete process.env.NEXT_PUBLIC_FORTIS_API_BASE_URL;
    assert.equal(live().status, 200);
    assert.equal((await ready()).status, 503);
    process.env.BACKEND_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.FORTIS_LOCAL_DEVELOPMENT = "true";
    assert.equal((await ready()).status, 200);
    status = 500;
    assert.equal((await ready()).status, 503);
    assert.equal(live().status, 200);
  } finally {
    process.env = saved; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
