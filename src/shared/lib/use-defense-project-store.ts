"use client";

import { create } from "zustand";
import { sessionGeneration } from "./session-state";
import {
  createDefaultDefenseProject,
  createWorkspaceDefenseProject,
  createRingLayer,
  applyAssetQuantityDraftsToProject,
  canEditLayer,
  deleteLayerFromProject,
  deletePlacedObjectInProject,
  duplicatePlacedObjectInProject,
  exportDefenseProjectJson,
  importDefenseProjectJson,
  legacySelectedConfigurationToProject,
  movePlacedObjectInProject,
  placeObjectInProject,
  recenterProject,
  setProjectBaseObject,
  setAssetQuantityInProject,
  syncPlacedObjectConflictFlags,
  transferPlacedObjectToLayerInProject,
  validateLayerDraft,
  updateLayerGeometryFromRadii,
  updateLayerOrder,
  updatePlacedObjectInProject,
  validateLayerGeometry,
  validateObjectPlacement,
} from "@/shared/lib/defense-project";
import { loadPresetIntoConfiguration } from "@/shared/lib/defense-configuration";
import { defenseAssetLibrary } from "@/shared/config/defense-asset-library";
import { fetchAssetLibrary, type FetchAssetLibraryOptions } from "@/modules/drone-defense/infra/asset-library-api";
import { fetchEnterprises, type FetchEnterprisesOptions } from "@/modules/drone-defense/infra/enterprise-api";
import { businessContent, type SaveAttempt } from "./project-save-state";
import { writeProjectDraft, removeProjectDraft, type ProjectDraft } from "./project-draft-storage";
import type {
  Coordinates,
  DefenseAsset,
  DefenseProject,
  DeleteLayerResult,
  EditableDefenseLayer,
  PlacedDefenseObject,
  PlacementValidationResult,
  ProtectedObject,
  ProtectedObjectOption,
} from "@/shared/types/defense-project";
import type { LayerGeometryValidationResult } from "@/shared/lib/defense-project";

export const FORTIS_DEFENSE_PROJECT_STORAGE_KEY = "fortis-defense-project";
export const MAX_DEFENSE_PROJECT_LAYERS = 20;

