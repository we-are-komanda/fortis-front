"use client";

import { create } from "zustand";
import { buildCatalogPlacement, buildScenarioConfiguration, hexCells, threatRoutes } from "@/modules/drone-defense/infra/mock-defense-data";
import { fetchCatalog, fetchFacilities, fetchLayers } from "@/modules/drone-defense/infra/api-client";
import type {
  Configuration,
  DefenseCatalogResponse,
  DefenseLayerId,
  DefenseLayersResponse,
  DefenseScenarioId,
  Facility,
  Placement,
} from "@/shared/types/drone-defense";

type StudioView = "gis" | "drilldown";

type StudioState = {
  view: StudioView;
  facilityId: string;
  scenarioId: DefenseScenarioId;
  configuration: Configuration;
  loading: boolean;
  error: string | null;
  catalog: DefenseCatalogResponse | null;
  facilities: Facility[];
  layers: DefenseLayersResponse | null;
  localPlacementsByScenario: Partial<Record<DefenseScenarioId, Placement[]>>;
  selectedPlacementId: string | null;
  selectPlacement: (placementId: string | null) => void;
  placeAssetInSlot: (args: { groupId: string; layerId: DefenseLayerId; slotId: string; mapRef: { lon: number; lat: number } }) => Promise<boolean>;
  removePlacement: (placementId: string) => Promise<void>;
  runtimeMode: "workspace" | "demo";
  init: (mode?: "workspace" | "demo") => Promise<void>;
  setView: (view: StudioView) => void;
  setFacilityId: (facilityId: string) => Promise<void>;
  setScenarioId: (scenarioId: DefenseScenarioId) => Promise<void>;
  upsertLocalPlacement: (placement: Placement) => Promise<void>;
  moveLocalPlacement: (args: { placementId: string; x: number; z: number }) => Promise<void>;
  removeLocalPlacement: (placementId: string) => Promise<void>;
};

function buildConfiguration(
  facilityId: string,
  scenarioId: DefenseScenarioId,
  localPlacementsByScenario: Partial<Record<DefenseScenarioId, Placement[]>>,
) {
  return buildScenarioConfiguration(facilityId, scenarioId, localPlacementsByScenario[scenarioId] ?? []);
}

async function loadScenarioPack(
  facilityId: string,
  scenarioId: DefenseScenarioId,
  localPlacementsByScenario: Partial<Record<DefenseScenarioId, Placement[]>>,
) {
  if (useDefenseStudioStore.getState().runtimeMode !== "demo") throw new Error("Demo-only operation");
  const configuration = buildConfiguration(facilityId, scenarioId, localPlacementsByScenario);
  const layers = await fetchLayers({ facilityId, scenarioId });

  return { configuration, layers };
}

