"use client";

import { useEffect } from "react";
import Link from "next/link";
import { calculationLimitation } from "@/shared/config/product-capabilities";
import { formatMinorRub } from "@/shared/lib/cost-projection";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import type { CostProjection, DraftCostProjection } from "@/shared/types/finance";
import { useRuntimeMode } from "@/shared/ui/runtime-provider";
import { useProjectCost } from "@/modules/defense-calculator/domain/use-project-cost";

const priceSource = { instance_override: "Цена экземпляра", components: "Состав комплекта", template: "Цена карточки", unknown: "Цена не указана" };
const dataQuality = { confirmed: "Источник подтверждён пользователем", estimated: "Оценка", demo: "Демонстрационные данные" };

export function CostProjectionView({ projection }: { projection: CostProjection | DraftCostProjection }) {
  const draft = "kind" in projection;
  return <section className="space-y-6" aria-label="Смета размещённых объектов">
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-slate-900">
      <p className="text-sm text-blue-800">{draft ? "Черновой расчёт — изменения не сохранены" : `Сохранённая версия ${projection.identity.projectVersion}`}</p>
      <h2 className="mt-2 break-words text-3xl font-semibold tabular-nums">{formatMinorRub(projection.totalMinor)}</h2>
      {!projection.isComplete && <p className="mt-2">Известная часть: {formatMinorRub(projection.knownSubtotalMinor)}. Укажите цены для {projection.unknownPriceObjectIds.length} позиций.</p>}
      <p className="mt-2 text-sm">{projection.lines.length} позиций · {projection.lines.reduce((sum, line) => sum + line.quantity, 0)} единиц</p>
      <p className="mt-3 text-sm">По указанным ценам; налоги, монтаж и эксплуатация учтены только при явном включении в строки.</p>
      {!draft && <p className="mt-2 break-all text-xs text-slate-600">Проект {projection.identity.projectId} · расчёт {projection.identity.calculationVersion}</p>}
    </div>
    {projection.lines.length === 0 && <p className="rounded-xl border border-slate-200 p-5">В проекте пока нет размещённых объектов. Добавьте их на карте.</p>}
    {projection.byLayer.map(group => <section key={group.id} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="break-words text-lg font-semibold">{group.name}</h3>
        <div className="text-right tabular-nums"><p>{formatMinorRub(group.totalMinor)}</p>{group.totalMinor === null && <p className="text-sm text-slate-600">Известно: {formatMinorRub(group.knownSubtotalMinor)}</p>}</div>
      </div>
      <div className="mt-4 space-y-3">
        {projection.lines.filter(line => line.layerId === group.id).map(line => <article key={line.objectId} className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0"><h4 className="break-words font-medium">{line.name}</h4><p className="mt-1 text-sm text-slate-600">{line.quantity} × {line.unitPriceMinor === null ? "Цена не указана" : formatMinorRub(line.unitPriceMinor)} · {priceSource[line.priceSource]}</p>
            <p className="mt-1 text-sm text-slate-600">{line.provenance ? dataQuality[line.provenance.quality] : "Источник не указан"}</p>
            {line.provenance?.sourceLabel && <p className="break-words text-sm text-slate-600">{line.provenance.sourceLabel}</p>}
          </div><p className="tabular-nums sm:text-right">{line.lineTotalMinor === null ? "Стоимость неизвестна" : formatMinorRub(line.lineTotalMinor)}</p>
        </article>)}
      </div>
    </section>)}
    {projection.byType.length > 0 && <section className="rounded-xl border border-slate-200 p-4"><h3 className="text-lg font-semibold">По типам средств</h3><dl className="mt-3 space-y-2">{projection.byType.map(group => <div key={group.id} className="flex flex-wrap justify-between gap-2"><dt className="break-words">{group.name} · {group.objectCount} позиций</dt><dd className="tabular-nums">{formatMinorRub(group.totalMinor)}</dd></div>)}</dl></section>}
    {projection.warnings.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label="Замечания к исходным данным"><h3 className="font-semibold">Замечания к исходным данным</h3><ul className="mt-2 list-disc space-y-1 pl-5">{projection.warnings.map((issue,index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></section>}
  </section>;
}

export function CalculatorPage() {
  const runtimeMode = useRuntimeMode();
  const { project, syncStatus, restoreProjectFromLocalStorage } = useDefenseProjectStore();
  const {cost,error,blocked,saved,retry} = useProjectCost(project,syncStatus,runtimeMode);

  useEffect(() => {
    if (!runtimeMode) return;
    useDefenseProjectStore.getState().setRuntimeMode(runtimeMode);
    restoreProjectFromLocalStorage();
  }, [runtimeMode, restoreProjectFromLocalStorage]);

  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:py-10">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 border-b border-slate-200 pb-5">
        <nav className="flex flex-wrap gap-4 text-sm"><Link className="inline-flex min-h-11 items-center text-blue-700" href={`/prototype${project.source === "backend" ? `?projectId=${encodeURIComponent(project.projectId)}` : ""}`}>← Карта</Link><Link className="inline-flex min-h-11 items-center text-blue-700" href="/workspace">Кабинет</Link></nav>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Стоимость конфигурации</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{calculationLimitation}</p>
      </header>
      {!runtimeMode || blocked ? <p role="status">Ожидается проверка доступа к проекту.</p> : error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4"><p>{error}</p>{saved && <button type="button" className="mt-3 min-h-11 rounded-lg border border-slate-300 bg-white px-4" onClick={retry}>Повторить</button>}</div> : cost ? <CostProjectionView projection={cost} /> : <p role="status">Загружается расчёт сохранённой версии…</p>}
    </div>
  </main>;
}