type DefenseProjectState = {
  identityId: string | null;
  accessError: string | null;
  project: DefenseProject;
  hydrated: boolean;
  runtimeMode: "workspace" | "demo";
  syncStatus: "saved" | "dirty" | "unverified";
  businessRevision: number;
  savedProject: DefenseProject | null;
  saveAttempt: SaveAttempt | null;
  draftStorageError: string | null;
  localDraftSaved: boolean;
  acceptServerProject: (project: DefenseProject) => void;
  recordSavedProject: (sent: DefenseProject, server: DefenseProject) => void;
  restoreVerifiedDraft: (record: ProjectDraft) => void;
  localDraftsEnabled: boolean;
  setLocalDraftsEnabled: (enabled: boolean) => void;
  setRuntimeMode: (mode: "workspace" | "demo") => void;
  budgetApplied: boolean;
  assetLibraryLoading: boolean;
  assetLibraryError: string | null;
  assetLibraryPreview: { baseProject: DefenseProject; assets: DefenseAsset[]; generation: number } | null;
  applyAssetLibraryPreview: () => boolean;
  discardAssetLibraryPreview: () => void;
  protectedObjects: ProtectedObjectOption[];
  protectedObjectsLoading: boolean;
  protectedObjectsError: string | null;
  activeLayerId?: string;
  selectedAssetId?: string;
  selectedObjectId?: string;
  createLayer: (data: Partial<EditableDefenseLayer>) => void;
  createLayerFromDraft: (
    draft: Partial<EditableDefenseLayer> & { innerRadiusM: number; widthM: number },
  ) => { ok: true; layer: EditableDefenseLayer } | { ok: false; validation: LayerGeometryValidationResult };
  updateLayerFromDraft: (
    layerId: string,
    draft: Partial<EditableDefenseLayer> & { innerRadiusM: number; widthM: number },
  ) => { ok: true; layer: EditableDefenseLayer } | { ok: false; validation: LayerGeometryValidationResult };
  updateLayer: (layerId: string, patch: Partial<EditableDefenseLayer>) => void;
  updateLayerGeometry: (
    layerId: string,
    radii: { innerRadiusM: number; widthM: number },
  ) => { ok: true; layer: EditableDefenseLayer } | { ok: false; validation: LayerGeometryValidationResult };
  deleteLayer: (layerId: string) => DeleteLayerResult;
  moveLayerUp: (layerId: string) => void;
  moveLayerDown: (layerId: string) => void;
  setLayerVisibility: (layerId: string, isVisible: boolean) => void;
  setLayerLocked: (layerId: string, isLocked: boolean) => void;
  selectLayer: (layerId: string) => void;
  setBaseObjectCenter: (center: Coordinates) => void;
  selectBaseObject: (baseObject: ProtectedObject) => void;
  selectAsset: (assetId: string) => void;
  selectObject: (objectId: string | null) => void;
  setAssetQuantity: (assetId: string, quantity: number) => void;
  placeObject: (
    assetId: string,
    layerId: string,
    coordinates: Coordinates,
    patch?: Partial<PlacedDefenseObject>,
  ) => PlacementValidationResult;
  moveObject: (objectId: string, coordinates: Coordinates) => PlacementValidationResult;
  transferObjectToLayer: (objectId: string, layerId: string) => PlacementValidationResult;
  updatePlacedObject: (objectId: string, patch: Partial<PlacedDefenseObject>) => void;
  setPlacedObjectMapVisibility: (objectId: string, isVisibleOnMap: boolean) => void;
  deletePlacedObject: (objectId: string) => void;
  duplicatePlacedObject: (objectId: string) => void;
  validateObjectPlacement: (assetId: string, layerId: string, coordinates: Coordinates) => PlacementValidationResult;
  loadPresetProject: (presetId: string) => void;
  replaceProject: (project: DefenseProject) => void;
  applyBudgetSelection: (picks: Array<{ assetId: string; included: boolean }>) => void;
  refreshAssetLibrary: (
    options?: FetchAssetLibraryOptions & { loader?: () => Promise<DefenseProject["assetLibrary"]> },
  ) => Promise<void>;
  refreshProtectedObjects: (
    options?: FetchEnterprisesOptions & { loader?: () => Promise<ProtectedObjectOption[]> },
  ) => Promise<void>;
  upsertAssetInLibrary: (asset: DefenseAsset) => void;
  removeAssetFromLibrary: (assetId: string) => { ok: true } | { ok: false; reason: "asset-in-use"; message: string };
  clearProject: () => void;
  saveProjectToLocalStorage: () => void;
  restoreProjectFromLocalStorage: () => void;
  exportProjectJson: () => string;
  importProjectJson: (raw: string) => void;
};

// Legacy key is retained only as an identifier for explicitly exported old data; never read automatically.
export function projectStorageKey(userId: string) { return `${FORTIS_DEFENSE_PROJECT_STORAGE_KEY}:user:${encodeURIComponent(userId)}`; }

function persist(project: DefenseProject) {
  const state = useDefenseProjectStore.getState();
  const userId = state.runtimeMode === "demo" ? "demo" : state.identityId;
  if (!userId) return;
  const result = writeProjectDraft({ schemaVersion: 1, userId, enterpriseId: project.enterpriseId ?? project.baseObject.id,
    projectId: project.projectId, draft: project, savedProject: state.savedProject, businessRevision: state.businessRevision,
    savedAt: new Date().toISOString(), ...(state.saveAttempt ? { attempt: state.saveAttempt } : {}),
  }, state.localDraftsEnabled);
  useDefenseProjectStore.setState({ localDraftSaved: result.ok && result.value, draftStorageError: result.ok ? null : result.error });
}

