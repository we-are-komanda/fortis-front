"use client";

import { useRuntimeMode } from "@/shared/ui/runtime-provider";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { BulbOutlined, MoonOutlined, PrinterOutlined } from "@ant-design/icons";
import {
  criteria,
  defaultThresholds,
  echelons,
} from "@/modules/defense-calculator/infra/catalog-data";
import { projectAssetsToCalculatorAssets } from "@/modules/defense-calculator/domain/project-asset-adapter";
import { buildStructuralProfile } from "@/modules/defense-calculator/domain/structural-profile";
import { estimateConfiguration, type CostingContext } from "@/modules/defense-calculator/domain/costing";
import { computeWeightedScore, priorityForScore } from "@/modules/defense-calculator/domain/scoring";
import { fitToBudget } from "@/modules/defense-calculator/domain/budget-fit";
import { formatMln, priorityLabel } from "@/modules/defense-calculator/domain/format";
import {
  getBackendProjectCost,
  getBackendProjectReport,
  type BackendCostCalculation,
  type BackendProjectReport,
} from "@/modules/defense-calculator/infra/backend-project-api";
import { CalculatorReport } from "@/modules/defense-calculator/ui/calculator-report";
import { buildProjectReportObjectLines, type ProjectObjectReportLine } from "@/modules/defense-calculator/domain/project-report-lines";
import {
  calculateProjectTotalObjects,
  calculateProjectTotalUnits,
  calculateLayerSummaries,
  priceForPlacedObject,
  projectToCalculatorConfiguration,
} from "@/shared/lib/defense-project";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import type { DefenseProject, LayerSummary } from "@/shared/types/defense-project";
import type {
  DefenseAsset,
  PriorityColor,
} from "@/modules/defense-calculator/domain/calculator-types";

type Tab = "configure" | "structure" | "budget";

