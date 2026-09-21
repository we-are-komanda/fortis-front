"use client";
import { useState } from "react";
import { Modal } from "antd";
import type { CompareResult, CostGroup, FinancialLine } from "@/shared/types/finance";
import type { VariantSummary } from "@/shared/types/defense-project";
import { formatMinorRub } from "@/shared/lib/cost-projection";
import { formatBudgetMinor } from "@/shared/lib/budget-projection";
import { useSessionStore } from "@/shared/lib/session-state";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { pairComparisonItems, useConfigurationComparison } from "../domain/configuration-comparison";

const sourceNames = { instance_override: "Цена экземпляра", components: "Состав комплекта", template: "Цена карточки", unknown: "Цена не указана" };
const qualityNames = { confirmed: "Источник подтверждён пользователем", estimated: "Оценка", demo: "Демонстрационные данные" };
function GroupValue({ group }: { group?: CostGroup }) {
  return group ? <><p>{group.name}</p><p>{formatMinorRub(group.totalMinor)}</p><p className="text-sm text-slate-600">Известно: {formatMinorRub(group.knownSubtotalMinor)} · {group.objectCount} позиций · {group.unitCount} единиц</p></> : <p>Нет в этой версии</p>;
}
function LineValue({ line }: { line?: FinancialLine }) {
  if (!line) return <p>Нет в этой версии</p>;
  const provenance = line.provenance;
  return <><p className="font-medium">{line.name}</p><p>{line.quantity} × {line.unitPriceMinor === null ? "Цена не указана" : formatMinorRub(line.unitPriceMinor)} = {formatMinorRub(line.lineTotalMinor)}</p>
    <p className="text-sm">{sourceNames[line.priceSource]}</p><p className="break-all text-xs text-slate-500">Объект: {line.objectId} · Средство: {line.assetId} · Слой: {line.layerId}</p>
    <p className="text-sm">{provenance ? `${provenance.sourceLabel} · ${qualityNames[provenance.quality]}` : "Источник не указан"}</p>
    {provenance && <p className="text-sm text-slate-600">Дата источника: {provenance.sourceDate ?? "не указана"} · Записано: {provenance.recordedAt} · Ревизия источника: {provenance.revision}</p>}</>;
}
export function ComparisonResultView({ result }: { result: CompareResult }) {
  return <section aria-label="Результат сравнения" className="mt-5 space-y-5">
    <p className="rounded-md bg-blue-50 p-3 font-medium">Разница B − A: {result.differenceMinor === null ? "Не вычислена — итог неполный" : `${BigInt(result.differenceMinor) > BigInt(0) ? "+" : ""}${formatBudgetMinor(result.differenceMinor)}`} · {result.differencePercent === null ? "Процент: Не рассчитывается" : `${!result.differencePercent.startsWith("-") && result.differencePercent !== "0.00" ? "+" : ""}${result.differencePercent.replace(".",",")}%`}</p>
    <div className="grid gap-4 md:grid-cols-2">{(["a","b"] as const).map(key => { const side = result[key]; return <section key={key} aria-label={`Вариант ${key.toUpperCase()}`} className="min-w-0 rounded-md border border-slate-200 p-4">
      <h3 className="break-words text-lg font-semibold">{key.toUpperCase()}: {side.name} · версия {side.identity.projectVersion}</h3><p className="text-sm">Сохранено: <time dateTime={side.updatedAt}>{side.updatedAt}</time></p>
      <p className="mt-2 text-xl font-semibold">Итог: {formatMinorRub(side.cost.totalMinor)}</p><p>Известная часть: {formatMinorRub(side.cost.knownSubtotalMinor)}</p><p>{side.cost.isComplete ? "Итог полный" : "Итог неполный: есть неизвестные цены"}</p>
      <p>{side.cost.lines.length} позиций · {side.cost.lines.reduce((sum,line)=>sum+line.quantity,0)} единиц</p><p>Бюджет: {side.budget.config.budgetMode === "unlimited" ? "без ограничения" : formatMinorRub(side.budget.config.budgetLimitMinor)}</p><p>Остаток: {side.budget.config.budgetMode === "unlimited" ? "не ограничен" : formatBudgetMinor(side.budget.remainingMinor)}</p>
    </section>; })}</div>
    {(["byLayer","byType"] as const).map(grouping => <section key={grouping} aria-label={grouping === "byLayer" ? "Сравнение по слоям" : "Сравнение по типам"}>
      <h3 className="font-semibold">{grouping === "byLayer" ? "По слоям" : "По типам средств"}</h3>
      {pairComparisonItems(result.a.cost[grouping],result.b.cost[grouping],item=>item.id).map(row=><div key={row.id} className="mt-2 rounded-md border border-slate-200 p-3"><p className="break-all text-xs text-slate-600">ID: {row.id}{!row.a || !row.b ? " · Только в одной версии; сопоставления по имени нет" : ""}</p><div className="mt-2 grid gap-3 sm:grid-cols-2"><div aria-label="A"><p className="text-xs font-semibold">A</p><GroupValue group={row.a}/></div><div aria-label="B"><p className="text-xs font-semibold">B</p><GroupValue group={row.b}/></div></div></div>)}
    </section>)}
    <section aria-label="Состав и цены"><h3 className="font-semibold">Состав, количества, цены и источники</h3>{pairComparisonItems(result.a.cost.lines,result.b.cost.lines,line=>JSON.stringify([line.objectId,line.assetId])).map(row=><article key={row.id} className="mt-2 rounded-md border border-slate-200 p-3">
      <p className="mb-2 text-sm text-slate-600">{row.a && row.b ? "Совпадают идентификаторы объекта и средства; значения A и B" : "Только в одной версии; разные идентификаторы не объединяются по имени"}</p><div className="grid gap-3 sm:grid-cols-2"><div aria-label="A"><p className="text-xs font-semibold">A</p><LineValue line={row.a}/></div><div aria-label="B"><p className="text-xs font-semibold">B</p><LineValue line={row.b}/></div></div>
    </article>)}</section>
    {result.warnings.length > 0 && <section aria-label="Замечания к сравнению" className="rounded-md border border-amber-200 bg-amber-50 p-3"><h3 className="font-semibold">Замечания к сопоставимости</h3><ul className="mt-2 list-disc pl-5">{result.warnings.map((issue,index)=><li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul></section>}
    <p className="text-sm text-slate-600">Стоимость и состав не подтверждают эффективность, покрытие или достаточность защиты. Сравнение относится только к указанным сохранённым версиям.</p>
  </section>;
}

function ComparisonControls({ enterpriseId, projects }: { enterpriseId: string; projects: VariantSummary[] }) {
  const state = useConfigurationComparison(enterpriseId);
  const projectName = useDefenseProjectStore(store=>store.project.projectName);
  const saveStatus = useDefenseVariantsStore(store=>store.saveStatus);
  const activeId = useDefenseVariantsStore(store=>store.activeVariantId);
  const [name,setName] = useState(projectName);
  const options = new Map(projects.filter(project=>project.enterpriseId === enterpriseId).map(project=>[project.projectId,project]));
  for (const selection of [state.a,state.b]) if (selection && !options.has(selection.project.projectId)) options.set(selection.project.projectId,selection.project);
  return <section id="configuration-comparison" aria-label="Сравнение конфигураций" className="rounded-lg border border-slate-200 bg-white p-4">
    <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Сравнение конфигураций</h2><p className="mt-2 text-sm text-slate-600">Выберите две сохранённые версии одного предприятия. Номера остаются фиксированными после новых сохранений.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{(["a","b"] as const).map(side=>{ const selected=state[side]; return <div key={side} className="grid min-w-0 gap-2">
      <label className="text-sm">{side === "a" ? "Первая конфигурация" : "Вторая конфигурация"}<select aria-label={side === "a" ? "Первая конфигурация" : "Вторая конфигурация"} value={selected?.project.projectId ?? ""} disabled={state.saving} onChange={event=>{const project=options.get(event.target.value);state.select(side,project?{project,version:String(project.version)}:null);}} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3"><option value="">Выберите конфигурацию</option>{[...options.values()].map(project=><option key={project.projectId} value={project.projectId}>{project.name}</option>)}</select></label>
      <label className="text-sm">Версия {side.toUpperCase()}<input aria-label={`Версия ${side.toUpperCase()}`} type="number" min="1" step="1" value={selected?.version ?? ""} disabled={!selected || state.saving} onChange={event=>selected&&state.select(side,{...selected,version:event.target.value})} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3"/></label>
    </div>;})}</div>
    <button type="button" onClick={state.compare} disabled={!state.valid || state.loading || state.saving || saveStatus === "saving"} className="mt-3 min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">Сравнить</button>
    {state.a && state.b && !state.valid && <p role="alert" className="mt-2 text-sm text-amber-800">Укажите положительные целые номера двух разных сохранённых версий.</p>}
    {state.loading && <p role="status" className="mt-3 text-sm">Загружается сравнение выбранных версий…</p>}
    {state.error && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
    {state.result && <ComparisonResultView result={state.result}/>}
    <Modal open={state.dirtyPrompt} title="Есть несохранённые изменения" footer={null} onCancel={state.cancel} closable={!state.saving} keyboard={!state.saving} mask={{ closable: !state.saving }}>
      <p>Сохраните текущий проект перед сравнением или явно сравните выбранные сохранённые версии без локальных изменений.</p>
      {!activeId && <label className="mt-3 block text-sm">Название перед сравнением<input aria-label="Название перед сравнением" value={name} onChange={event=>setName(event.target.value)} disabled={state.saving} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3"/></label>}
      {state.error && <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={state.saving} onClick={state.cancel} className="min-h-11 rounded-md border border-slate-300 px-3">Отмена</button><button type="button" disabled={state.saving} onClick={()=>void state.run()} className="min-h-11 rounded-md border border-slate-300 px-3">Сравнить последние сохранённые</button><button type="button" disabled={state.saving || saveStatus === "saving"} onClick={()=>void state.saveAndCompare(name)} className="min-h-11 rounded-md bg-blue-700 px-3 text-white disabled:opacity-50">Сохранить и сравнить</button></div>
    </Modal>
  </section>;
}
export function ConfigurationComparison(props: { enterpriseId: string; projects: VariantSummary[] }) {
  const generation = useSessionStore(state=>state.generation);
  return <ComparisonControls key={`${generation}:${props.enterpriseId}`} {...props}/>;
}
