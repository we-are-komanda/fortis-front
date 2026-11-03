import assert from "node:assert/strict";
import { buildPublicAssetSeedPayloads } from "./seed-backend-asset-library";
import { serializeDefenseAssetMutation } from "./asset-library-api";

const payloads = buildPublicAssetSeedPayloads();
assert.equal(payloads.length, 6);
assert.ok(payloads.every(payload => payload.isPublic && payload.enterpriseId === undefined));
assert.ok(payloads.every(payload => payload.legacyItemId?.startsWith("sst-")));
assert.ok(payloads.every(payload => payload.unitPriceMinor === null));
assert.equal(serializeDefenseAssetMutation({ maxEffectiveDistance: 1500 }).maxEffectiveDistance, 1.5);
console.log("SST seed: six public cards, unknown prices and unit conversion passed");
