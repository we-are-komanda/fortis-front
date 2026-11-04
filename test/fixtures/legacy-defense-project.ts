import assets from "./legacy-defense-assets.json";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";
import type { DefenseAsset } from "@/shared/types/defense-project";

// Historical snapshots exercise compatibility without repopulating the current catalog.
export const legacyDefenseAssets = assets as DefenseAsset[];
export function createLegacyDefenseProject() {
  return { ...createDefaultDefenseProject(), assetLibrary: structuredClone(legacyDefenseAssets) };
}