const PRIORITY_DOT: Record<PriorityColor, string> = {
  green: "bg-emerald-500",
  orange: "bg-amber-500",
  red: "bg-rose-500",
};
const PRIORITY_TEXT: Record<PriorityColor, string> = {
  green: "text-emerald-600",
  orange: "text-amber-600",
  red: "text-rose-600",
};

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`;
  return `${meters.toLocaleString("ru-RU")} м`;
}

function layerRangeLabel(summary: LayerSummary) {
  return `${formatDistance(summary.innerRadiusM)}-${formatDistance(summary.outerRadiusM)}`;
}

function calculatorAssetIdForProjectAsset(project: DefenseProject, assetId: string) {
  return project.assetLibrary.find((asset) => asset.id === assetId)?.calculatorAssetId ?? assetId;
}

export function CalculatorPage() {
  const runtimeMode = useRuntimeMode();
  const syncStatus = useDefenseProjectStore((state) => state.syncStatus);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("configure");
  const [budgetMln, setBudgetMln] = useState(9300);
  const [backendCost, setBackendCost] = useState<BackendCostCalculation | null>(null);
  const [backendReport, setBackendReport] = useState<BackendProjectReport | null>(null);
  const [backendStatus, setBackendStatus] = useState<"idle" | "loading" | "error">("idle");
  const {
    project,
    applyBudgetSelection,
    restoreProjectFromLocalStorage,
    budgetApplied,
  } = useDefenseProjectStore();

  useEffect(() => {
    if (!runtimeMode) return;
    useDefenseProjectStore.getState().setRuntimeMode(runtimeMode);
    restoreProjectFromLocalStorage();
  }, [runtimeMode, restoreProjectFromLocalStorage]);

  useEffect(() => {
    if (!runtimeMode || runtimeMode === "demo" || syncStatus === "unverified" || project.source !== "backend" || typeof project.version !== "number") {
      Promise.resolve().then(() => {
        setBackendCost(null);
        setBackendReport(null);
        setBackendStatus("idle");
      });
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(async () => {
        if (cancelled) return;
        setBackendStatus("loading");
        const [cost, report] = await Promise.all([
          getBackendProjectCost(project.projectId),
          getBackendProjectReport(project.projectId),
        ]);
        if (cancelled) return;
        setBackendCost(cost);
        setBackendReport(report);
        setBackendStatus("idle");
      })
      .catch((error) => {
        if (cancelled) return;
        setBackendCost(null);
        setBackendReport(null);
        setBackendStatus("error");
        setBackendError(error instanceof Error ? error.message : "Не удалось получить серверный расчёт.");
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeMode, syncStatus, project.projectId, project.source, project.version]);

  const calculatorAssets = useMemo(() => projectAssetsToCalculatorAssets(project.assetLibrary), [project.assetLibrary]);

  const context: CostingContext = useMemo(
    () => ({ assets: calculatorAssets, echelons, criteria, thresholds: defaultThresholds }),
    [calculatorAssets],
  );

  const scoredAssets = useMemo(
    () =>
      calculatorAssets.map((asset) => {
        const weightedScore = computeWeightedScore(asset.scores, criteria);
        return { asset, weightedScore, priority: priorityForScore(weightedScore, defaultThresholds) };
      }),
    [calculatorAssets],
  );

  const budgetResult = useMemo(
    () => fitToBudget(budgetMln, { assets: calculatorAssets, criteria, thresholds: defaultThresholds }),
    [budgetMln, calculatorAssets],
  );

  const calculatorConfig = useMemo(
    () => projectToCalculatorConfiguration(project),
    [project],
  );

  // Live map always costs honestly as unit×qty — no reference lump-sum override (item 6/8).
  const estimate = useMemo(
    () => estimateConfiguration(calculatorConfig, context),
    [calculatorConfig, context],
  );

  const objectLines = useMemo(() => buildProjectReportObjectLines(project), [project]);

  const structuralProfile = useMemo(() => buildStructuralProfile(project), [project]);

  const placedCount = calculateProjectTotalUnits(project);
  const positionsCount = calculateProjectTotalObjects(project);
  const layerSummaries = useMemo(() => calculateLayerSummaries(project), [project]);
  const isConfigurationEmpty = positionsCount === 0;
  const totalMln = backendCost?.totalMln ?? estimate.totalMln;

  if (!runtimeMode) return <div role="status">Загрузка рабочего режима…</div>;
  if (runtimeMode === "workspace" && project.source === "backend" && (syncStatus === "unverified" || backendStatus !== "idle" || !backendCost || !backendReport)) {
    return <div role={backendStatus === "error" ? "alert" : "status"} className="p-6">
      <Link href="/prototype">← Вернуться к проекту</Link>
      <p>{syncStatus === "unverified" ? "Локальный снимок не подтверждён сервером. Загрузите сохранённый проект для серверного расчёта." : backendStatus === "error" ? backendError : "Загрузка серверного расчёта…"}</p>
    </div>;
  }

  return (
    <div className="font-(family-name:--font-manrope) min-h-screen bg-[#eef3f8] text-slate-800">
      <div className="relative mx-auto max-w-7xl px-5 py-7 lg:px-8 print:hidden">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 ">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/prototype"
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500 transition hover:text-blue-700"
              >
                ← Прототип
              </Link>
              <span className="h-3 w-px bg-slate-300" />
              <Link
                href="/dashboard"
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500 transition hover:text-blue-700"
              >
                Кабинет
              </Link>
              <span className="h-3 w-px bg-slate-300" />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400 ">
                Калькулятор защиты
              </span>
            </div>
            <h1 className="mt-2 font-(family-name:--font-syne) text-3xl tracking-tight text-slate-900 lg:text-4xl ">
              Конфигурация средств защиты от&nbsp;БПЛА
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 ">
              Автоматический расчёт сметы, приоритета и покрытия эшелонов. Заменяет ручной просчёт в&nbsp;Excel.
              <span className="ml-1 text-slate-400 ">
                Целевая угроза: дрон 200&nbsp;кг (БЧ&nbsp;75&nbsp;кг), до&nbsp;200&nbsp;км/ч.
              </span>
            </p>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-2">
              <ThemeToggle />
              <button
                type="button"
                onClick={() => window.print()}
                className="flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 font-mono text-[11px] uppercase tracking-wider text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
                title="Сформировать PDF-отчёт (Сохранить как PDF)"
              >
                <PrinterOutlined /> PDF-отчёт
              </button>
            </div>
            {/* Headline total */}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-6 py-4 text-right shadow-sm">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-blue-600">
                Итого по конфигурации
              </p>
              <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-slate-900 ">
                {formatMln(totalMln)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400 ">
                {placedCount} ед. · {positionsCount} позиций
              </p>
            </div>
          </div>
        </header>

        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
          isConfigurationEmpty ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-100 bg-blue-50 text-blue-900"
        }`}>
          {isConfigurationEmpty
            ? "Конфигурация пока не собрана. Добавьте средства защиты на карте."
            : backendCost
              ? `Расчёт получен из backend-контура. Объектов в payload отчёта: ${backendReport?.placedObjects.length ?? 0}.`
              : backendStatus === "loading"
                ? "Загружается backend-расчёт по сохранённому проекту..."
                : backendStatus === "error"
                  ? "Backend-расчёт недоступен, используется локальный fallback текущей карты."
                  : "Расчёт построен на основе текущей конфигурации карты"}
        </div>

        {/* Tabs */}
        <nav className="mt-6 flex gap-1 rounded-xl border border-slate-200 bg-white/70 p-1 ">
          {(
            [
              { id: "configure", label: "Конфигуратор" },
              { id: "structure", label: "Структура" },
              { id: "budget", label: "Подбор под бюджет" },
            ] as Array<{ id: Tab; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex-1 rounded-lg px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition ${
                tab === item.id
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 "
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="mt-6">
          {tab === "configure" ? (
            <ConfigureTab
              scoredAssets={scoredAssets}
              estimate={estimate}
              project={project}
              objectLines={objectLines}
              layerSummaries={layerSummaries}
            />
          ) : null}
          {tab === "structure" ? (
            <StructureTab profile={structuralProfile} />
          ) : null}
          {tab === "budget" ? (
            <BudgetTab
              budgetMln={budgetMln}
              setBudgetMln={setBudgetMln}
              result={budgetResult}
              onApplySelection={() => applyBudgetSelection(budgetResult.picks)}
            />
          ) : null}
        </main>

        <footer className="mt-8 border-t border-slate-200 pt-4 font-mono text-[11px] text-slate-400">
          Базовые цены — из эталонного документа, расширенный каталог карты дополнен ориентировочными CAPEX-оценками.
          Оценки по 7&nbsp;критериям — предварительная экспертная оценка, редактируется.
        </footer>
      </div>

      {/* Print-only report (rendered off-screen, shown only when printing) */}
      <div className="hidden print:block">
        <CalculatorReport
          objectLines={objectLines}
          myEstimate={estimate}
          structuralProfile={structuralProfile}
          scoredAssets={scoredAssets}
          budgetResult={budgetResult}
          budgetApplied={budgetApplied}
          generatedAt={new Date()}
          layerSummaries={layerSummaries}
        />
      </div>
    </div>
  );
}

const emptySubscribe = () => () => {};
// Mount detection without setState-in-effect: server snapshot is false, client is true.
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 font-mono text-[11px] uppercase tracking-wider text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
      title="Переключить тему"
      aria-label="Переключить тему"
    >
      {isDark ? <BulbOutlined /> : <MoonOutlined />}
      {mounted ? (isDark ? "Светлая" : "Тёмная") : "Тема"}
    </button>
  );
}

