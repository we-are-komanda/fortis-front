import { create } from "zustand";
import { sessionGeneration } from "@/shared/lib/session-state";

import { useDefenseStudioStore } from "@/modules/drone-defense/domain/use-defense-studio-store";
import {
  deleteVariant as apiDeleteVariant,
  listVariants as apiListVariants,
  loadVariant as apiLoadVariant,
  prepareProjectSave,
  sendProjectSaveAttempt,
  type VariantListQuery,
} from "@/modules/drone-defense/infra/api-client";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { businessContent, classifySaveVerification, type SaveAttempt } from "@/shared/lib/project-save-state";
import { readProjectDraft, type ProjectDraft } from "@/shared/lib/project-draft-storage";
import type { DefenseProject, VariantSummary } from "@/shared/types/defense-project";

type Status = "idle" | "loading" | "error";

type VariantsState = {
  variants: VariantSummary[];
  activeVariantId: string | null;
  activeVariantName: string | null;
  conflictState: { projectId: string; message: string } | null;
  listStatus: Status;
  listQuery: VariantListQuery | null;
  totalItems: number;
  listError: string | null;
  listForbidden: boolean;
  workspaceCreateAttempt: SaveAttempt | null;
  saveStatus: "idle" | "saving" | "error";
  loadStatus: Status;
  error: string | null;
  requestId: string | null;
  recoveryDraft: ProjectDraft | null;
  recoveryStatus: Status;
  recoveryError: string | null;

  fetchVariants: (query?: VariantListQuery | null) => Promise<void>;
  saveAsNewVariant: (name: string, proposedProject?: DefenseProject) => Promise<VariantSummary | null>;
  overwriteActiveVariant: () => Promise<void>;
  loadVariant: (id: string, signal?: AbortSignal) => Promise<DefenseProject | null>;
  deleteVariant: (id: string) => Promise<void>;
  checkRecoveryDraft: () => Promise<void>;
  clearRecoveryDraft: () => void;
};

function accessFailure(err: unknown, projectId: string) {
 if (useDefenseProjectStore.getState().project.projectId !== projectId) return;
 const status = (err as { status?: number })?.status;
 if (status === 403 || status === 404) useDefenseProjectStore.setState({ syncStatus: "unverified", accessError: status === 404 ? "Серверный проект больше недоступен. Локальная копия не подтверждена; откройте проект заново после восстановления доступа." : "Операция запрещена. Изменения не сохранены на сервере." });
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Операция не удалась";
}

function requestId(err: unknown): string | null {
  const id = (err as { requestId?: unknown } | null)?.requestId;
  return typeof id === "string" ? id : null;
}

