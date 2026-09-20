import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNextPath } from "./safe-next";
import { NextRequest } from "next/server";

test("production login and registration issue Secure cookies", async () => {
 const env = { ...process.env }; const fetcher = globalThis.fetch;
 try {
  process.env = { ...process.env, NODE_ENV: "production" }; process.env.BACKEND_URL = "https://backend.example.test"; process.env.FORTIS_RUNTIME_MODE = "workspace";
  delete process.env.FORTIS_API_BASE_URL; delete process.env.NEXT_PUBLIC_FORTIS_API_BASE_URL;
  globalThis.fetch = async () => Response.json({ token: "test-token", user: { id: "A" } });
  for (const { POST } of [await import("@/app/api/auth/login/route"), await import("@/app/api/auth/register/route")]) {
   const response = await POST(new Request("https://fortis.test/api/auth/login", { method: "POST", body: "{}" }));
   assert.equal(response.status, 200);
   const cookie = response.headers.get("set-cookie")!;
   assert.match(cookie, /; Secure(?:;|$)/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//);
  }
 } finally { process.env = env; globalThis.fetch = fetcher; }
});

test("invalid cookie does not admit protected pages", async () => {
 const env = { ...process.env }; const fetcher = globalThis.fetch;
 try {
  process.env.FORTIS_AUTH_ENABLED = "true"; process.env.BACKEND_URL = "https://backend.example.test"; process.env.FORTIS_RUNTIME_MODE = "workspace";
  globalThis.fetch = async () => new Response(null, { status: 401 });
  const { proxy } = await import("@/proxy");
  for (const path of ["/workspace", "/prototype", "/calculator"]) {
   const response = await proxy(new NextRequest(`https://fortis.test${path}`, { headers: { cookie: "access-token=invalid" } }));
   assert.equal(response.status, 307); assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  }
 } finally { process.env = env; globalThis.fetch = fetcher; }
});

test("login next permits only internal paths", () => {
 for (const path of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example", "/\t/evil.example"]) assert.equal(safeNextPath(path), "/workspace");
 for (const path of ["/workspace", "/prototype?projectId=A", "/calculator#budget"]) assert.equal(safeNextPath(path), path);
});

test("cookie clearing keeps production flags; local HTTP development remains usable", async () => {
 const env = { ...process.env };
 try {
  const { authCookie } = await import("@/shared/server/auth-cookie");
  process.env = { ...process.env, NODE_ENV: "development" };
  assert.doesNotMatch(authCookie("local"), /; Secure/);
  process.env = { ...process.env, NODE_ENV: "production" };
  const { POST } = await import("@/app/api/auth/logout/route");
  const cookie = (await POST()).headers.get("set-cookie")!;
  assert.match(cookie, /Max-Age=0/); assert.match(cookie, /; Secure/); assert.match(cookie, /HttpOnly/);
 } finally { process.env = env; }
});