function syncSelection(project: DefenseProject) {
  return {
    activeLayerId: project.activeLayerId,
    selectedAssetId: project.selectedAssetId,
    selectedObjectId: project.selectedObjectId,
  };
}

function createFallbackProtectedObjectOption(baseObject: ProtectedObject): ProtectedObjectOption {
  return {
    ...baseObject,
    enterpriseId: baseObject.id,
    source: "fallback",
  };
}

function mergeProtectedObjectOptions(
  baseObject: ProtectedObject,
  nextOptions: ProtectedObjectOption[],
  currentOptions: ProtectedObjectOption[] = [],
) {
  const merged = [...nextOptions];
  if (!merged.some((item) => item.id === baseObject.id)) {
    merged.push(
      currentOptions.find((item) => item.id === baseObject.id) ?? createFallbackProtectedObjectOption(baseObject),
    );
  }

  const seen = new Set<string>();
  const deduped: ProtectedObjectOption[] = [];
  for (const item of merged) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }

  return deduped.length > 0 ? deduped : [createFallbackProtectedObjectOption(baseObject)];
}

function applyProject(project: DefenseProject, set: (state: Partial<DefenseProjectState>) => void) {
  const state = useDefenseProjectStore.getState();
  const savedProject = state.savedProject?.projectId === project.projectId ? state.savedProject : null;
  const changed = businessContent(project) !== businessContent(state.project);
  set({ project, savedProject, businessRevision: state.businessRevision + (changed ? 1 : 0), hydrated: true,
    syncStatus: state.accessError ? "unverified" : savedProject && businessContent(project) === businessContent(savedProject) ? "saved" : "dirty",
    budgetApplied: false, ...syncSelection(project) });
  persist(project);
}