export const useDefenseStudioStore = create<StudioState>((set, get) => ({
  view: "gis",
  facilityId: "",
  runtimeMode: "workspace",
  scenarioId: "baseline",
  configuration: { facilityId: "", scenarioId: "baseline", placements: [] },
  loading: false,
  error: null,
  catalog: null,
  facilities: [],
  layers: null,
  localPlacementsByScenario: {},
  selectedPlacementId: null,
  init: async (runtimeMode = "workspace") => {
    set({ runtimeMode });
    if (runtimeMode !== "demo") {
      set({ catalog: null, facilities: [], layers: null, facilityId: "", configuration: { facilityId: "", scenarioId: "baseline", placements: [] }, loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const [catalog, facilities] = await Promise.all([fetchCatalog(), fetchFacilities()]);
      const facilityId = facilities[0]?.id ?? "facility-alpha";
      const scenarioId = get().scenarioId;
      const localPlacementsByScenario = get().localPlacementsByScenario;
      const pack = await loadScenarioPack(facilityId, scenarioId, localPlacementsByScenario);
      set({
        catalog,
        facilities,
        facilityId,
        configuration: pack.configuration,
        layers: pack.layers,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "failed to initialize", loading: false });
    }
  },
  setView: (view) => set({ view }),
  setFacilityId: async (facilityId) => {
    const localPlacementsByScenario: Partial<Record<DefenseScenarioId, Placement[]>> = {};
    set({ loading: true, facilityId, localPlacementsByScenario, error: null });
    try {
      const scenarioId = get().scenarioId;
      const pack = await loadScenarioPack(facilityId, scenarioId, localPlacementsByScenario);
      set({
        configuration: pack.configuration,
        layers: pack.layers,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "failed to switch facility", loading: false });
    }
  },
  setScenarioId: async (scenarioId) => {
    set({ loading: true, scenarioId, error: null });
    try {
      const { facilityId } = get();
      const localPlacementsByScenario = get().localPlacementsByScenario;
      const pack = await loadScenarioPack(facilityId, scenarioId, localPlacementsByScenario);
      set({
        configuration: pack.configuration,
        layers: pack.layers,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "failed to switch scenario", loading: false });
    }
  },
  upsertLocalPlacement: async (placement) => {
    const { facilityId, scenarioId } = get();
    const current = get().localPlacementsByScenario[scenarioId] ?? [];
    const localPlacementsByScenario = {
      ...get().localPlacementsByScenario,
      [scenarioId]: [...current.filter((item) => item.id !== placement.id), placement],
    };
    set({ loading: true, localPlacementsByScenario, error: null });
    try {
      const pack = await loadScenarioPack(facilityId, scenarioId, localPlacementsByScenario);
      set({
        configuration: pack.configuration,
        layers: pack.layers,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "failed to update local placement", loading: false });
    }
  },
  moveLocalPlacement: async ({ placementId, x, z }) => {
    const { facilityId, scenarioId } = get();
    const current = get().localPlacementsByScenario[scenarioId] ?? [];
    const nextPlacements = current.map((item) =>
      item.id === placementId
        ? {
            ...item,
            sceneRef: {
              x,
              z,
            },
          }
        : item,
    );
    const localPlacementsByScenario = {
      ...get().localPlacementsByScenario,
      [scenarioId]: nextPlacements,
    };
    set({ loading: true, localPlacementsByScenario, error: null });
    try {
      const pack = await loadScenarioPack(facilityId, scenarioId, localPlacementsByScenario);
      set({
        configuration: pack.configuration,
        layers: pack.layers,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "failed to move local placement", loading: false });
    }
  },
  removeLocalPlacement: async (placementId) => {
    const { facilityId, scenarioId } = get();
    const current = get().localPlacementsByScenario[scenarioId] ?? [];
    const localPlacementsByScenario = {
      ...get().localPlacementsByScenario,
      [scenarioId]: current.filter((item) => item.id !== placementId),
    };
    set({ loading: true, localPlacementsByScenario, error: null });
    try {
      const pack = await loadScenarioPack(facilityId, scenarioId, localPlacementsByScenario);
      set({
        configuration: pack.configuration,
        layers: pack.layers,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "failed to remove local placement", loading: false });
    }
  },
  selectPlacement: (placementId) => set({ selectedPlacementId: placementId }),
  placeAssetInSlot: async ({ groupId, layerId, slotId, mapRef }) => {
    const { facilityId, scenarioId } = get();
    const current = get().localPlacementsByScenario[scenarioId] ?? [];
    const duplicate = current.some((item) => item.slotId === slotId && item.catalogGroupId === groupId);
    if (duplicate) {
      set({ error: "Это средство уже стоит в выбранном слоте" });
      return false;
    }
    const placement = buildCatalogPlacement({ facilityId, scenarioId, groupId, slotId, mapRef });
    placement.layerId = layerId;
    await get().upsertLocalPlacement(placement);
    set({ selectedPlacementId: placement.id });
    return true;
  },
  removePlacement: async (placementId) => {
    if (get().selectedPlacementId === placementId) {
      set({ selectedPlacementId: null });
    }
    await get().removeLocalPlacement(placementId);
  },
}));

export const studioPreviewData = {
  hexCells,
  threatRoutes,
};
