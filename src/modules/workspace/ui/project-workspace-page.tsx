"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { compareBackendProjects, type BackendProjectCompare } from "@/modules/defense-calculator/infra/backend-project-api";
import { fetchEnterprises } from "@/modules/drone-defense/infra/enterprise-api";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { createWorkspaceDefenseProject, setProjectBaseObject } from "@/shared/lib/defense-project";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { businessContent } from "@/shared/lib/project-save-state";
import { readProjectDraft, type ProjectDraft } from "@/shared/lib/project-draft-storage";
import type { ProtectedObjectOption } from "@/shared/types/defense-project";

type PendingTransition = { kind: "create"; enterprise: ProtectedObjectOption } | { kind: "open"; projectId: string };

export function ProjectWorkspacePage() {
  const router = useRouter();
  const [enterprises, setEnterprises] = useState<ProtectedObjectOption[]>([]);
  const [enterpriseStatus, setEnterpriseStatus] = useState<"idle" | "loading" | "error">("loading");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("Новая конфигурация");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareResult, setCompareResult] = useState<BackendProjectCompare | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);
  const [transitionSaveName, setTransitionSaveName] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<ProjectDraft | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryScopeEnterpriseId, setRecoveryScopeEnterpriseId] = useState<string | null>(null);

  const { variants, listStatus, saveStatus, error, fetchVariants, loadVariant, saveAsNewVariant, overwriteActiveVariant } =
    useDefenseVariantsStore();
  const replaceProject = useDefenseProjectStore((state) => state.replaceProject);
  const identityId = useDefenseProjectStore((state) => state.identityId);
  const localDraftsEnabled = useDefenseProjectStore((state) => state.localDraftsEnabled);
  const projectSyncStatus = useDefenseProjectStore((state) => state.syncStatus);
  const saveAttempt = useDefenseProjectStore((state) => state.saveAttempt);
  const restoreVerifiedDraft = useDefenseProjectStore((state) => state.restoreVerifiedDraft);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return [];
        setEnterpriseStatus("loading");
        return fetchEnterprises({ limit: 100 });
      })
      .then((items) => {
        if (cancelled) return;
        setEnterprises(items);
        setSelectedEnterpriseId((current) => items.some((item) => item.enterpriseId === current)
          ? current : items[0]?.enterpriseId ?? null);
        setEnterpriseStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setEnterpriseStatus("error");
      });
    void fetchVariants();
    return () => {
      cancelled = true;
    };
  }, [fetchVariants, refreshVersion]);

  useEffect(() => {
    if (enterpriseStatus !== "idle" || !identityId || !localDraftsEnabled || !selectedEnterpriseId || !enterprises.some((item) => item.enterpriseId === selectedEnterpriseId)) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const result = readProjectDraft({ userId: identityId, enterpriseId: selectedEnterpriseId, projectId: "current" }, true);
      setRecoveryScopeEnterpriseId(selectedEnterpriseId);
      if (!result.ok) {
        setRecoveryDraft(null);
        setRecoveryError(result.error);
        return;
      }
      setRecoveryError(null);
      const record = result.value;
      const current = useDefenseProjectStore.getState().project;
      setRecoveryDraft(record && businessContent(record.draft) !== businessContent(current) ? record : null);
    });
    return () => { cancelled = true; };
  }, [enterpriseStatus, enterprises, identityId, localDraftsEnabled, selectedEnterpriseId]);

  const selectedEnterprise = useMemo(
    () => enterpriseStatus === "idle" ? enterprises.find((item) => item.enterpriseId === selectedEnterpriseId) : undefined,
    [enterprises, selectedEnterpriseId, enterpriseStatus],
  );

  const filteredVariants = useMemo(() => {
    if (!selectedEnterprise) return [];
    const scoped = variants.filter((item) => item.enterpriseId === selectedEnterpriseId);
    return scoped;
  }, [selectedEnterprise, selectedEnterpriseId, variants]);

  function createProject(enterprise: ProtectedObjectOption) {
    setWorkspaceError(null);
    const baseProject = setProjectBaseObject(createWorkspaceDefenseProject(), enterprise);
    replaceProject({
      ...baseProject,
      enterpriseId: enterprise.enterpriseId,
      projectName: newProjectName.trim() || "Новая конфигурация",
      source: "custom",
    });
    void finishCreate(newProjectName.trim() || "Новая конфигурация");
  }

  async function finishCreate(name: string) {
    await saveAsNewVariant(name);
    const state = useDefenseVariantsStore.getState();
    if (state.error || state.activeVariantId === null || useDefenseProjectStore.getState().syncStatus !== "saved") {
      setWorkspaceError(state.error);
      return;
    }
    router.push(`/prototype?projectId=${encodeURIComponent(state.activeVariantId ?? "")}`);
  }

  async function finishOpenProject(projectId: string) {
    setWorkspaceError(null);
    await loadVariant(projectId);
    const state = useDefenseVariantsStore.getState();
    if (state.error || state.activeVariantId !== projectId || state.loadStatus !== "idle") {
      setWorkspaceError(state.error);
      return;
    }
    router.push(`/prototype?projectId=${encodeURIComponent(state.activeVariantId ?? "")}`);
  }

  function requestTransition(target: PendingTransition) {
    if (target.kind === "open" && useDefenseVariantsStore.getState().activeVariantId === target.projectId) {
      router.push(`/prototype?projectId=${encodeURIComponent(target.projectId)}`);
      return;
    }
    const project = useDefenseProjectStore.getState().project;
    const hasUnsaved = projectSyncStatus === "dirty" || saveAttempt !== null || saveStatus === "saving" || (projectSyncStatus === "unverified" && Boolean(project.enterpriseId));
    if (!hasUnsaved) {
      if (target.kind === "create") createProject(target.enterprise);
      else void finishOpenProject(target.projectId);
      return;
    }
    setTransitionSaveName(project.projectName);
    setPendingTransition(target);
  }

  async function resolveTransition(choice: "stay" | "discard" | "save") {
    const target = pendingTransition;
    if (!target || transitionBusy) return;
    if (choice === "stay") {
      setPendingTransition(null);
      return;
    }
    setTransitionBusy(true);
    try {
      if (choice === "save") {
        const activeId = useDefenseVariantsStore.getState().activeVariantId;
        if (activeId) await overwriteActiveVariant();
        else if (transitionSaveName.trim()) await saveAsNewVariant(transitionSaveName.trim());
        const current = useDefenseProjectStore.getState();
        const variantsState = useDefenseVariantsStore.getState();
        if (current.syncStatus !== "saved" || variantsState.saveStatus !== "idle" || variantsState.error) {
          setWorkspaceError(variantsState.error ?? "Сохранение не завершено; переход отменён, черновик сохранён.");
          return;
        }
      }
      setPendingTransition(null);
      if (target.kind === "create") createProject(target.enterprise);
      else await finishOpenProject(target.projectId);
    } finally {
      setTransitionBusy(false);
    }
  }

  function restoreLocalDraft() {
    const record = recoveryDraft;
    if (!record || !identityId || !enterprises.some((item) => item.enterpriseId === record.enterpriseId)) return;
    const current = useDefenseProjectStore.getState();
    if (current.identityId !== record.userId || selectedEnterpriseId !== record.enterpriseId) return;
    if ((current.syncStatus === "dirty" || current.project.projectId !== "current") && !window.confirm("Заменить текущий проект восстановленным локальным черновиком? Сервер не изменится до явного сохранения.")) return;
    restoreVerifiedDraft(record);
    setRecoveryDraft(null);
  }

  async function handleCompare() {
    if (!compareA || !compareB) return;
    setWorkspaceError(null);
    setCompareLoading(true);
    try {
      setCompareResult(await compareBackendProjects(compareA, compareB));
    } catch {
      setCompareResult(null);
      setWorkspaceError("Не удалось сравнить выбранные конфигурации.");
    } finally {
      setCompareLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef3f8] px-5 py-6 text-slate-900 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">Рабочая зона</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Предприятие и конфигурация</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              setRefreshVersion((version) => version + 1);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-blue-400 hover:text-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить
          </button>
        </header>

        {(error || workspaceError) ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {workspaceError ?? error}
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Предприятия</h2>
            <div className="mt-4 flex flex-col gap-2">
              {enterpriseStatus === "loading" ? <p className="text-sm text-slate-500">Загрузка...</p> : null}
              {enterpriseStatus === "error" ? (
                <p role="alert" className="text-sm text-amber-700">Не удалось загрузить предприятия. Нажмите «Обновить», чтобы повторить попытку.</p>
              ) : null}
              {enterpriseStatus === "idle" && enterprises.length === 0 ? (
                <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Нет доступных предприятий.</p>
                  <p className="mt-2">Для создания конфигурации администратор должен назначить вашему аккаунту доступ к предприятию. После назначения нажмите «Обновить».</p>
                </div>
              ) : null}
              {enterprises.map((enterprise) => (
                <button
                  key={enterprise.enterpriseId}
                  type="button"
                  onClick={() => setSelectedEnterpriseId(enterprise.enterpriseId)}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    selectedEnterprise?.enterpriseId === enterprise.enterpriseId
                      ? "border-blue-500 bg-blue-50 text-blue-950"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span className="block text-sm font-semibold">{enterprise.name}</span>
                  {enterprise.address ? <span className="block text-xs text-slate-500">{enterprise.address}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Новая конфигурация</h2>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  aria-label="Название конфигурации"
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
                  maxLength={120}
                />
                <button
                  type="button"
                  onClick={() => selectedEnterprise && requestTransition({ kind: "create", enterprise: selectedEnterprise })}
                  disabled={!selectedEnterprise || saveStatus === "saving"}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Создать
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Конфигурации</h2>
                <span className="text-xs text-slate-400">{filteredVariants.length} шт.</span>
              </div>
              {listStatus === "loading" ? (
                <p className="p-4 text-sm text-slate-500">Загрузка конфигураций...</p>
              ) : null}
              {filteredVariants.length === 0 && listStatus !== "loading" ? (
                <p className="p-4 text-sm text-slate-500">{selectedEnterprise
                  ? "Для выбранного предприятия пока нет конфигураций. Введите название выше и нажмите «Создать», чтобы перейти к карте."
                  : "Конфигурации появятся после выбора доступного предприятия."}</p>
              ) : null}
              <div className="divide-y divide-slate-100">
                {filteredVariants.map((project) => (
                  <button
                    key={project.projectId}
                    type="button"
                    onClick={() => requestTransition({ kind: "open", projectId: project.projectId })}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
                  >
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <ShieldCheck className="h-4 w-4 text-blue-600" />
                        {project.name}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {project.projectName} · v{project.version}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-blue-700">Открыть</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Сравнение конфигураций</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <select
                  value={compareA}
                  onChange={(event) => setCompareA(event.target.value)}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Первая конфигурация</option>
                  {variants.map((project) => (
                    <option key={project.projectId} value={project.projectId}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select
                  value={compareB}
                  onChange={(event) => setCompareB(event.target.value)}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Вторая конфигурация</option>
                  {variants.map((project) => (
                    <option key={project.projectId} value={project.projectId}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleCompare()}
                  disabled={!compareA || !compareB || compareLoading}
                  className="h-10 rounded-md bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Сравнить
                </button>
              </div>
              {compareResult ? (
                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Разница стоимости</dt>
                    <dd className="mt-1 font-mono text-lg font-bold text-slate-900">
                      {compareResult.diff.costDeltaMln.toLocaleString("ru-RU")} млн ₽
                    </dd>
                  </div>
                  <div className="rounded-md bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Разница единиц</dt>
                    <dd className="mt-1 font-mono text-lg font-bold text-slate-900">{compareResult.diff.unitCountDelta}</dd>
                  </div>
                  <div className="rounded-md bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">Разница конфликтов</dt>
                    <dd className="mt-1 font-mono text-lg font-bold text-slate-900">{compareResult.diff.conflictCountDelta}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </div>
        </section>
        {recoveryScopeEnterpriseId === selectedEnterpriseId && recoveryError ? <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{recoveryError}</div> : null}
        {recoveryDraft && recoveryScopeEnterpriseId === selectedEnterpriseId ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <span>Для выбранного предприятия найден локальный черновик. Доступ к предприятию подтверждён; восстановление не отправляет его на сервер.</span>
            <button type="button" onClick={restoreLocalDraft} className="min-h-11 rounded-md border border-amber-400 bg-white px-4 font-semibold">Восстановить черновик</button>
          </div>
        ) : null}
        {pendingTransition ? (
          <div role="dialog" aria-modal="true" aria-labelledby="project-transition-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
              <h2 id="project-transition-title" className="text-lg font-bold">Есть несохранённые изменения</h2>
              <p className="mt-2 text-sm text-slate-600">Сохраните текущий проект, останьтесь здесь или явно откажитесь от локальных изменений перед продолжением.</p>
              {!useDefenseVariantsStore.getState().activeVariantId ? (
                <label className="mt-4 block text-sm font-medium">Имя нового варианта перед переходом<input aria-label="Имя нового варианта перед переходом" value={transitionSaveName} onChange={(event) => setTransitionSaveName(event.target.value)} maxLength={120} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void resolveTransition("stay")} disabled={transitionBusy} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Остаться</button>
                <button type="button" onClick={() => void resolveTransition("discard")} disabled={transitionBusy} className="min-h-11 rounded-md border border-rose-300 px-4 font-semibold text-rose-700">Отказаться и продолжить</button>
                <button type="button" onClick={() => void resolveTransition("save")} disabled={transitionBusy || (!useDefenseVariantsStore.getState().activeVariantId && !transitionSaveName.trim())} className="min-h-11 rounded-md bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">Сохранить и продолжить</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
