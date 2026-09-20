// Print-only report. Rendered inside a `print:block hidden` wrapper so it appears solely in the
// browser print / "Save as PDF" output. Mirrors the reference PDF slides: estimate, comparison,
// priorities, budget. Uses light colours only (print is on white paper).

import {
  criteria,
  defaultThresholds,
} from "@/modules/defense-calculator/infra/catalog-data";
import { formatMln, priorityLabel } from "@/modules/defense-calculator/domain/format";
import type {
  ConfigurationEstimate,
  PriorityColor,
} from "@/modules/defense-calculator/domain/calculator-types";
import type { StructuralProfile } from "@/modules/defense-calculator/domain/structural-profile";
import type { ProjectObjectReportLine } from "@/modules/defense-calculator/domain/project-report-lines";
import type { fitToBudget } from "@/modules/defense-calculator/domain/budget-fit";
import type { LayerSummary } from "@/shared/types/defense-project";

const PRINT_PRIORITY_COLOR: Record<PriorityColor, string> = {
  green: "#15803d",
  orange: "#c2740c",
  red: "#dc2626",
};

type ScoredAsset = {
  asset: { id: string; name: string; unitPriceMln: number; unit: string };
  weightedScore: number;
  priority: PriorityColor;
};

export function CalculatorReport({
  myEstimate,
  structuralProfile,
  scoredAssets,
  budgetResult,
  budgetApplied,
  generatedAt,
  layerSummaries,
  objectLines,
}: {
  myEstimate: ConfigurationEstimate;
  structuralProfile: StructuralProfile;
  scoredAssets: ScoredAsset[];
  budgetResult: ReturnType<typeof fitToBudget>;
  budgetApplied: boolean;
  generatedAt?: Date;
  layerSummaries?: LayerSummary[];
  objectLines: ProjectObjectReportLine[];
}) {
  const weightsSummary = criteria.map((c) => `${c.name} ${c.weight}`).join(" · ");
  const picksIncludedCount = budgetResult.picks.filter((pick) => pick.included).length;
  const generatedAtLabel = (generatedAt ?? new Date()).toLocaleString("ru-RU");
  const hasEstimateLines = myEstimate.echelons.some((echelon) => echelon.lines.length > 0);

  return (
    <div className="report-root">
      <div className="report-titlebar">
        <h1>Расчёт конфигурации средств защиты от&nbsp;БПЛА</h1>
        <p>
          Целевая угроза: дрон массой 200&nbsp;кг (включая БЧ&nbsp;75&nbsp;кг), предельная скорость 200&nbsp;км/ч.
          Автоматический просчёт сметы, приоритета и&nbsp;покрытия эшелонов.
        </p>
        <p className="report-date" suppressHydrationWarning>
          Дата генерации: {generatedAtLabel}
        </p>
      </div>

      <section className="report-section">
        <h2>Сводка отчёта</h2>
        <table className="report-table report-table-tight">
          <thead>
            <tr>
              <th>Показатель</th>
              <th className="num">Значение</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Выбранная конфигурация</td>
              <td className="num strong">{myEstimate.configurationName}</td>
              <td>Текущий рабочий вариант</td>
            </tr>
            <tr>
              <td>Итоговая стоимость</td>
              <td className="num total">{formatMln(myEstimate.totalMln)}</td>
              <td>Сумма по всем эшелонам</td>
            </tr>
            {budgetApplied ? (
              <>
                <tr>
                  <td>Бюджетный режим</td>
                  <td className="num">{formatMln(budgetResult.budgetMln)}</td>
                  <td>
                    Распределено {formatMln(budgetResult.spentMln)}, остаток {formatMln(budgetResult.remainingMln)}
                  </td>
                </tr>
                <tr>
                  <td>Позиции в бюджете</td>
                  <td className="num">{picksIncludedCount} / {budgetResult.picks.length}</td>
                  <td>Количество включенных средств</td>
                </tr>
              </>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="report-section">
        <h2>1. Смета выбранной конфигурации — {myEstimate.configurationName}</h2>
        {hasEstimateLines ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>Эшелон</th>
                <th>Средство</th>
                <th className="num">Кол-во</th>
                <th className="num">Цена/ед.</th>
                <th className="num">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {myEstimate.echelons.flatMap((echelon) =>
                echelon.lines.map((line, idx) => (
                  <tr key={line.assetId}>
                    {idx === 0 ? (
                      <td rowSpan={echelon.lines.length} className="echelon-cell">
                        {echelon.echelonName}
                      </td>
                    ) : null}
                    <td>
                      <span className="dot" style={{ background: PRINT_PRIORITY_COLOR[line.priority] }} />
                      {line.assetName}
                    </td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{line.unitPriceMln > 0 ? formatMln(line.unitPriceMln) : "—"}</td>
                    <td className="num strong">{formatMln(line.lineTotalMln)}</td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="num">
                  ИТОГО
                </td>
                <td className="num total">{formatMln(myEstimate.totalMln)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="report-note">Конфигурация пуста: добавьте средства защиты на карте и сохраните её в текущий проект.</p>
        )}
      </section>

      {layerSummaries?.length ? (
        <section className="report-section">
          <h2>1.1. Эшелоны карты</h2>
          <table className="report-table report-table-tight">
            <thead>
              <tr>
                <th>Эшелон</th>
                <th className="num">Удалённость</th>
                <th className="num">Ширина</th>
                <th className="num">Объекты</th>
                <th className="num">Единицы</th>
                <th className="num">Покрытие</th>
                <th className="num">Конфликты</th>
                <th className="num">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {layerSummaries.map((layer) => (
                <tr key={layer.layerId}>
                  <td className="echelon-cell">
                    {layer.layerCode} · {layer.layerName}
                  </td>
                  <td className="num">{layer.innerRadiusM.toLocaleString("ru-RU")} м</td>
                  <td className="num">{layer.widthM.toLocaleString("ru-RU")} м</td>
                  <td className="num">{layer.objectCount}</td>
                  <td className="num">{layer.unitCount}</td>
                  <td className="num">{layer.coverageScore}</td>
                  <td className="num">{layer.conflictCount > 0 ? layer.conflictCount : "—"}</td>
                  <td className="num strong">{formatMln(layer.totalMln)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {objectLines.length > 0 ? (
        <section className="report-section">
          <h2>1.2. Размещённые объекты по эшелонам и типам</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th>Эшелон</th>
                <th>Форма эшелона</th>
                <th>Тип</th>
                <th>Объект</th>
                <th>Состав/вооружение</th>
                <th>Азимут/сектор</th>
                <th className="num">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {objectLines.map((line) => (
                <tr key={line.objectId}>
                  <td>
                    {line.layerCode} · {line.layerName}
                  </td>
                  <td>
                    Форма эшелона: {line.layerGeometryLabel}
                    {line.layerAreaHa ? <span> · Площадь эшелона: {line.layerAreaHa.toLocaleString("ru-RU")} га</span> : null}
                  </td>
                  <td>{line.protectionType || "—"}</td>
                  <td>{line.assetName}</td>
                  <td>
                    {line.compositionSummary ? <span>{line.compositionSummary}</span> : <span>—</span>}
                    {line.weaponSummary ? <span> · {line.weaponSummary}</span> : null}
                  </td>
                  <td>{line.azimuthSectorSummary ?? "—"}</td>
                  <td className="num strong">{formatMln(line.lineTotalMln)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="report-section">
        <h2>2. Структурный профиль конфигурации</h2>
        <table className="report-table report-table-tight">
          <thead>
            <tr>
              <th>Показатель</th>
              <th className="num">Значение</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Объекты (позиции)</td><td className="num strong">{structuralProfile.objectCount}</td></tr>
            <tr><td>Единицы</td><td className="num">{structuralProfile.unitCount}</td></tr>
            <tr><td>Эшелоны (занятые)</td><td className="num">{structuralProfile.echelonCount}</td></tr>
            <tr><td>Категории средств</td><td className="num">{structuralProfile.categoryCount}</td></tr>
            <tr><td>Конфликты</td><td className="num">{structuralProfile.conflictCount}</td></tr>
            <tr><td>Позиции с покрытием</td><td className="num">{structuralProfile.coveredObjectCount}</td></tr>
            <tr><td>Стоимость (опционально)</td><td className="num total">{formatMln(structuralProfile.totalMln)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="report-section">
        <h2>3. Приоритет средств защиты</h2>
        <p className="report-legend">
          <span className="dot" style={{ background: PRINT_PRIORITY_COLOR.green }} /> первоочередно (балл ≥{" "}
          {defaultThresholds.green})
          <span className="dot" style={{ background: PRINT_PRIORITY_COLOR.orange, marginLeft: 16 }} /> средний (≥{" "}
          {defaultThresholds.orange})
          <span className="dot" style={{ background: PRINT_PRIORITY_COLOR.red, marginLeft: 16 }} /> последний (&lt;{" "}
          {defaultThresholds.orange})
        </p>
        <table className="report-table">
          <thead>
            <tr>
              <th>Средство</th>
              <th className="num">Балл</th>
              <th>Приоритет</th>
              <th className="num">Цена/ед.</th>
            </tr>
          </thead>
          <tbody>
            {[...scoredAssets]
              .sort((a, b) => b.weightedScore - a.weightedScore)
              .map(({ asset, weightedScore, priority }) => (
                <tr key={asset.id}>
                  <td>
                    <span className="dot" style={{ background: PRINT_PRIORITY_COLOR[priority] }} />
                    {asset.name}
                  </td>
                  <td className="num strong" style={{ color: PRINT_PRIORITY_COLOR[priority] }}>
                    {weightedScore.toFixed(0)}
                  </td>
                  <td>{priorityLabel[priority]}</td>
                  <td className="num">{asset.unitPriceMln > 0 ? formatMln(asset.unitPriceMln) : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="report-note">Веса критериев (сумма 100): {weightsSummary}.</p>
      </section>

      {budgetApplied ? (
        <section className="report-section">
          <h2>4. Подбор под бюджет — {formatMln(budgetResult.budgetMln)}</h2>
          <p className="report-note">
            Распределено {formatMln(budgetResult.spentMln)} · Остаток {formatMln(budgetResult.remainingMln)}.
            Порядок: первоочередные по убыванию балла, затем средний и последний приоритет.
          </p>
          <table className="report-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Средство</th>
                <th className="num">Балл</th>
                <th className="num">Цена/ед.</th>
                <th className="num">Σ нарастающим</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {budgetResult.picks.map((pick, index) => (
                <tr key={pick.assetId} style={pick.included ? undefined : { color: "#94a3b8" }}>
                  <td className="num">{index + 1}</td>
                  <td>
                    <span className="dot" style={{ background: PRINT_PRIORITY_COLOR[pick.priority] }} />
                    {pick.assetName}
                  </td>
                  <td className="num">{pick.weightedScore.toFixed(0)}</td>
                  <td className="num">{pick.unitPriceMln > 0 ? formatMln(pick.unitPriceMln) : "—"}</td>
                  <td className="num">{pick.included ? formatMln(pick.cumulativeMln) : "—"}</td>
                  <td>{pick.included ? "включено" : "не вошло"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <p className="report-footer">
        Базовые цены — из эталонного документа, расширенный каталог карты дополнен ориентировочными CAPEX-оценками.
        Оценки по 7&nbsp;критериям — предварительная экспертная оценка.
      </p>
    </div>
  );
}
