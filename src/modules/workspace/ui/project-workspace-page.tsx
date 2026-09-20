"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { compareBackendProjects, type BackendProjectCompare } from "@/modules/defense-calculator/infra/backend-project-api";
import { fetchEnterprises } from "@/modules/drone-defense/infra/enterprise-api";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { createWorkspaceDefenseProject, setProjectBaseObject } from "@/shared/lib/defense-project";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import type { ProtectedObjectOption } from "@/shared/types/defense-project";

export function ProjectWorkspacePage() {
  const router = useRouter();
  const [enterprises, setEnterprises] = useState<ProtectedObjectOption[]>([]);
  const [enterpriseStatus, setEnterpriseStatus] = useState<"idle" | "loading" | "error">("loading");
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("Новая конфигурация");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareResult, setCompareResult] = useState<BackendProjectCompare | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const { variants, listStatus, saveStatus, error, fetchVariants, loadVariant, saveAsNewVariant } =
    useDefenseVariantsStore();
  const replaceProject = useDefenseProjectStore((state) => state.replaceProject);

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
        setSelectedEnterpriseId((current) => current ?? items[0]?.enterpriseId ?? null);
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
  }, [fetchVariants]);

  const selectedEnterprise = useMemo(
    () => enterprises.find((item) => item.enterpriseId === selectedEnterpriseId) ?? enterprises[0],
    [enterprises, selectedEnterpriseId],
  );

  const filteredVariants = useMemo(() => {
    if (!selectedEnterpriseId) return variants;
    const scoped = variants.filter((item) => item.enterpriseId === selectedEnterpriseId);
    return scoped;
  }, [selectedEnterpriseId, variants]);

  async function handleCreateProject() {
    if (!selectedEnterprise) return;
    setWorkspaceError(null);
    const baseProject = setProjectBaseObject(createWorkspaceDefenseProject(), selectedEnterprise);
    replaceProject({
      ...baseProject,
      enterpriseId: selectedEnterprise.enterpriseId,
      projectName: newProjectName.trim() || "Новая конфигурация",
      source: "custom",
    });
    await saveAsNewVariant(newProjectName.trim() || "Новая конфигурация");
    const state = useDefenseVariantsStore.getState();
    if (state.error) {
      setWorkspaceError(state.error);
      return;
    }
    router.push(`/prototype?projectId=${encodeURIComponent(state.activeVariantId ?? "")}`);
  }

  async function handleOpenProject(projectId: string) {
    setWorkspaceError(null);
    await loadVariant(projectId);
    const state = useDefenseVariantsStore.getState();
    if (state.error) {
      setWorkspaceError(state.error);
      return;
    }
    router.push(`/prototype?projectId=${encodeURIComponent(state.activeVariantId ?? "")}`);
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
              void fetchVariants();
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
                <p className="text-sm text-amber-700">Не удалось загрузить предприятия.</p>
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
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
                  maxLength={120}
                />
                <button
                  type="button"
                  onClick={() => void handleCreateProject()}
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
                <p className="p-4 text-sm text-slate-500">Для выбранного предприятия пока нет конфигураций.</p>
              ) : null}
              <div className="divide-y divide-slate-100">
                {filteredVariants.map((project) => (
                  <button
                    key={project.projectId}
                    type="button"
                    onClick={() => void handleOpenProject(project.projectId)}
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
      </div>
    </main>
  );
}
