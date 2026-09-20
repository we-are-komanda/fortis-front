import { create } from "zustand";
import { sessionGeneration } from "@/shared/lib/session-state";

import { useDefenseStudioStore } from "@/modules/drone-defense/domain/use-defense-studio-store";
import {
  deleteVariant as apiDeleteVariant,
  listVariants as apiListVariants,
  loadVariant as apiLoadVariant,
  overwriteVariant as apiOverwriteVariant,
  saveVariantAsNew as apiSaveVariantAsNew,
} from "@/modules/drone-defense/infra/api-client";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import type { DefenseProject, VariantSummary } from "@/shared/types/defense-project";

type Status = "idle" | "loading" | "error";

type VariantsState = {
  variants: VariantSummary[];
  activeVariantId: string | null;
  activeVariantName: string | null;
  conflictState: { projectId: string; message: string } | null;
  listStatus: Status;
  saveStatus: "idle" | "saving" | "error";
  loadStatus: Status;
  error: string | null;

  fetchVariants: () => Promise<void>;
  saveAsNewVariant: (name: string) => Promise<void>;
  overwriteActiveVariant: () => Promise<void>;
  loadVariant: (id: string, signal?: AbortSignal) => Promise<void>;
  deleteVariant: (id: string) => Promise<void>;
};

function accessFailure(err: unknown, projectId: string) {
 if (useDefenseProjectStore.getState().project.projectId !== projectId) return;
 const status = (err as { status?: number })?.status;
 if (status === 403 || status === 404) useDefenseProjectStore.setState({ syncStatus: "unverified", accessError: status === 404 ? "Серверный проект больше недоступен. Локальная копия не подтверждена; откройте проект заново после восстановления доступа." : "Операция запрещена. Изменения не сохранены на сервере." });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Операция не удалась";
}

function isVersionConflict(err: unknown) {
  return err instanceof Error && (err as { status?: number; code?: string }).status === 409;
}

function withBackendContext(project: DefenseProject, summary: VariantSummary): DefenseProject {
  return {
    ...project,
    projectId: summary.projectId,
    projectName: summary.projectName || project.projectName,
    enterpriseId: summary.enterpriseId ?? project.enterpriseId ?? project.baseObject.id,
    version: summary.version,
    source: "backend",
    updatedAt: summary.updatedAt || project.updatedAt,
  };
}

export function shouldLoadBackendProject(id: string) {
  const state = useDefenseProjectStore.getState();
  return !state.hydrated || state.syncStatus === "unverified" || state.project.projectId !== id || state.project.source !== "backend";
}

let loadGeneration = 0;

