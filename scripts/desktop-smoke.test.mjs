import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

test("bundled demo serves mocks without backend and exits when its parent closes", { timeout: 90_000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["--require", "../lifecycle.cjs", "server.js"], {
    cwd: fileURLToPath(new URL("../.desktop-build/server/app/", import.meta.url)),
    env: { PATH: process.env.PATH, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), FORTIS_RUNTIME_MODE: "demo", FORTIS_LOCAL_DRAFTS_ENABLED: "true", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let log = "";
  child.stderr.on("data", data => { log += data; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${log}`)), 65_000);
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Exited ${code}: ${log}`)); });
      child.stdout.on("data", data => {
        log += data;
        if (log.includes("FORTIS_READY")) { clearTimeout(timeout); resolve(); }
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const runtime = await fetch(`${origin}/api/runtime`).then(r => r.json());
    assert.deepEqual(runtime, { mode: "demo", localDraftsEnabled: true });
    const facilities = await fetch(`${origin}/api/defense/facilities`).then(r => r.json());
    assert.ok(facilities.length > 0);
    assert.equal((await fetch(`${origin}/api/defense/catalog`)).status, 200);
    assert.equal((await fetch(`${origin}/api/v1/enterprises`)).status, 404);
    for (const route of ["/prototype?view=gis", "/prototype?view=scenario-modeling", "/prototype?view=3d", "/calculator"]) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(response.redirected, false, route);
      assert.match(response.headers.get("content-security-policy"), /connect-src 'self' blob: data: https:\/\/tiles\.openfreemap\.org/);
      assert.ok((await response.text()).includes("Fortis"), route);
    }
    const exited = once(child, "exit");
    child.stdin.end();
    assert.equal((await exited)[0], 0);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
