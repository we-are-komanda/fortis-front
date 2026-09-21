"use client";
import { useMemo, useState } from "react";
import { useProjectBudget } from "../domain/use-project-budget";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { budgetMessage, formatBudgetMinor, parseBudgetRub, projectBudgetCandidate } from "@/shared/lib/budget-projection";
import { placeObjectInProject } from "@/shared/lib/defense-project";
import type { BudgetConfig, BudgetProjection } from "@/shared/types/finance";

function BudgetForm({ budget }: { budget: BudgetProjection }) {
  const pending = useDefenseProjectStore(state => state.saveAttempt);
  const initialConfig = pending?.kind === "budget" ? JSON.parse(pending.body) as BudgetConfig : budget.config;
  const limit = initialConfig.budgetLimitMinor;
  const initialInput = limit === null ? "" : `${BigInt(limit) / BigInt(100)}.${(BigInt(limit) % BigInt(100)).toString().padStart(2, "0")}`;
  const pendingBody = pending?.kind === "budget" ? pending.body : null;
  const [form, setForm] = useState({ mode: initialConfig.budgetMode, input: initialInput, pendingBody });
  if (form.pendingBody !== pendingBody) setForm(pendingBody ? { mode: initialConfig.budgetMode, input: initialInput, pendingBody } : { ...form, pendingBody });
  const { mode, input } = form;
  const { updateBudget, saveStatus, error } = useDefenseVariantsStore();
  const amount = parseBudgetRub(input);
  return <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (mode === "unlimited" || amount !== null) void updateBudget(mode === "unlimited" ? { budgetMode: mode, budgetLimitMinor: null } : { budgetMode: mode, budgetLimitMinor: amount! }); }}>
    <label className="flex flex-col gap-1 text-sm">Режим бюджета<select aria-label="Режим бюджета" value={mode} disabled={saveStatus === "saving" || pending?.kind === "budget"} onChange={event => setForm({ ...form, mode: event.target.value as "limited" | "unlimited" })} className="min-h-11 rounded-md border border-slate-300 bg-white px-2"><option value="limited">Ограниченный</option><option value="unlimited">Без ограничения</option></select></label>
    {mode === "limited" && <label className="flex min-w-0 flex-col gap-1 text-sm">Лимит бюджета, ₽<input aria-label="Лимит бюджета, ₽" inputMode="decimal" value={input} onChange={event => setForm({ ...form, input: event.target.value })} disabled={saveStatus === "saving" || pending?.kind === "budget"} aria-invalid={amount === null} className="min-h-11 w-full rounded-md border border-slate-300 px-2" /></label>}
    <button type="submit" disabled={saveStatus === "saving" || mode === "limited" && amount === null || Boolean(pending && pending.kind !== "budget")} className="min-h-11 rounded-md bg-blue-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{pending?.kind === "budget" ? "Повторить сохранение бюджета" : mode === "unlimited" && budget.config.budgetMode === "limited" ? "Снять ограничение бюджета" : "Сохранить бюджет"}</button>
    {pending?.kind === "budget" && <p className="w-full text-sm">Повтор использует предыдущие параметры после проверки результата на сервере.</p>}
    {mode === "limited" && amount === null && <p className="w-full text-sm text-amber-800">Введите неотрицательную сумму в рублях, не более двух знаков после запятой. Нулевой лимит допустим.</p>}
    {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
  </form>;
}

export function ProjectBudgetPanel({ compact = false }: { compact?: boolean }) {
  const state = useProjectBudget();
  const { project, budget, preview } = state;
  const proposedPlacement = useMemo(() => {
    if (!compact || !budget || project.mode !== "place-object" || !project.selectedAssetId || !project.activeLayerId) return null;
    try { return projectBudgetCandidate(placeObjectInProject(project, project.selectedAssetId, project.activeLayerId, project.baseObject.center), budget); } catch { return null; }
  }, [compact, budget, project]);
  return <section aria-label="Бюджет проекта" className="rounded-xl border border-slate-200 bg-white p-4 text-slate-900">
    <h2 className="font-semibold">Бюджет проекта</h2>
    {!budget ? <p role="status" className="mt-2 text-sm">Бюджет не проверен. Изменения остаются локальным черновиком.{!state.available ? " Сохраните проект для настройки бюджета." : ""}</p> : <>
      <p className="mt-2 text-sm">Лимит сохранённой версии {budget.identity.projectVersion}: {budget.config.budgetMode === "unlimited" ? "без ограничения" : formatBudgetMinor(budget.config.budgetLimitMinor)}</p>
      <p className="mt-1 text-sm">Расход проекта: {formatBudgetMinor(preview?.projectedSpentMinor ?? null)} · Остаток: {budget.config.budgetMode === "unlimited" ? "не ограничен" : formatBudgetMinor(preview?.projectedRemainingMinor ?? null)}</p>
      {budget.status === "exceeded" && <p className="mt-2 text-sm text-amber-800">Сохранённый расход превышает лимит. Допустимы изменения без увеличения этого расхода.</p>}
      {preview?.projectedSpentMinor === null && <p className="mt-2 text-sm text-amber-800">Итог неполный: часть цен неизвестна.</p>}
      {proposedPlacement && <p className="mt-2 text-sm">После размещения выбранного средства: {formatBudgetMinor(proposedPlacement.projectedSpentMinor)} · Остаток: {budget.config.budgetMode === "unlimited" ? "не ограничен" : formatBudgetMinor(proposedPlacement.projectedRemainingMinor)}</p>}
      <BudgetForm key={state.key} budget={budget} />
      <button type="button" onClick={() => void state.check()} disabled={state.checking} className="mt-3 min-h-11 rounded-md border border-slate-300 px-3 text-sm">Проверить текущий проект</button>
      {state.checked && <p role="status" className="mt-2 text-sm">{budgetMessage(state.checked)} Проверка не сохраняет проект и не резервирует бюджет.</p>}
    </>}
    {state.budgetError && <p role="alert" className="mt-2 text-sm text-red-700">{state.budgetError}</p>}
    {state.error && <div role="alert" className="mt-2 text-sm text-red-700"><p>{state.error}</p><button type="button" onClick={state.retry} className="mt-2 min-h-11 rounded-md border border-slate-300 px-3">Обновить бюджет</button></div>}
  </section>;
}
