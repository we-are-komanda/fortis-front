import { legacyDefenseAssets as defenseAssetLibrary } from "../../../../test/fixtures/legacy-defense-project";
import {
  buildPlacedDefenseCompoundProfile,
  getVisibleMogCoverageWeaponIds,
} from "@/shared/lib/defense-project";
import {
  buildMogCostSummary,
  getAvailableMogCoverageWeapon,
  hasMogErrors,
  syncMogDraft,
  validateMogDraft,
} from "@/modules/drone-defense/domain/mog-editor";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mogAsset = defenseAssetLibrary.find((asset) => asset.id === "l5-mobile-fire");
assert(mogAsset, "МОГ asset must exist in the catalog");

const baseProfile = buildPlacedDefenseCompoundProfile(mogAsset);
assert(baseProfile, "МОГ asset must produce a placed compound profile");

const syncedFallbackProfile = syncMogDraft({
  ...baseProfile,
  visibleCoverageWeaponIds: undefined,
  coverageWeaponId: "interceptorDrones",
  weapons: baseProfile.weapons?.map((weapon) =>
    weapon.id === "interceptorDrones" ? { ...weapon, quantity: "0" } : weapon,
  ),
});
if (getVisibleMogCoverageWeaponIds({ coverageWeaponId: "interceptorDrones" }).join(",") !== "interceptorDrones") {
  throw new Error("legacy coverageWeaponId must remain the fallback source when visible ids are absent");
}
if ((syncedFallbackProfile.visibleCoverageWeaponIds ?? []).length !== 0) {
  throw new Error("legacy fallback with zero quantity must not keep hidden coverage visible");
}
if (syncedFallbackProfile.coverageWeaponId !== "firearms") {
  throw new Error(`coverage fallback must switch to the next available weapon; got ${syncedFallbackProfile.coverageWeaponId}`);
}
if (getAvailableMogCoverageWeapon(syncedFallbackProfile)?.id !== "firearms") {
  throw new Error("available coverage weapon must resolve to firearms after fallback");
}

const syncedEmptyProfile = syncMogDraft({
  ...baseProfile,
  weapons: baseProfile.weapons?.map((weapon) => ({ ...weapon, quantity: "0" })),
});
if ((syncedEmptyProfile.visibleCoverageWeaponIds ?? []).length !== 0) {
  throw new Error("empty weapon loadout must clear visible coverage ids");
}
if (getAvailableMogCoverageWeapon(syncedEmptyProfile) !== null) {
  throw new Error("coverage weapon must be null when every weapon quantity is 0");
}
if (syncedEmptyProfile.sectorOrRange !== "Покрытие скрыто") {
  throw new Error(`empty weapon loadout must hide coverage label; got ${syncedEmptyProfile.sectorOrRange}`);
}

const syncedMultiProfile = syncMogDraft({
  ...baseProfile,
  visibleCoverageWeaponIds: ["antiDroneRifles", "interceptorDrones"],
  weapons: baseProfile.weapons?.map((weapon) =>
    weapon.id === "antiDroneRifles"
      ? { ...weapon, coverageAzimuth: 210, coverageSectorWidthDeg: 120 }
      : weapon.id === "interceptorDrones"
        ? { ...weapon, quantity: "3", coverageAzimuth: 35, coverageSectorWidthDeg: 45 }
        : weapon,
  ),
});
if (getVisibleMogCoverageWeaponIds(syncedMultiProfile).join(",") !== "antiDroneRifles,interceptorDrones") {
  throw new Error("sync must preserve multiple visible coverage ids when quantities are valid");
}
if (syncedMultiProfile.weapons?.find((weapon) => weapon.id === "antiDroneRifles")?.coverageAzimuth !== 210) {
  throw new Error("sync must preserve per-weapon azimuth");
}
if (syncedMultiProfile.weapons?.find((weapon) => weapon.id === "interceptorDrones")?.coverageSectorWidthDeg !== 45) {
  throw new Error("sync must preserve per-weapon sector width");
}
if (syncedMultiProfile.azimuth !== 35 || syncedMultiProfile.sectorWidthDeg !== 45) {
  throw new Error("legacy top-level coverage orientation must mirror the latest selected visible weapon");
}
if (syncedMultiProfile.sectorOrRange !== "до 5 км, сектор 45°") {
  throw new Error(`legacy coverage summary must use the selected weapon settings; got ${syncedMultiProfile.sectorOrRange}`);
}

const seededCoverageProfile = syncMogDraft({
  ...baseProfile,
  azimuth: 55,
  sectorWidthDeg: 140,
  weapons: baseProfile.weapons?.map((weapon) => ({
    ...weapon,
    coverageAzimuth: undefined,
    coverageSectorWidthDeg: undefined,
  })),
});
if (seededCoverageProfile.weapons?.some((weapon) => weapon.coverageAzimuth !== 55)) {
  throw new Error("legacy top-level azimuth must seed missing per-weapon settings");
}
if (seededCoverageProfile.weapons?.some((weapon) => weapon.coverageSectorWidthDeg !== 140)) {
  throw new Error("legacy top-level sector width must seed missing per-weapon settings");
}

const invalidAngles = validateMogDraft({
  draft: baseProfile,
  coverageInputs: {
    firearms: {
      azimuth: "400",
      sectorWidthDeg: "0",
    },
  },
});
if (!invalidAngles.weaponCoverageAzimuth.firearms || !invalidAngles.weaponCoverageSectorWidthDeg.firearms || !hasMogErrors(invalidAngles)) {
  throw new Error("weapon coverage validation must reject azimuth > 359 and sector < 1");
}

const costSummary = buildMogCostSummary(mogAsset);
if (costSummary.baseMln !== 35 || costSummary.totalMln !== 35 || !costSummary.isEstimate) {
  throw new Error(`cost summary must expose the known base price for МОГ; got ${JSON.stringify(costSummary)}`);
}

console.log("mog-editor domain helpers: ok");
