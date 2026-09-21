import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefaultDefenseProject } from "./defense-project";
import { projectBudgetCandidate, parseBudgetRub, formatBudgetMinor, readBudgetProjection, readBudgetCheck, budgetMessage } from "./budget-projection";
import type { BudgetProjection } from "@/shared/types/finance";

function project(price: string | null) {
  const initial = createDefaultDefenseProject();
  const asset = { ...initial.assetLibrary[0], currency: "RUB" as const, unitPriceMinor: price };
  return { ...initial, projectId: "P", enterpriseId: "E", version: 7, assetLibrary: [asset], placedObjects: [{ ...initial.placedObjects[0], id: "O", assetId: asset.id, layerId: initial.layers[0].id, quantity: 1, customPriceMinor: price }] };
}
const budget: BudgetProjection = { identity: { projectId: "P", projectVersion: 7, calculationVersion: "cost-v1", snapshotDigest: "a".repeat(64), inputDataVersions: {} }, config: { budgetMode: "limited", budgetLimitMinor: "50000000" }, spentMinor: "47500000", remainingMinor: "2500000", status: "within_limit" };

test("exact budget equality passes and one kopeck over is blocked", () => {
  assert.equal(projectBudgetCandidate(project("50000000"), budget).status, "allowed");
  const blocked = projectBudgetCandidate(project("50000001"), budget);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.projectedRemainingMinor, "-1");
});
test("limited zero is distinct from unlimited and unknown never becomes zero", () => {
  const zero = { ...budget, spentMinor: "0", remainingMinor: "0", config: { budgetMode: "limited" as const, budgetLimitMinor: "0" } };
  assert.equal(projectBudgetCandidate(project("0"), zero).status, "allowed");
  assert.equal(projectBudgetCandidate(project("1"), zero).status, "blocked");
  assert.equal(projectBudgetCandidate(project(null), zero).reasonCode, "price_unknown");
  const unlimited = projectBudgetCandidate(project(null), { ...budget, config: { budgetMode: "unlimited", budgetLimitMinor: null } });
  assert.equal(unlimited.status, "allowed");
  assert.equal(unlimited.projectedSpentMinor, null);
  assert.equal(unlimited.projectedRemainingMinor, null);
});
test("an existing overage admits non-increasing totals, but a copy must fit its limit", () => {
  const exceeded = { ...budget, spentMinor: "60000000", remainingMinor: "-10000000", status: "exceeded" as const };
  assert.equal(projectBudgetCandidate(project("60000000"), exceeded).status, "allowed");
  assert.equal(projectBudgetCandidate(project("55000000"), exceeded).status, "allowed");
  assert.equal(projectBudgetCandidate(project("60000001"), exceeded).status, "blocked");
  assert.equal(projectBudgetCandidate(project("55000000"), exceeded, false).status, "blocked");
});
test("budget ruble input and signed remaining preserve exact decimal values", () => {
  assert.equal(parseBudgetRub(" 500 000,01 "), "50000001");
  assert.equal(parseBudgetRub("0"), "0");
  assert.equal(parseBudgetRub("9007199254740993.01"), "900719925474099301");
  for (const input of ["", "-1", "1.001", "NaN", "1e2"]) assert.equal(parseBudgetRub(input), null);
  assert.equal(formatBudgetMinor("-1"), "−0,01 ₽");
});

test("pinned budget reads reject mismatched identity, numeric money and inconsistent totals", () => {
  assert.equal(readBudgetProjection(budget, "P", 7), budget);
  const exceeded = { ...budget, spentMinor: "50000001", remainingMinor: "-1", status: "exceeded" };
  assert.equal(readBudgetProjection(exceeded, "P", 7), exceeded);
  for (const invalid of [
    { ...budget, identity: { ...budget.identity, projectId: "Q" } },
    { ...budget, identity: { ...budget.identity, projectVersion: 8 } },
    { ...budget, spentMinor: 47500000 },
    { ...budget, spentMinor: "047500000" },
    { ...budget, remainingMinor: "0" },
    { ...exceeded, status: "within_limit" },
  ]) assert.throws(() => readBudgetProjection(invalid, "P", 7));
});

test("preflight receipts preserve scope and distinguish unlimited from an incomplete remaining amount", () => {
  const allowed = projectBudgetCandidate(project("1"), { ...budget, config: { budgetMode: "unlimited", budgetLimitMinor: null } });
  assert.equal(readBudgetCheck(allowed, "P", 7), allowed);
  assert.ok(budgetMessage(allowed).includes("не ограничен"));
  for (const invalid of [{ ...allowed, basedOn: { projectId: "Q", projectVersion: 7 } }, { ...allowed, projectedSpentMinor: 1 }, { ...allowed, reasonCode: "budget_exceeded" }]) assert.throws(() => readBudgetCheck(invalid, "P", 7));
});