export const useDefenseProjectStore = create<DefenseProjectState>((set, get) => {
  const initialProject = createWorkspaceDefenseProject();
  return {
    identityId: null,
    accessError: null,
    project: initialProject,
    hydrated: false,
    runtimeMode: "workspace",
    syncStatus: "unverified",
    businessRevision: 0,
    savedProject: null,
    saveAttempt: null,
    draftStorageError: null,
    localDraftSaved: false,
    acceptServerProject: (project) => set({ project, savedProject: project, saveAttempt: null, businessRevision: 0,
      hydrated: true, syncStatus: "saved", accessError: null, localDraftSaved: false, draftStorageError: null, ...syncSelection(project) }),
    recordSavedProject: (sent, server) => {
      const latest = get().project;
      const project = { ...latest, projectId: server.projectId, enterpriseId: server.enterpriseId, version: server.version, updatedAt: server.updatedAt, source: "backend" as const };
      const baseline = { ...sent, projectId: server.projectId, enterpriseId: server.enterpriseId, version: server.version, updatedAt: server.updatedAt, source: "backend" as const };
      set({ project, savedProject: baseline, saveAttempt: null, syncStatus: businessContent(project) === businessContent(baseline) ? "saved" : "dirty", hydrated: true, ...syncSelection(project) });
      if (sent.projectId !== project.projectId && get().identityId) removeProjectDraft({ userId: get().identityId!, enterpriseId: sent.enterpriseId ?? sent.baseObject.id, projectId: sent.projectId }, get().localDraftsEnabled);
      persist(project);
    },
    restoreVerifiedDraft: (record) => {
      set({ project: record.draft, savedProject: record.savedProject, saveAttempt: record.attempt ?? null,
        businessRevision: record.businessRevision, hydrated: true, syncStatus: "dirty", localDraftSaved: true, draftStorageError: null, accessError: null, ...syncSelection(record.draft) });
    },
    localDraftsEnabled: false,
    setLocalDraftsEnabled: (localDraftsEnabled) => set({ localDraftsEnabled }),
    setRuntimeMode: (runtimeMode) => {
      set({ runtimeMode });
      if (runtimeMode === "demo" && !get().hydrated && get().project.source !== "backend") {
        set({ project: createDefaultDefenseProject(), hydrated: true, syncStatus: "unverified" });
      }
    },
    budgetApplied: false,
    assetLibraryLoading: false,
    assetLibraryError: null,
    assetLibraryPreview: null,
    protectedObjects: [],
    protectedObjectsLoading: false,
    protectedObjectsError: null,
    ...syncSelection(initialProject),
    createLayer: (data) => {
      if (get().project.layers.length >= MAX_DEFENSE_PROJECT_LAYERS) return;
      const layer = createRingLayer(get().project, { ...data, isActive: true });
      const project = {
        ...get().project,
        layers: [
          ...get().project.layers.map((item) => ({ ...item, isActive: false })),
          layer,
        ],
        activeLayerId: layer.id,
        updatedAt: new Date().toISOString(),
      };
      applyProject(project, set);
    },
    createLayerFromDraft: (draft) => {
      if (get().project.layers.length >= MAX_DEFENSE_PROJECT_LAYERS) {
        return {
          ok: false,
          validation: {
            isValid: false,
            level: "error",
            message: `Достигнут максимум: ${MAX_DEFENSE_PROJECT_LAYERS} эшелонов.`,
          },
        };
      }
      const validation = validateLayerDraft(get().project, {
        name: draft.name ?? "",
        code: draft.code ?? "",
        innerRadiusM: draft.innerRadiusM,
        widthM: draft.widthM,
        geometry: draft.geometry,
      });
      if (!validation.isValid) return { ok: false, validation };
      const layer = createRingLayer(get().project, {
        ...draft,
        name: draft.name?.trim(),
        code: draft.code?.trim(),
        isActive: true,
      });
      const project = {
        ...get().project,
        layers: [
          ...get().project.layers.map((item) => ({ ...item, isActive: false })),
          layer,
        ].map((item, index) => ({ ...item, order: index + 1 })),
        activeLayerId: layer.id,
        updatedAt: new Date().toISOString(),
      };
      applyProject(project, set);
      return { ok: true, layer };
    },
    updateLayerFromDraft: (layerId, draft) => {
      if (!canEditLayer(get().project, layerId)) {
        return {
          ok: false,
          validation: {
            isValid: false,
            level: "error",
            message: "Эшелон заблокирован. Сначала снимите блокировку.",
          },
        };
      }
      const layer = get().project.layers.find((item) => item.id === layerId);
      if (!layer) {
        return {
          ok: false,
          validation: {
            isValid: false,
            level: "error",
            message: "Эшелон не найден.",
          },
        };
      }
      const validation = validateLayerDraft(
        get().project,
        {
          name: draft.name ?? layer.name,
          code: draft.code ?? layer.code,
          innerRadiusM: draft.innerRadiusM,
          widthM: draft.widthM,
          geometry: draft.geometry,
        },
        layerId,
      );
      if (!validation.isValid) return { ok: false, validation };
      const updatedLayer =
        draft.geometry?.type === "polygon"
          ? {
              ...layer,
              geometryType: "polygon" as const,
              geometry: draft.geometry,
              name: (draft.name ?? layer.name).trim(),
              code: (draft.code ?? layer.code).trim(),
            }
          : {
              ...updateLayerGeometryFromRadii(layer, {
                innerRadiusM: draft.innerRadiusM,
                widthM: draft.widthM,
              }),
              name: (draft.name ?? layer.name).trim(),
              code: (draft.code ?? layer.code).trim(),
            };
      const project = syncPlacedObjectConflictFlags({
        ...get().project,
        layers: get().project.layers.map((item) => (item.id === layerId ? updatedLayer : item)),
        updatedAt: new Date().toISOString(),
      });
      applyProject(project, set);
      return { ok: true, layer: updatedLayer };
    },
    updateLayer: (layerId, patch) => {
      if (!canEditLayer(get().project, layerId)) return;
      const project = syncPlacedObjectConflictFlags({
        ...get().project,
        layers: get().project.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
        updatedAt: new Date().toISOString(),
      });
      applyProject(project, set);
    },
    updateLayerGeometry: (layerId, radii) => {
      if (!canEditLayer(get().project, layerId)) {
        return {
          ok: false,
          validation: {
            isValid: false,
            level: "error",
            message: "Эшелон заблокирован. Сначала снимите блокировку.",
          },
        };
      }
      const layer = get().project.layers.find((item) => item.id === layerId);
      if (!layer) {
        return {
          ok: false,
          validation: {
            isValid: false,
            level: "error",
            message: "Эшелон не найден.",
          },
        };
      }
      const updatedLayer = updateLayerGeometryFromRadii(layer, radii);
      const validation = validateLayerGeometry(get().project, updatedLayer, layerId);
      if (!validation.isValid) return { ok: false, validation };
      const project = syncPlacedObjectConflictFlags({
        ...get().project,
        layers: get().project.layers.map((item) => (item.id === layerId ? updatedLayer : item)),
        updatedAt: new Date().toISOString(),
      });
      applyProject(project, set);
      return { ok: true, layer: updatedLayer };
    },
    deleteLayer: (layerId) => {
      const result = deleteLayerFromProject(get().project, layerId);
      if (result.ok) applyProject(result.project, set);
      return result;
    },
    moveLayerUp: (layerId) => applyProject(updateLayerOrder(get().project, layerId, "up"), set),
    moveLayerDown: (layerId) => applyProject(updateLayerOrder(get().project, layerId, "down"), set),
    setLayerVisibility: (layerId, isVisible) => {
      const project = {
        ...get().project,
        layers: get().project.layers.map((layer) => (layer.id === layerId ? { ...layer, isVisible } : layer)),
        updatedAt: new Date().toISOString(),
      };
      applyProject(project, set);
    },
    setLayerLocked: (layerId, isLocked) => {
      const project = {
        ...get().project,
        layers: get().project.layers.map((layer) => (layer.id === layerId ? { ...layer, isLocked } : layer)),
        updatedAt: new Date().toISOString(),
      };
      applyProject(project, set);
    },
    selectLayer: (layerId) => {
      const project = {
        ...get().project,
        activeLayerId: layerId,
        layers: get().project.layers.map((layer) => ({ ...layer, isActive: layer.id === layerId })),
      };
      set({ project, ...syncSelection(project) });
      persist(project);
    },
    setBaseObjectCenter: (center) => {
      const current = get().project.baseObject.center;
      if (current.lat === center.lat && current.lng === center.lng) return;
      const project = recenterProject(get().project, center);
      applyProject(project, set);
      set({
        protectedObjects: mergeProtectedObjectOptions(project.baseObject, get().protectedObjects, get().protectedObjects),
      });
    },
    selectBaseObject: (baseObject) => {
      const project = setProjectBaseObject(get().project, baseObject);
      applyProject(project, set);
      set({
        protectedObjects: mergeProtectedObjectOptions(project.baseObject, get().protectedObjects, get().protectedObjects),
        protectedObjectsError: null,
      });
    },
    selectAsset: (assetId) => {
      const before = get().project;
      const project = { ...before, selectedAssetId: assetId, mode: "place-object" as const };
      const preview = get().assetLibraryPreview;
      set({ project, ...syncSelection(project), assetLibraryPreview: preview?.baseProject === before
        ? {...preview, baseProject: project} : preview });
      persist(project);
    },
    selectObject: (objectId) => {
      const object = objectId ? get().project.placedObjects.find((item) => item.id === objectId) : null;
      if (!object && objectId) return;
      const project = {
        ...get().project,
        selectedObjectId: object?.id,
        activeLayerId: object ? object.layerId : get().project.activeLayerId,
        layers: get().project.layers.map((layer) => ({ ...layer, isActive: object ? layer.id === object.layerId : layer.id === get().project.activeLayerId })),
      };
      set({ project, ...syncSelection(project) });
      persist(project);
    },
    setAssetQuantity: (assetId, quantity) => applyProject(setAssetQuantityInProject(get().project, assetId, quantity), set),
    placeObject: (assetId, layerId, coordinates, patch) => {
      const validation = validateObjectPlacement(get().project, assetId, layerId, coordinates);
      if (!validation.isValid) return validation;
      const project = placeObjectInProject(get().project, assetId, layerId, coordinates, patch);
      applyProject(project, set);
      return validation;
    },
    moveObject: (objectId, coordinates) => {
      const object = get().project.placedObjects.find((item) => item.id === objectId);
      const validation = object
        ? validateObjectPlacement(get().project, object.assetId, object.layerId, coordinates)
        : { isValid: false, level: "error" as const, message: "Объект не найден" };
      if (!validation.isValid) return validation;
      applyProject(movePlacedObjectInProject(get().project, objectId, coordinates), set);
      return validation;
    },
    transferObjectToLayer: (objectId, layerId) => {
      const result = transferPlacedObjectToLayerInProject(get().project, objectId, layerId);
      if (result.validation.isValid) applyProject(result.project, set);
      return result.validation;
    },
    updatePlacedObject: (objectId, patch) => applyProject(updatePlacedObjectInProject(get().project, objectId, patch), set),
    setPlacedObjectMapVisibility: (objectId, isVisibleOnMap) =>
      applyProject(updatePlacedObjectInProject(get().project, objectId, { isVisibleOnMap }), set),
    deletePlacedObject: (objectId) => applyProject(deletePlacedObjectInProject(get().project, objectId), set),
    duplicatePlacedObject: (objectId) => applyProject(duplicatePlacedObjectInProject(get().project, objectId), set),
    validateObjectPlacement: (assetId, layerId, coordinates) => validateObjectPlacement(get().project, assetId, layerId, coordinates),
    loadPresetProject: (presetId) => {
      if (get().runtimeMode !== "demo") return;
      const legacy = loadPresetIntoConfiguration(presetId);
      const project = {
        ...legacySelectedConfigurationToProject(legacy),
        source: "preset" as const,
        basePresetId: presetId,
      };
      applyProject(project, set);
    },
    replaceProject: (project) => applyProject(project, set),
    applyBudgetSelection: (picks) => {
      const lines = picks
        .filter((pick) => pick.included)
        .map((pick) => ({ assetId: pick.assetId, quantity: 1 }));
      applyProject({ ...applyAssetQuantityDraftsToProject(get().project, lines), source: "custom" }, set);
      set({ budgetApplied: true });
    },
    refreshAssetLibrary: async (options = {}) => {
      const generation = sessionGeneration();
      const { loader, ...query } = options;
      const startingProject = get().project;
      set({ assetLibraryLoading: true, assetLibraryError: null });
      try {
        const assets = loader ? await loader() : get().runtimeMode === "demo" ? defenseAssetLibrary : await fetchAssetLibrary(query);
        if (generation !== sessionGeneration()) return;
        // A refresh for a previous project must not replace the newly opened project.
        if (get().project !== startingProject) { set({ assetLibraryLoading: false }); return; }
        const merged = new Map(startingProject.assetLibrary.map(asset => [asset.id,asset]));
        for (const asset of assets) merged.set(asset.id,asset);
        const nextAssets = [...merged.values()];
        const changed = JSON.stringify(nextAssets) !== JSON.stringify(startingProject.assetLibrary);
        set({ assetLibraryLoading: false, assetLibraryError: null, assetLibraryPreview: changed ? {baseProject: startingProject, assets: nextAssets, generation} : null });
        if (startingProject.source !== "backend" && startingProject.assetLibrary.length === 0 && startingProject.placedObjects.length === 0 && changed) get().applyAssetLibraryPreview();
      } catch (error) {
        if (generation !== sessionGeneration()) return;
        set({ assetLibraryLoading: false, assetLibraryError: error instanceof Error ? error.message : "Не удалось загрузить библиотеку с сервера." });
      }
    },
    applyAssetLibraryPreview: () => {
      const preview = get().assetLibraryPreview;
      set({assetLibraryPreview: null});
      if (!preview || preview.baseProject !== get().project || preview.generation !== sessionGeneration() || get().accessError) return false;
      applyProject({...preview.baseProject,assetLibrary:preview.assets,updatedAt:new Date().toISOString()},set);
      return true;
    },
    discardAssetLibraryPreview: () => set({assetLibraryPreview:null}),
    refreshProtectedObjects: async (options = {}) => {
      const generation = sessionGeneration();
      const { loader, ...query } = options;
      set({ protectedObjectsLoading: true, protectedObjectsError: null });
      try {
        const objects = loader ? await loader() : get().runtimeMode === "demo"
          ? [createFallbackProtectedObjectOption(get().project.baseObject)] : await fetchEnterprises(query);
        if (generation !== sessionGeneration()) return;
        set({ protectedObjects: objects, protectedObjectsLoading: false, protectedObjectsError: null });
      } catch (error) {
        if (generation !== sessionGeneration()) return;
        set({ protectedObjectsLoading: false, protectedObjectsError: error instanceof Error ? error.message : "Не удалось загрузить объекты защиты с сервера." });
      }
    },
    upsertAssetInLibrary: (asset) => {
      const baseProject = get().project;
      const preview = get().assetLibraryPreview;
      const pendingAssets = preview?.baseProject === baseProject && preview.generation === sessionGeneration()
        ? preview.assets : baseProject.assetLibrary;
      const assets = new Map(pendingAssets.map(item=>[item.id,item]));
      assets.set(asset.id,asset);
      set({assetLibraryPreview:{baseProject,assets:[...assets.values()],generation:sessionGeneration()},assetLibraryError:null});
    },
    removeAssetFromLibrary: (assetId) => {
      if (get().project.placedObjects.some((object) => object.assetId === assetId)) {
        return {
          ok: false,
          reason: "asset-in-use",
          message: "Средство уже размещено на карте. Сначала удалите или замените размещённые объекты.",
        };
      }
      const project = {
        ...get().project,
        assetLibrary: get().project.assetLibrary.filter((asset) => asset.id !== assetId),
        selectedAssetId: get().project.selectedAssetId === assetId ? undefined : get().project.selectedAssetId,
        updatedAt: new Date().toISOString(),
      };
      applyProject(project, set);
      set({ assetLibraryError: null });
      return { ok: true };
    },
    clearProject: () => {
      const project = get().runtimeMode === "demo" ? createDefaultDefenseProject() : { ...initialProject, updatedAt: new Date().toISOString() };
      set({
        project, savedProject: null, saveAttempt: null, businessRevision: 0, syncStatus: "dirty",
        hydrated: true,
        budgetApplied: false,
        assetLibraryError: null,
        protectedObjects: [createFallbackProtectedObjectOption(project.baseObject)],
        protectedObjectsError: null,
        ...syncSelection(project),
      });
    },
    saveProjectToLocalStorage: () => persist(get().project),
    restoreProjectFromLocalStorage: () => {
      // Recovery is offered explicitly by the variants UI after fresh resource authorization.
      if (!get().hydrated) set({ hydrated: true });
    },
    exportProjectJson: () => exportDefenseProjectJson(get().project),
    importProjectJson: (raw) => {
      const project = importDefenseProjectJson(raw);
      applyProject(project, set);
    },
  };
});
