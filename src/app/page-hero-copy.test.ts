import assert from "node:assert/strict";
import test from "node:test";
import Page from "./page";

test("home opens scenario modeling", () => {
  assert.throws(() => Page(), (error: unknown) =>
    error instanceof Error && "digest" in error &&
    error.digest === "NEXT_REDIRECT;replace;/prototype?view=scenario-modeling;307;");
});
