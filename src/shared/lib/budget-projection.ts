import type { DefenseProject } from "@/shared/types/defense-project";
import type { BudgetCheckResponse, BudgetProjection } from "@/shared/types/finance";
import { buildDraftCostProjection, formatMinorRub } from "./cost-projection";
import { FortisProtocolError, isRecord } from "./api-client";

const amount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
const optionalAmount = (value: unknown) => value === null || amount(value);
const signedAmount = (value: unknown) => value === null || typeof value === "string" && /^(0|-?[1-9]\d*)$/.test(value);

export function readBudgetProjection(value: unknown, projectId: string, version: number): BudgetProjection {
  if (!isRecord(value) || !isRecord(value.identity) || value.identity.projectId !== projectId || value.identity.projectVersion !== version ||
      !Number.isSafeInteger(version) || version < 1 || typeof value.identity.calculationVersion !== "string" || !value.identity.calculationVersion ||
      typeof value.identity.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.identity.snapshotDigest) ||
      !isRecord(value.identity.inputDataVersions) || !Object.values(value.identity.inputDataVersions).every(v => typeof v === "string") ||
      !isRecord(value.config) || !(value.config.budgetMode === "unlimited" ? value.config.budgetLimitMinor === null : value.config.budgetMode === "limited" && amount(value.config.budgetLimitMinor)) ||
      !optionalAmount(value.spentMinor) || !signedAmount(value.remainingMinor)) throw new FortisProtocolError();
  const status = value.spentMinor === null ? "indeterminate" : value.config.budgetMode === "unlimited" ? "unlimited"
    : BigInt(value.spentMinor as string) <= BigInt(value.config.budgetLimitMinor as string) ? "within_limit" : "exceeded";
  const remaining = value.spentMinor === null || value.config.budgetMode === "unlimited" ? null : String(BigInt(value.config.budgetLimitMinor as string) - BigInt(value.spentMinor as string));
  if (value.status !== status || value.remainingMinor !== remaining) throw new FortisProtocolError();
  return value as BudgetProjection;
}

export function readBudgetCheck(value: unknown, projectId: string, version: number): BudgetCheckResponse {
  if (!isRecord(value) || !isRecord(value.basedOn) || value.basedOn.projectId !== projectId || value.basedOn.projectVersion !== version ||
      !["allowed", "blocked"].includes(String(value.status)) || !["within_budget", "unlimited", "budget_exceeded", "price_unknown", "non_increasing_overage"].includes(String(value.reasonCode)) ||
      !optionalAmount(value.projectedSpentMinor) || !signedAmount(value.projectedRemainingMinor) ||
      (value.status === "blocked") !== ["budget_exceeded", "price_unknown"].includes(String(value.reasonCode))) throw new FortisProtocolError();
  return value as BudgetCheckResponse;
}

export function projectBudgetCandidate(project: DefenseProject, budget: BudgetProjection, allowExistingOverage = true): BudgetCheckResponse {
  const total = buildDraftCostProjection(project).totalMinor;
  const limited = budget.config.budgetMode === "limited";
  const limit = limited ? BigInt(budget.config.budgetLimitMinor!) : null;
  const remaining = total === null || limit === null ? null : String(limit - BigInt(total));
  const over = total !== null && limit !== null && BigInt(total) > limit;
  const reducing = over && allowExistingOverage && budget.spentMinor !== null && BigInt(budget.spentMinor) > limit! && BigInt(total!) <= BigInt(budget.spentMinor);
  const reasonCode = !limited ? "unlimited" : total === null ? "price_unknown" : reducing ? "non_increasing_overage" : over ? "budget_exceeded" : "within_budget";
  return { basedOn: { projectId: budget.identity.projectId, projectVersion: budget.identity.projectVersion }, status: ["budget_exceeded", "price_unknown"].includes(reasonCode) ? "blocked" : "allowed", reasonCode, projectedSpentMinor: total, projectedRemainingMinor: remaining };
}

export function parseBudgetRub(input: string): string | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.replace(/[\s\u00a0]/g, ""));
  return match ? String(BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"))) : null;
}
export function formatBudgetMinor(value: string | null): string {
  return value?.startsWith("-") ? `−${formatMinorRub(value.slice(1))}` : formatMinorRub(value);
}
export function budgetMessage(result: BudgetCheckResponse): string {
  return result.reasonCode === "price_unknown" ? "Цена части позиций неизвестна. При ограниченном бюджете укажите цены перед сохранением."
    : `${result.status === "blocked" ? "Бюджет превышен." : "Предварительная проверка."} Расход: ${formatBudgetMinor(result.projectedSpentMinor)}. Остаток: ${result.reasonCode === "unlimited" ? "не ограничен" : formatBudgetMinor(result.projectedRemainingMinor)}.`;
}
