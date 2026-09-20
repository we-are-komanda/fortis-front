import type { PriorityColor } from "@/modules/defense-calculator/domain/calculator-types";

/** Format a value in млн руб into a compact RU label (e.g. 2454.1 → "2,45 млрд", 42 → "42 млн"). */
export function formatMln(valueMln: number | null): string {
  if (valueMln === null) return "Итог неполный";
  if (valueMln >= 1000) {
    const bln = valueMln / 1000;
    return `${bln.toFixed(bln >= 10 ? 1 : 2).replace(".", ",")} млрд`;
  }
  const rounded = Math.round(valueMln * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} млн`;
}

export const priorityLabel: Record<PriorityColor, string> = {
  green: "Первоочередно",
  orange: "Средний приоритет",
  red: "Последний приоритет",
};
