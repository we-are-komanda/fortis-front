"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { ConfigurationComparison } from "@/modules/defense-calculator/ui/configuration-comparison";
import { fetchEnterprisePage, getEnterprise } from "@/modules/drone-defense/infra/enterprise-api";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { createWorkspaceDefenseProject, setProjectBaseObject } from "@/shared/lib/defense-project";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { businessContent } from "@/shared/lib/project-save-state";
import { readProjectDraft, type ProjectDraft } from "@/shared/lib/project-draft-storage";
import type { ProtectedObjectOption } from "@/shared/types/defense-project";

type PendingTransition = { kind: "create"; enterprise: ProtectedObjectOption } | { kind: "open"; projectId: string } | { kind: "enterprise"; enterpriseId: string };
const pageSize = 50;

export function ProjectWorkspacePage() {
  const router = useRouter();
  const [enterprises, setEnterprises] = useState<ProtectedObjectOption[]>([]);
  const [enterpriseStatus, setEnterpriseStatus] = useState<"idle" | "loading" | "error" | "forbidden">("loading");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [newProjectName, setNewProjectName] = useState("Новая конфигурация");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);
  const [transitionSaveName, setTransitionSaveName] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<ProjectDraft | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryScopeEnterpriseId, setRecoveryScopeEnterpriseId] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const { variants, listStatus, listQuery, totalItems, listError, listForbidden, saveStatus, loadStatus, error, fetchVariants, loadVariant, saveAsNewVariant, overwriteActiveVariant } =
    useDefenseVariantsStore();
  const identityId = useDefenseProjectStore((state) => state.identityId);
  const localDraftsEnabled = useDefenseProjectStore((state) => state.localDraftsEnabled);
  const projectSyncStatus = useDefenseProjectStore((state) => state.syncStatus);
  const saveAttempt = useDefenseProjectStore((state) => state.saveAttempt);
  const restoreVerifiedDraft = useDefenseProjectStore((state) => state.restoreVerifiedDraft);

  useEffect(() => {
    let cancelled = false;
    const selectionKey = identityId ? `fortis:workspace:enterprise:${encodeURIComponent(identityId)}` : null;
    Promise.resolve()
      .then(async () => {
        if (cancelled) return [];
        setEnterpriseStatus("loading");
        setEnterprises([]);
        setPageOffset(0);
        void fetchVariants(null);
        const items: ProtectedObjectOption[] = [];
        let total = 0;
        do {
          const page = await fetchEnterprisePage({ limit: 100, offset: items.length });
          if (cancelled) return [];
          if (!page.items.length && items.length < page.totalItems) throw new Error("Неполный список предприятий");
          items.push(...page.items);
          total = page.totalItems;
        } while (items.length < total);
        return items;
      })
      .then((items) => {
        if (cancelled) return;
        let remembered: string | null = null;
        try { remembered = selectionKey ? sessionStorage.getItem(selectionKey) : null; } catch { /* Selection persistence is optional. */ }
        setEnterprises(items);
        setSelectedEnterpriseId((current) => {
          const selected = items.some((item) => item.enterpriseId === current) ? current
            : items.some((item) => item.enterpriseId === remembered) ? remembered : items[0]?.enterpriseId ?? null;
          return selected;
        });
        setEnterpriseStatus("idle");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setEnterprises([]);
        setEnterpriseStatus((cause as { status?: number })?.status === 403 ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchVariants, identityId, refreshVersion]);

  useEffect(() => {
    if (enterpriseStatus !== "idle" || !selectedEnterpriseId || !enterprises.some((item) => item.enterpriseId === selectedEnterpriseId)) return;
    if (identityId) {
      try { sessionStorage.setItem(`fortis:workspace:enterprise:${encodeURIComponent(identityId)}`, selectedEnterpriseId); } catch { /* Selection persistence is optional. */ }
    }
    void fetchVariants({ enterpriseId: selectedEnterpriseId, limit: pageSize, offset: pageOffset });
  }, [enterpriseStatus, enterprises, fetchVariants, identityId, pageOffset, selectedEnterpriseId]);

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
    if (!selectedEnterprise || listQuery?.enterpriseId !== selectedEnterpriseId || listQuery?.offset !== pageOffset) return [];
    const scoped = variants.filter((item) => item.enterpriseId === selectedEnterpriseId);
    return scoped;
  }, [selectedEnterprise, selectedEnterpriseId, listQuery, pageOffset, variants]);

  const validName = [...newProjectName.trim()].length >= 1 && [...newProjectName.trim()].length <= 120;
  const currentList = Boolean(selectedEnterprise && listQuery?.enterpriseId === selectedEnterpriseId && listQuery.offset === pageOffset);

  function changePage(offset: number) {
    setPageOffset(offset);
  }

  async function createProject(enterprise: ProtectedObjectOption) {
    const name = newProjectName.trim();
    if (!name || [...name].length > 120 || saveStatus === "saving") return;
    setWorkspaceError(null);
    const baseProject = setProjectBaseObject(createWorkspaceDefenseProject(), enterprise);
    const summary = await saveAsNewVariant(name, {
      ...baseProject,
      enterpriseId: enterprise.enterpriseId,
      projectName: name,
      source: "custom",
    });
    const state = useDefenseVariantsStore.getState();
    if (!summary || useDefenseProjectStore.getState().project.projectId !== summary.projectId || useDefenseProjectStore.getState().syncStatus !== "saved") {
      setWorkspaceError(state.error);
      return;
    }
    router.push(`/prototype?projectId=${encodeURIComponent(summary.projectId)}`);
  }

  async function finishOpenProject(projectId: string) {
    setWorkspaceError(null);
    const loaded = await loadVariant(projectId);
    const state = useDefenseVariantsStore.getState();
    if (!loaded || useDefenseProjectStore.getState().project.projectId !== projectId || state.loadStatus !== "idle") {
      setWorkspaceError(state.error);
      return;
    }
    router.push(`/prototype?projectId=${encodeURIComponent(state.activeVariantId ?? "")}`);
  }

  function finishEnterpriseSwitch(enterpriseId: string) {
    setRecoveryDraft(null);
    setRecoveryError(null);
    setWorkspaceError(null);
    setPageOffset(0);
    setSelectedEnterpriseId(enterpriseId);
  }

  function requestTransition(target: PendingTransition) {
    if (target.kind === "enterprise" && target.enterpriseId === selectedEnterpriseId) return;
    const current = useDefenseProjectStore.getState();
    if (target.kind === "open" && current.project.projectId === target.projectId && useDefenseVariantsStore.getState().activeVariantId === target.projectId && !current.accessError && current.syncStatus === "dirty") {
      router.push(`/prototype?projectId=${encodeURIComponent(target.projectId)}`);
      return;
    }
    const project = useDefenseProjectStore.getState().project;
    const hasUnsaved = projectSyncStatus === "dirty" || saveAttempt !== null || saveStatus === "saving" || (projectSyncStatus === "unverified" && Boolean(project.enterpriseId));
    if (!hasUnsaved) {
      if (target.kind === "create") void createProject(target.enterprise);
      else if (target.kind === "open") void finishOpenProject(target.projectId);
      else finishEnterpriseSwitch(target.enterpriseId);
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
    if (useDefenseVariantsStore.getState().saveStatus === "saving") return;
    setTransitionBusy(true);
    try {
      if (choice === "save") {
        const attempt = useDefenseProjectStore.getState().saveAttempt;
        const activeId = useDefenseVariantsStore.getState().activeVariantId;
        if (attempt?.kind === "create") await saveAsNewVariant(attempt.name);
        else if (activeId) await overwriteActiveVariant();
        else if (transitionSaveName.trim()) await saveAsNewVariant(transitionSaveName.trim());
        const current = useDefenseProjectStore.getState();
        const variantsState = useDefenseVariantsStore.getState();
        if (current.syncStatus !== "saved" || current.saveAttempt || current.accessError || variantsState.saveStatus !== "idle") {
          setWorkspaceError(variantsState.error ?? "Сохранение не завершено; переход отменён, черновик сохранён.");
          return;
        }
      } else if (!useDefenseProjectStore.getState().discardLocalChanges()) {
        setWorkspaceError(useDefenseProjectStore.getState().draftStorageError);
        return;
      }
      setPendingTransition(null);
      if (target.kind === "create") await createProject(target.enterprise);
      else if (target.kind === "open") await finishOpenProject(target.projectId);
      else finishEnterpriseSwitch(target.enterpriseId);
    } finally {
      setTransitionBusy(false);
    }
  }

  async function restoreLocalDraft() {
    const record = recoveryDraft;
    if (!record || !identityId || recoveryBusy || saveStatus === "saving") return;
    const current = useDefenseProjectStore.getState();
    if (current.identityId !== record.userId || selectedEnterpriseId !== record.enterpriseId) return;
    if ((current.syncStatus === "dirty" || current.project.projectId !== "current") && !window.confirm("Заменить текущий проект восстановленным локальным черновиком? Сервер не изменится до явного сохранения.")) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      const enterprise = await getEnterprise(record.enterpriseId);
      const latest = useDefenseProjectStore.getState();
      if (enterprise.enterpriseId !== record.enterpriseId || latest.identityId !== record.userId || latest.project !== current.project) {
        setRecoveryError("Текущий проект или доступ изменился. Повторите восстановление явно.");
        return;
      }
      restoreVerifiedDraft(record);
      if (useDefenseProjectStore.getState().project !== record.draft) {
        setRecoveryError("Восстановление недоступно в текущем контексте. Откройте проект заново.");
        return;
      }
      useDefenseVariantsStore.setState({ activeVariantId: null, activeVariantName: null, conflictState: null });
      setRecoveryDraft(null);
    } catch {
      setRecoveryError("Доступ к предприятию не подтверждён. Локальный черновик не восстановлен; повторите после восстановления доступа.");
    } finally {
      setRecoveryBusy(false);
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
            disabled={saveStatus === "saving" || recoveryBusy}
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
              {enterpriseStatus === "forbidden" ? <p role="alert" className="text-sm text-amber-700">Доступ к предприятиям запрещён. После восстановления доступа нажмите «Обновить».</p> : null}
              {enterpriseStatus === "idle" && enterprises.length === 0 ? (
                <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Нет доступных предприятий.</p>
                  <p className="mt-2">Для создания конфигурации сначала добавьте предприятие в общий каталог. Затем нажмите «Обновить».</p>
                </div>
              ) : null}
              {enterprises.map((enterprise) => (
                <button
                  key={enterprise.enterpriseId}
                  type="button"
                  onClick={() => requestTransition({ kind: "enterprise", enterpriseId: enterprise.enterpriseId })}
                  disabled={recoveryBusy || saveStatus === "saving" || loadStatus === "loading"}
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
                  disabled={saveStatus === "saving"}
                  aria-invalid={!validName}
                  aria-describedby={!validName ? "workspace-name-error" : undefined}
                  className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => selectedEnterprise && requestTransition({ kind: "create", enterprise: selectedEnterprise })}
                  disabled={!selectedEnterprise || !validName || saveStatus === "saving" || loadStatus === "loading" || recoveryBusy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Создать
                </button>
              </div>
              {!validName ? <p id="workspace-name-error" role="alert" className="mt-2 text-sm text-amber-700">Название должно содержать от 1 до 120 символов после удаления пробелов по краям.</p> : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Конфигурации</h2>
                <span className="text-xs text-slate-400">Всего: {currentList && listStatus === "idle" ? totalItems : "—"}</span>
              </div>
              {selectedEnterprise && (!currentList || listStatus === "loading") ? (
                <p className="p-4 text-sm text-slate-500">Загрузка конфигураций...</p>
              ) : null}
              {currentList && listStatus === "error" ? <p role="alert" className="p-4 text-sm text-amber-700">{listForbidden ? "Доступ к конфигурациям запрещён." : "Не удалось загрузить конфигурации."} {listError} Нажмите «Обновить», чтобы повторить попытку.</p> : null}
              {((currentList && listStatus === "idle" && filteredVariants.length === 0) || enterpriseStatus === "idle" && !selectedEnterprise) ? (
                <p className="p-4 text-sm text-slate-500">{selectedEnterprise
                  ? "Для выбранного предприятия пока нет конфигураций. Введите название выше и нажмите «Создать», чтобы перейти к карте."
                  : "Конфигурации появятся после выбора доступного предприятия."}</p>
              ) : null}
              <div className="divide-y divide-slate-100">
                {filteredVariants.map((project) => (
                  <button
                    key={project.projectId}
                    type="button"
                    disabled={saveStatus === "saving" || loadStatus === "loading" || recoveryBusy}
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
              {currentList && totalItems > pageSize ? (
                <nav aria-label="Страницы конфигураций" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
                  <span>{pageOffset + 1}–{Math.min(pageOffset + pageSize, totalItems)} из {totalItems}</span>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => changePage(Math.max(0, pageOffset - pageSize))} disabled={pageOffset === 0 || listStatus === "loading"} className="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50">Предыдущая страница</button>
                    <button type="button" onClick={() => changePage(pageOffset + pageSize)} disabled={pageOffset + pageSize >= totalItems || listStatus === "loading"} className="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50">Следующая страница</button>
                  </div>
                </nav>
              ) : null}
            </div>

            <ConfigurationComparison enterpriseId={selectedEnterprise?.enterpriseId ?? ""} projects={filteredVariants} />
          </div>
        </section>
        {recoveryScopeEnterpriseId === selectedEnterpriseId && recoveryError ? <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{recoveryError}</div> : null}
        {recoveryDraft && recoveryScopeEnterpriseId === selectedEnterpriseId ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <span>Для выбранного предприятия найден локальный черновик. Доступ к предприятию подтверждён; восстановление не отправляет его на сервер.</span>
            <button type="button" onClick={() => void restoreLocalDraft()} disabled={recoveryBusy || saveStatus === "saving"} className="min-h-11 rounded-md border border-amber-400 bg-white px-4 font-semibold">Восстановить черновик</button>
          </div>
        ) : null}
        {pendingTransition ? (
          <div role="dialog" aria-modal="true" aria-labelledby="project-transition-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
              <h2 id="project-transition-title" className="text-lg font-bold">Есть несохранённые изменения</h2>
              <p className="mt-2 text-sm text-slate-600">Сохраните текущий проект, останьтесь здесь или явно откажитесь от локальных изменений перед продолжением.</p>
              {!useDefenseVariantsStore.getState().activeVariantId ? (
                <label className="mt-4 block text-sm font-medium">Имя нового варианта перед переходом<input aria-label="Имя нового варианта перед переходом" value={transitionSaveName} onChange={(event) => setTransitionSaveName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" /></label>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => void resolveTransition("stay")} disabled={transitionBusy} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Остаться</button>
                <button type="button" onClick={() => void resolveTransition("discard")} disabled={transitionBusy || saveStatus === "saving"} className="min-h-11 rounded-md border border-rose-300 px-4 font-semibold text-rose-700">Отказаться и продолжить</button>
                <button type="button" onClick={() => void resolveTransition("save")} disabled={transitionBusy || saveStatus === "saving" || (!useDefenseVariantsStore.getState().activeVariantId && !transitionSaveName.trim())} className="min-h-11 rounded-md bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">Сохранить и продолжить</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
