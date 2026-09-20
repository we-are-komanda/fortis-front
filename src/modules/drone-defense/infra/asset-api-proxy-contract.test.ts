// HTTP behaviour is covered by backend-proxy.release.test.ts with a real HTTP stub.
import assert from "node:assert/strict";
import nextConfig from "../../../../next.config";
import { GET, POST, PUT, DELETE } from "@/app/api/v1/[...path]/route";
assert.equal(nextConfig.skipTrailingSlashRedirect, true);
assert.equal(nextConfig.rewrites, undefined, "API v1 must not bypass the shared server boundary via an external rewrite");
assert.equal(GET, POST); assert.equal(GET, PUT); assert.equal(GET, DELETE);
console.log("asset-api-proxy-contract.test.ts: shared route boundary passed");