export const useDefenseVariantsStore = create<VariantsState>((set, get) => ({
  variants: [],
  activeVariantId: null,
  activeVariantName: null,
  conflictState: null,
  listStatus: "idle",
  saveStatus: "idle",
  loadStatus: "idle",
  error: null,

  fetchVariants: async () => {
    const identityGeneration = sessionGeneration();
    set({ listStatus: "loading", error: null });
    try {
      const res = await apiListVariants();
      if (identityGeneration !== sessionGeneration()) return;
      set({ variants: res.items, listStatus: "idle" });
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      set({ listStatus: "error", error: message(err) });
    }
  },

  saveAsNewVariant: async (name) => {
    const identityGeneration = sessionGeneration();
    if (useDefenseProjectStore.getState().accessError) return;
    const project = useDefenseProjectStore.getState().project;
    set({ saveStatus: "saving", error: null, conflictState: null });
    try {
      const summary = await apiSaveVariantAsNew({ name, project });
      if (identityGeneration !== sessionGeneration()) return;
      const latest = useDefenseProjectStore.getState().project;
      if (latest.projectId !== project.projectId) { set({ saveStatus: "idle" }); return; }
      const pending = latest !== project;
      useDefenseProjectStore.getState().replaceProject(withBackendContext(pending ? latest : project, summary));
      useDefenseProjectStore.setState({ syncStatus: pending ? "dirty" : "saved" });
      set({ saveStatus: "idle", activeVariantId: summary.projectId, activeVariantName: summary.name });
      await get().fetchVariants();
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      if (useDefenseProjectStore.getState().project.projectId !== project.projectId) { set({ saveStatus: "idle" }); return; }
      accessFailure(err, project.projectId);
      set({ saveStatus: "error", error: message(err) });
    }
  },

  overwriteActiveVariant: async () => {
    const identityGeneration = sessionGeneration();
    if (useDefenseProjectStore.getState().accessError) return;
    const { activeVariantId, activeVariantName } = get();
    if (!activeVariantId) return;
    set({ saveStatus: "saving", error: null, conflictState: null });
    try {
      const project = useDefenseProjectStore.getState().project;
      const summary = await apiOverwriteVariant({
        id: activeVariantId,
        name: activeVariantName ?? project.projectName,
        project,
      });
      if (identityGeneration !== sessionGeneration()) return;
      const latest = useDefenseProjectStore.getState().project;
      if (latest.projectId !== project.projectId) { set({ saveStatus: "idle" }); return; }
      const pending = latest !== project;
      useDefenseProjectStore.getState().replaceProject(withBackendContext(pending ? latest : project, summary));
      useDefenseProjectStore.setState({ syncStatus: pending ? "dirty" : "saved" });
      set({ saveStatus: "idle", activeVariantName: summary.name });
      await get().fetchVariants();
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      if (useDefenseProjectStore.getState().project.projectId !== activeVariantId) { set({ saveStatus: "idle" }); return; }
      accessFailure(err, activeVariantId);
      const errorMessage = isVersionConflict(err)
        ? "Версия проекта устарела: перезагрузите актуальную версию перед сохранением."
        : message(err);
      set({
        saveStatus: "error",
        error: errorMessage,
        conflictState: isVersionConflict(err) ? { projectId: activeVariantId, message: errorMessage } : null,
      });
    }
  },

  loadVariant: async (id, signal) => {
    const identityGeneration = sessionGeneration();
    const generation = ++loadGeneration;
    const startingProject = useDefenseProjectStore.getState().project;
    set({ loadStatus: "loading", error: null });
    try {
      const project = await apiLoadVariant(id, signal);
      if (identityGeneration !== sessionGeneration() || signal?.aborted || generation !== loadGeneration) return;
      if (useDefenseProjectStore.getState().project !== startingProject) {
        set({ loadStatus: "error", error: "Проект изменён во время загрузки. Локальные изменения сохранены; повторите открытие явно." });
        return;
      }
      const known = get().variants.find((v) => v.projectId === id);
      useDefenseProjectStore.getState().replaceProject({
        ...project,
        enterpriseId: known?.enterpriseId ?? project.enterpriseId ?? project.baseObject.id,
        version: known?.version ?? project.version,
        source: "backend",
      });
      useDefenseProjectStore.setState({ syncStatus: "saved", accessError: null });
      useDefenseStudioStore.setState({ selectedPlacementId: null });
      set({
        loadStatus: "idle",
        activeVariantId: project.projectId,
        activeVariantName: known?.name ?? project.projectName,
        conflictState: null,
      });
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      if (signal?.aborted || generation !== loadGeneration) { if (generation === loadGeneration) set({ loadStatus: "idle" }); return; }
      accessFailure(err, id);
      set({ loadStatus: "error", error: message(err) });
    }
  },

  deleteVariant: async (id) => {
    const identityGeneration = sessionGeneration();
    set({ error: null });
    try {
      await apiDeleteVariant(id);
      if (identityGeneration !== sessionGeneration()) return;
      if (get().activeVariantId === id) {
        set({ activeVariantId: null, activeVariantName: null });
      }
      await get().fetchVariants();
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      accessFailure(err, id);
      set({ error: message(err) });
    }
  },
}));
