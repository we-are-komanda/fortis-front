import assert from "node:assert/strict";
import { test } from "node:test";
import { FortisApiError } from "./api-client";

test("API errors retain a validated Retry-After duration for manual retry", () => {
  const error = (value: string) => new FortisApiError(new Response(null, { status: 429, headers: { "retry-after": value } }));
  assert.equal(error("60").retryAfter, 60);
  assert.equal(error("0").retryAfter, 0);
  for (const invalid of ["-1", "NaN", "1.5", "tomorrow", "999999999999999999999999"]) assert.equal(error(invalid).retryAfter, undefined);
  const future = error(new Date(Date.now() + 60_000).toUTCString()).retryAfter;
  assert.ok(future !== undefined && future >= 59 && future <= 60);
  assert.equal(error("Sat, 01 Jan 2000 00:00:00 GMT").retryAfter, 0);
});