function statusCode(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function isAmbiguous(err: unknown) {
  const status = statusCode(err);
  return status === undefined || status >= 500;
}

function isVersionConflict(err: unknown) {
  return err instanceof Error && (err as { status?: number; code?: string }).status === 409;
}

function withBackendContext(project: DefenseProject, summary: VariantSummary): DefenseProject {
  return {
    ...project,
    projectId: summary.projectId,
    projectName: summary.projectName || project.projectName,
    enterpriseId: summary.enterpriseId ?? project.enterpriseId,
    version: summary.version,
    source: "backend",
    updatedAt: summary.updatedAt || project.updatedAt,
  };
}

export function shouldLoadBackendProject(id: string) {
  const state = useDefenseProjectStore.getState();
  const hasUnsaved = state.syncStatus === "dirty" || state.saveAttempt !== null || (state.savedProject !== null && businessContent(state.project) !== businessContent(state.savedProject));
  if (state.hydrated && state.project.projectId === id && hasUnsaved) return false;
  return !state.hydrated || state.syncStatus === "unverified" || state.project.projectId !== id || state.project.source !== "backend";
}

let loadGeneration = 0;
let listGeneration = 0;

export const useDefenseVariantsStore = create<VariantsState>((set, get) => ({
  variants: [],
  activeVariantId: null,
  activeVariantName: null,
  conflictState: null,
  listStatus: "idle",
  listQuery: null,
  totalItems: 0,
  listError: null,
  listForbidden: false,
  workspaceCreateAttempt: null,
  saveStatus: "idle",
  loadStatus: "idle",
  error: null,
  requestId: null,
  recoveryDraft: null,
  recoveryStatus: "idle",
  recoveryError: null,

  fetchVariants: async (query) => {
    const identityGeneration = sessionGeneration();
    const generation = ++listGeneration;
    if (query === null) {
      set({ variants: [], totalItems: 0, listQuery: null, listStatus: "idle", listError: null, listForbidden: false });
      return;
    }
    const listQuery = query ?? get().listQuery ?? {};
    set({ variants: [], totalItems: 0, listQuery, listStatus: "loading", listError: null, listForbidden: false });
    try {
      const res = await apiListVariants(listQuery);
      if (identityGeneration !== sessionGeneration() || generation !== listGeneration) return;
      set({ variants: res.items, totalItems: res.totalItems, listStatus: "idle" });
    } catch (err) {
      if (identityGeneration !== sessionGeneration() || generation !== listGeneration) return;
      set({ listStatus: "error", listError: message(err), listForbidden: [403, 404].includes(statusCode(err) ?? 0) });
    }
  },

  checkRecoveryDraft: async () => {
    const projectState = useDefenseProjectStore.getState();
    const userId = projectState.runtimeMode === "demo" ? "demo" : projectState.identityId;
    const projectId = get().activeVariantId;
    if (!projectId || !userId || !projectState.localDraftsEnabled || projectState.project.projectId !== projectId || !projectState.project.enterpriseId) {
      set({ recoveryDraft: null, recoveryStatus: "idle", recoveryError: null });
      return;
    }
    const identityGeneration = sessionGeneration();
    set({ recoveryDraft: null, recoveryStatus: "loading", recoveryError: null });
    try {
      const server = await apiLoadVariant(projectId);
      if (identityGeneration !== sessionGeneration()) return;
      const latestProjectState = useDefenseProjectStore.getState();
      if (server.projectId !== projectId || server.enterpriseId !== projectState.project.enterpriseId || get().activeVariantId !== projectId || latestProjectState.project.projectId !== projectId || latestProjectState.project.enterpriseId !== server.enterpriseId || (latestProjectState.runtimeMode === "workspace" && latestProjectState.identityId !== userId)) {
        set({ recoveryStatus: "error", recoveryError: "Серверный проект не совпал с текущим scope; локальный черновик не показан." });
        return;
      }
      const result = readProjectDraft({ userId, enterpriseId: server.enterpriseId, projectId }, projectState.localDraftsEnabled);
      if (!result.ok) {
        set({ recoveryStatus: "error", recoveryError: result.error });
        return;
      }
      const record = result.value;
      useDefenseProjectStore.setState({ accessError: null });
      set({ recoveryDraft: record && businessContent(record.draft) !== businessContent(server) ? record : null, recoveryStatus: "idle", recoveryError: null });
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      accessFailure(err, projectId);
      set({ recoveryDraft: null, recoveryStatus: "error", recoveryError: message(err) });
    }
  },
  clearRecoveryDraft: () => set({ recoveryDraft: null, recoveryStatus: "idle", recoveryError: null }),

  saveAsNewVariant: async (name, proposedProject) => {
    const identityGeneration = sessionGeneration();
    const projectState = useDefenseProjectStore.getState();
    if (projectState.accessError && !proposedProject) return null;
    const startingProject = projectState.project;
    const project = proposedProject ?? startingProject;
    if (get().saveStatus === "saving") return null;
    name = name.trim();
    if (!name || [...name].length > 120) {
      set({ saveStatus: "error", error: "Название должно содержать от 1 до 120 символов." });
      return null;
    }
    if (!project.enterpriseId?.trim()) {
      set({ saveStatus: "error", error: "Выберите доступное предприятие." });
      return null;
    }
    set({ saveStatus: "saving", error: null, requestId: null, conflictState: null });
    const pendingAttempt = proposedProject ? get().workspaceCreateAttempt : projectState.saveAttempt;
    const attempt = pendingAttempt?.kind === "create" && (!proposedProject || (pendingAttempt.name === name && businessContent(pendingAttempt.project) === businessContent(project)))
      ? pendingAttempt
      : prepareProjectSave("create", name, project, projectState.businessRevision);
    if (proposedProject) set({ workspaceCreateAttempt: attempt });
    else projectState.setSaveAttempt(attempt);
    try {
      const summary = await sendProjectSaveAttempt(attempt);
      if (identityGeneration !== sessionGeneration()) return null;
      const latest = useDefenseProjectStore.getState().project;
      if (proposedProject ? latest !== startingProject : latest.projectId !== attempt.project.projectId) {
        set({ saveStatus: "error", error: "Текущий проект изменён во время создания. Новый вариант сохранён; откройте его из списка явно." });
        return null;
      }
      if (proposedProject) useDefenseProjectStore.getState().acceptServerProject(withBackendContext(attempt.project, summary));
      else useDefenseProjectStore.getState().recordSavedProject(attempt.project, withBackendContext(attempt.project, summary));
      const committedProject = useDefenseProjectStore.getState().project;
      set({ saveStatus: "idle", workspaceCreateAttempt: proposedProject ? null : get().workspaceCreateAttempt, requestId: null, activeVariantId: summary.projectId, activeVariantName: summary.name });
      await get().fetchVariants();
      if (identityGeneration !== sessionGeneration() || useDefenseProjectStore.getState().project !== committedProject) return null;
      return summary;
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return null;
      if (!proposedProject && useDefenseProjectStore.getState().project.projectId !== attempt.project.projectId) { set({ saveStatus: "idle" }); return null; }
      if (!proposedProject) accessFailure(err, attempt.project.projectId);
      const status = statusCode(err);
      if (status !== undefined && status < 500 && ![401, 403, 404, 409].includes(status)) {
        if (proposedProject) set({ workspaceCreateAttempt: null });
        else useDefenseProjectStore.getState().setSaveAttempt(null);
      }
      set({ saveStatus: "error", error: message(err), requestId: requestId(err),
        conflictState: status === 409 ? { projectId: attempt.project.projectId, message: message(err) } : null });
      return null;
    }
  },

  overwriteActiveVariant: async () => {
    const identityGeneration = sessionGeneration();
    if (useDefenseProjectStore.getState().accessError) return;
    const { activeVariantId, activeVariantName } = get();
    if (!activeVariantId) return;
    if (get().saveStatus === "saving") return;
    const projectState = useDefenseProjectStore.getState();
    const project = projectState.project;
    if (project.projectId !== activeVariantId) return;
    if (!project.enterpriseId?.trim()) {
      set({ saveStatus: "error", error: "Предприятие проекта не подтверждено. Откройте доступный проект из рабочей зоны." });
      return;
    }
    if (projectState.saveAttempt?.kind === "create") {
      await get().saveAsNewVariant(projectState.saveAttempt.name);
      return;
    }
    if (!projectState.saveAttempt && projectState.syncStatus === "saved") return;
    set({ saveStatus: "saving", error: null, requestId: null, conflictState: null });
    let attempt: SaveAttempt;
    const pendingAttempt = projectState.saveAttempt;
    if (pendingAttempt?.kind === "update" && pendingAttempt.project.projectId === activeVariantId && pendingAttempt.verificationRequired) {
      try {
        const server = await apiLoadVariant(activeVariantId);
        if (identityGeneration !== sessionGeneration()) return;
        if (useDefenseProjectStore.getState().project.projectId !== project.projectId || useDefenseProjectStore.getState().project.enterpriseId !== project.enterpriseId) { set({ saveStatus: "idle" }); return; }
        const verification = classifySaveVerification(pendingAttempt.project, server, projectState.savedProject ?? pendingAttempt.project);
        if (verification === "saved") {
          projectState.recordSavedProject(pendingAttempt.project, server);
          set({ saveStatus: "idle", requestId: null, activeVariantName: server.projectName });
          await get().fetchVariants();
          return;
        }
        if (verification === "conflict") {
          const conflictMessage = "На сервере уже другая версия. Откройте её или сохраните изменения отдельным вариантом.";
          set({ saveStatus: "error", error: conflictMessage, conflictState: { projectId: activeVariantId, message: conflictMessage } });
          return;
        }
        attempt = { ...pendingAttempt, verificationRequired: false };
      } catch (err) {
        if (identityGeneration !== sessionGeneration()) return;
        accessFailure(err, activeVariantId);
        set({ saveStatus: "error", error: `Не удалось проверить результат предыдущего сохранения: ${message(err)}`, requestId: requestId(err) });
        return;
      }
    } else if (pendingAttempt?.kind === "update" && pendingAttempt.project.projectId === activeVariantId &&
      pendingAttempt.project.version === project.version && businessContent(pendingAttempt.project) === businessContent(project) && pendingAttempt.name === (activeVariantName ?? project.projectName)) {
      attempt = pendingAttempt;
    } else {
      attempt = prepareProjectSave("update", activeVariantName ?? project.projectName, project, projectState.businessRevision);
    }
    useDefenseProjectStore.getState().setSaveAttempt(attempt);
    try {
      const summary = await sendProjectSaveAttempt(attempt);
      if (identityGeneration !== sessionGeneration()) return;
      const latest = useDefenseProjectStore.getState().project;
      if (latest.projectId !== attempt.project.projectId) { set({ saveStatus: "idle" }); return; }
      useDefenseProjectStore.getState().recordSavedProject(attempt.project, withBackendContext(attempt.project, summary));
      set({ saveStatus: "idle", requestId: null, activeVariantName: summary.name });
      await get().fetchVariants();
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return;
      if (useDefenseProjectStore.getState().project.projectId !== attempt.project.projectId) { set({ saveStatus: "idle" }); return; }
      accessFailure(err, activeVariantId);
      if (isVersionConflict(err)) {
        useDefenseProjectStore.getState().setSaveAttempt(null);
        const errorMessage = "Версия проекта устарела: откройте актуальную версию или сохраните отдельным вариантом.";
        set({ saveStatus: "error", error: errorMessage, requestId: requestId(err), conflictState: { projectId: activeVariantId, message: errorMessage } });
        return;
      }
      if (!isAmbiguous(err)) {
        if (![401, 403, 404].includes(statusCode(err) ?? 0)) useDefenseProjectStore.getState().setSaveAttempt(null);
        set({ saveStatus: "error", error: message(err), requestId: requestId(err) });
        return;
      }
      const verifyAttempt = { ...attempt, verificationRequired: true };
      useDefenseProjectStore.getState().setSaveAttempt(verifyAttempt);
      try {
        const server = await apiLoadVariant(attempt.project.projectId);
        if (identityGeneration !== sessionGeneration()) return;
        if (useDefenseProjectStore.getState().project.projectId !== project.projectId || useDefenseProjectStore.getState().project.enterpriseId !== project.enterpriseId) { set({ saveStatus: "idle" }); return; }
        const verification = classifySaveVerification(attempt.project, server, projectState.savedProject ?? attempt.project);
        if (verification === "saved") {
          useDefenseProjectStore.getState().recordSavedProject(attempt.project, server);
          set({ saveStatus: "idle", requestId: requestId(err), activeVariantName: get().activeVariantName ?? server.projectName });
          await get().fetchVariants();
          return;
        }
        const errorMessage = verification === "retry"
          ? "Ответ на сохранение не получен. Серверная версия не изменилась; повторите сохранение явно."
          : "Серверная версия отличается от отправленной. Проверьте конфликт перед сохранением.";
        set({ saveStatus: "error", error: errorMessage, requestId: requestId(err),
          conflictState: verification === "conflict" ? { projectId: activeVariantId, message: errorMessage } : null });
      } catch (verifyError) {
        if (identityGeneration !== sessionGeneration()) return;
        accessFailure(verifyError, activeVariantId);
        set({ saveStatus: "error", error: `Результат сохранения не подтверждён: ${message(verifyError)}`, requestId: requestId(err) });
      }
    }
  },

  loadVariant: async (id, signal) => {
    const identityGeneration = sessionGeneration();
    const generation = ++loadGeneration;
    const startingProject = useDefenseProjectStore.getState().project;
    set({ loadStatus: "loading", error: null });
    try {
      const project = await apiLoadVariant(id, signal);
      if (identityGeneration !== sessionGeneration() || signal?.aborted || generation !== loadGeneration) return null;
      if (project.projectId !== id) throw new Error("Ответ сервера не соответствует выбранному проекту.");
      if (useDefenseProjectStore.getState().project !== startingProject) {
        set({ loadStatus: "error", error: "Проект изменён во время загрузки. Локальные изменения сохранены; повторите открытие явно." });
        return null;
      }
      const known = get().variants.find((v) => v.projectId === id);
      useDefenseProjectStore.getState().acceptServerProject({
        ...project,
        version: project.version,
        source: "backend",
      });
      useDefenseStudioStore.setState({ selectedPlacementId: null });
      set({
        loadStatus: "idle",
        activeVariantId: project.projectId,
        activeVariantName: known?.name ?? project.projectName,
        conflictState: null,
      });
      return project;
    } catch (err) {
      if (identityGeneration !== sessionGeneration()) return null;
      if (signal?.aborted || generation !== loadGeneration) { if (generation === loadGeneration) set({ loadStatus: "idle" }); return null; }
      accessFailure(err, id);
      set({ loadStatus: "error", error: message(err) });
      return null;
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