// ─── Configure tab ──────────────────────────────────────────────────────────

type ScoredAsset = {
  asset: DefenseAsset;
  weightedScore: number;
  priority: PriorityColor;
};

function ConfigureTab({
  scoredAssets,
  estimate,
  project,
  layerSummaries,
  objectLines,
}: {
  scoredAssets: ScoredAsset[];
  estimate: ReturnType<typeof estimateConfiguration>;
  project: DefenseProject;
  layerSummaries: LayerSummary[];
  objectLines: ProjectObjectReportLine[];
}) {
  const objectLinesById = new Map(objectLines.map((line) => [line.objectId, line]));
  const card = "rounded-2xl border border-slate-200 bg-white ";
  const statusLabel: Record<DefenseProject["placedObjects"][number]["status"], string> = {
    planned: "План",
    active: "Активен",
    inactive: "Отключён",
    maintenance: "Сервис",
  };
  const layerSections = [...project.layers].sort((a, b) => a.order - b.order).map((layer) => {
    const summary = layerSummaries.find((item) => item.layerId === layer.id);
    const placedObjects = project.placedObjects.filter((object) => object.layerId === layer.id);
    const objectRows = placedObjects.map((object) => {
      const projectAsset = project.assetLibrary.find((asset) => asset.id === object.assetId);
      const calculatorAssetId = calculatorAssetIdForProjectAsset(project, object.assetId);
      const scoredAsset = scoredAssets.find((item) => item.asset.id === calculatorAssetId);
      return {
        object,
        projectAsset,
        asset: scoredAsset?.asset,
        weightedScore: scoredAsset?.weightedScore ?? projectAsset?.score ?? 0,
        priority: scoredAsset?.priority ?? "red",
        unitPriceMln: priceForPlacedObject(project, object),
      };
    });
    const selectedAssetScores = objectRows.map(({ weightedScore }) => weightedScore);
    const coveragePct =
      selectedAssetScores.length > 0
        ? selectedAssetScores.reduce((acc, value) => acc + value, 0) / selectedAssetScores.length / 100
        : 0;
    return {
      layer,
      objectRows,
      totalMln: summary?.totalMln ?? 0,
      coveragePct,
      isEmpty: (summary?.objectCount ?? 0) === 0,
      conflictCount: summary?.conflictCount ?? 0,
      rangeLabel: summary ? layerRangeLabel(summary) : "",
    };
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        {layerSections.map(({ layer, objectRows, totalMln, coveragePct, conflictCount, rangeLabel }) => {
          return (
            <section key={layer.id} className={`${card} p-4`}>
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 pb-3 ">
                <div className="flex items-baseline gap-2.5">
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700">
                    {layer.code}
                  </span>
                  <h3 className="font-(family-name:--font-syne) text-base font-semibold text-slate-900 ">
                    {layer.name}
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400 ">{rangeLabel}</span>
                  {conflictCount > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] text-amber-700">
                      конфликтов {conflictCount}
                    </span>
                  ) : null}
                </div>
                <div className="text-right">
                  <span className="font-mono text-sm font-semibold tabular-nums text-slate-700 ">
                    {formatMln(totalMln)}
                  </span>
                  <CoverageBar pct={coveragePct} />
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                {objectRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    В этом эшелоне пока нет размещённых средств. Добавьте средство с карты на этот эшелон.
                  </div>
                ) : null}

                {objectRows.map(({ object, projectAsset, asset, weightedScore, priority, unitPriceMln }) => {
                  const lineTotal = unitPriceMln * object.quantity;
                  const objectLine = objectLinesById.get(object.id);
                  return (
                    <div
                      key={object.id}
                      className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                        object.hasGeometryConflict || object.hasCoverageConflict || object.hasTerrainConflict
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} />
                          <p className="truncate text-sm font-medium text-slate-800">
                            {object.name ?? projectAsset?.name ?? asset?.name ?? object.assetId}
                          </p>
                          <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                            x{object.quantity}
                          </span>
                          {object.hasGeometryConflict || object.hasCoverageConflict || object.hasTerrainConflict ? (
                            <span className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
                              конфликт
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400 ">
                          {unitPriceMln > 0 ? `${formatMln(unitPriceMln)}/${asset?.unit ?? projectAsset?.unitLabel ?? "ед."}` : "без CAPEX"}
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className={PRIORITY_TEXT[priority]}>балл {weightedScore.toFixed(0)}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="text-slate-400">{priorityLabel[priority]}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="text-slate-400">{statusLabel[object.status]}</span>
                        </p>
                        {objectLine?.isCompoundPost ? (
                          <>
                            {objectLine.compositionSummary ? (
                              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{objectLine.compositionSummary}</p>
                            ) : null}
                            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                              {objectLine.weaponSummary ?? "—"}
                              {objectLine.azimuthSectorSummary ? <span> · {objectLine.azimuthSectorSummary}</span> : null}
                            </p>
                          </>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-24 text-right font-mono text-xs tabular-nums text-slate-600 sm:block">
                          {formatMln(lineTotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-slate-200 bg-white p-4  ">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">Смета по эшелонам карты</p>
          <div className="mt-3 space-y-1">
            {layerSections.map(({ layer, totalMln, isEmpty, conflictCount }) => (
              <div key={layer.id} className="flex items-center justify-between gap-2 text-sm">
                <span className={`truncate ${isEmpty ? "text-slate-400" : "text-slate-600 "}`}>
                  {layer.code} · {layer.name}
                  {conflictCount > 0 ? <span className="ml-1 text-amber-600">!</span> : null}
                </span>
                <span
                  className={`font-mono tabular-nums ${isEmpty ? "text-slate-300" : "text-slate-700 "}`}
                >
                  {isEmpty ? "—" : formatMln(totalMln)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 ">
            <span className="font-mono text-xs uppercase tracking-wider text-blue-600">Итого</span>
            <span className="font-mono text-xl font-bold tabular-nums text-slate-900 ">
              {formatMln(estimate.totalMln)}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  return (
    <div className="mt-1 flex items-center justify-end gap-1.5">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-linear-to-r from-blue-500 to-emerald-400"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-slate-400 ">
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

// ─── Structure tab (item 8: structural profile, cost optional) ────────────────

function StructureTab({ profile }: { profile: ReturnType<typeof buildStructuralProfile> }) {
  const metrics: Array<{ label: string; value: number }> = [
    { label: "Объекты (позиции)", value: profile.objectCount },
    { label: "Единицы", value: profile.unitCount },
    { label: "Эшелоны (занятые)", value: profile.echelonCount },
    { label: "Категории средств", value: profile.categoryCount },
    { label: "Конфликты", value: profile.conflictCount },
    { label: "Позиции с покрытием", value: profile.coveredObjectCount },
  ];

  if (profile.objectCount === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center text-sm text-amber-800">
        Конфигурация пуста — структурный профиль появится после размещения средств на карте.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-mono text-3xl font-bold tabular-nums text-slate-900">{metric.value}</p>
            <p className="mt-1 text-xs text-slate-500">{metric.label}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-160 border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-wider text-slate-500">Эшелон</th>
              <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-slate-500">Объекты</th>
              <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-slate-500">Единицы</th>
              <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-slate-500">Категории</th>
              <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-slate-500">С покрытием</th>
              <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-slate-500">Конфликты</th>
            </tr>
          </thead>
          <tbody>
            {profile.byEchelon.map((layer) => (
              <tr key={layer.layerId} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-600">
                  <span className="font-mono text-[11px] font-bold text-blue-700">{layer.layerCode}</span>
                  <span className="ml-2">{layer.layerName}</span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">{layer.objectCount}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">{layer.unitCount}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">{layer.categoryCount}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">{layer.coveredObjectCount}</td>
                <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${layer.conflictCount > 0 ? "text-amber-600" : "text-slate-300"}`}>
                  {layer.conflictCount > 0 ? layer.conflictCount : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[11px] text-slate-400">
        Стоимость (опционально): {formatMln(profile.totalMln)}
      </p>
    </div>
  );
}

// ─── Budget tab ─────────────────────────────────────────────────────────────

function BudgetTab({
  budgetMln,
  setBudgetMln,
  result,
  onApplySelection,
}: {
  budgetMln: number;
  setBudgetMln: (v: number) => void;
  result: ReturnType<typeof fitToBudget>;
  onApplySelection: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-slate-200 bg-white p-5  ">
          <label className="font-mono text-[11px] uppercase tracking-wider text-slate-500">Бюджет, млн руб</label>
          <input
            type="number"
            min={0}
            step={100}
            value={budgetMln}
            onChange={(e) => setBudgetMln(Math.max(0, Number(e.target.value)))}
            className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-2xl font-bold tabular-nums text-slate-900 outline-none focus:border-blue-500   "
          />
          <p className="mt-1 font-mono text-xs text-slate-400 ">= {formatMln(budgetMln)}</p>

          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm ">
            <div className="flex justify-between">
              <span className="text-slate-500 ">Распределено</span>
              <span className="font-mono tabular-nums text-emerald-600">{formatMln(result.spentMln)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 ">Остаток</span>
              <span className="font-mono tabular-nums text-slate-700 ">{formatMln(result.remainingMln)}</span>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-400 ">
            Порядок закупки: сначала первоочередные (зелёные) по убыванию балла, затем средний и последний
            приоритет. Жадный отбор в&nbsp;рамках бюджета.
          </p>
          <button
            type="button"
            onClick={onApplySelection}
            className="mt-4 h-10 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Применить подбор к карте
          </button>
        </div>
      </aside>

      <div className="space-y-1.5">
        {result.picks.map((pick, index) => (
          <div
            key={pick.assetId}
            className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-4 py-3 transition ${
              pick.included
                ? "border-slate-200 bg-white"
                : "border-dashed border-slate-200 bg-transparent opacity-50 "
            }`}
          >
            <span className="font-mono text-sm tabular-nums text-slate-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[pick.priority]}`} />
                <p className="truncate text-sm font-medium text-slate-800">{pick.assetName}</p>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400 ">
                <span className={PRIORITY_TEXT[pick.priority]}>балл {pick.weightedScore.toFixed(0)}</span>
                <span className="mx-1.5 text-slate-300">·</span>
                {pick.unitPriceMln > 0 ? formatMln(pick.unitPriceMln) : "без CAPEX"}
              </p>
            </div>
            <div className="text-right">
              {pick.included ? (
                <>
                  <p className="font-mono text-xs tabular-nums text-slate-500 ">Σ {formatMln(pick.cumulativeMln)}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-600">включено</p>
                </>
              ) : (
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">не вошло</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
