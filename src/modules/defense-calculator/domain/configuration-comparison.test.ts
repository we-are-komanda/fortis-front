import assert from "node:assert/strict";
import { test } from "node:test";
import { pairComparisonItems } from "./configuration-comparison";

test("comparison joins real identifiers and never conflates equal display names", () => {
  const a = [{ id: "L1", name: "Same layer", quantity: 1 }];
  const b = [{ id: "L2", name: "Same layer", quantity: 2 }];
  assert.deepEqual(pairComparisonItems(a,b,item=>item.id), [{ id: "L1", a: a[0], b: undefined }, { id: "L2", a: undefined, b: b[0] }]);
});
test("a stable identifier pairs renamed entries with their changed quantities", () => {
  const a = [{ id: "L1", name: "Old", quantity: 1 }], b = [{ id: "L1", name: "New", quantity: 2 }];
  assert.deepEqual(pairComparisonItems(a,b,item=>item.id), [{ id: "L1", a: a[0], b: b[0] }]);
});
