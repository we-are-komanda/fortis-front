"use client";

import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import { formatMinorRub } from "@/shared/lib/cost-projection";
import type { FinancialLine } from "@/shared/types/finance";
import { describePlacement } from "@/modules/drone-defense/domain/placement-helpers";
import styles from "./drone-defense-prototype.module.css";
import type {
  DefenseCatalogResponse,
  DefenseLayer,
  DefenseLayerId,
  Placement,
} from "@/shared/types/drone-defense";

const statusLabel: Record<string, string> = {
  ready: "Готов",
  warning: "Внимание",
  inactive: "Выключен",
};

export function EchelonObjectsList({
  layerId,
  placements,
  costLines,
  catalog,
  layers,
  hiddenPlacementIds,
  selectedPlacementId,
  onSelect,
  onLocate,
  onToggleVisibility,
  onRemove,
}: {
  layerId: DefenseLayerId;
  placements: Placement[];
  costLines: FinancialLine[];
  catalog: DefenseCatalogResponse | null;
  layers: DefenseLayer[];
  hiddenPlacementIds: Set<string>;
  selectedPlacementId: string | null;
  onSelect: (placementId: string) => void;
  onLocate: (placement: Placement) => void;
  onToggleVisibility: (placementId: string) => void;
  onRemove: (placementId: string) => void;
}) {
  const layerPlacements = placements.filter((placement) => placement.layerId === layerId);

  if (layerPlacements.length === 0) {
    return (
      <div className={`${styles.prototypeCard} ${styles.prototypeMutedCard}`}>
        <p className={styles.prototypeCardTitle}>В этом эшелоне пока нет объектов</p>
        <p className={styles.prototypeMeta}>Перетащите средство из каталога на карту</p>
      </div>
    );
  }

  return (
    <ul className="grid gap-2">
      {layerPlacements.map((placement) => {
        const summary = describePlacement({ placement, catalog, layers });
        const isSelected = placement.id === selectedPlacementId;
        const isHidden = hiddenPlacementIds.has(placement.id);
        const statusClass =
          summary.status === "ready"
            ? styles.prototypeBadgeSuccess
            : summary.status === "warning"
              ? styles.prototypeBadgeWarning
              : styles.prototypeBadgeMuted;
        return (
          <li
            key={placement.id}
            className={`${styles.prototypeCard} ${isSelected ? styles.prototypeCardSelected : ""}`}
          >
            <button type="button" className="block w-full text-left" onClick={() => onSelect(placement.id)}>
              <div className="flex items-start justify-between gap-2">
                <p className={styles.prototypeCardTitle}>{summary.name}</p>
                {isHidden ? (
                  <span className={styles.prototypeBadgeWarning}>
                    скрыт на карте
                  </span>
                ) : null}
                <span className={statusClass}>
                  {statusLabel[summary.status]}
                </span>
              </div>
              <p className={styles.prototypeMeta}>
                {summary.echelonShortName} · {summary.echelonName} · ×{summary.qty} · {formatMinorRub(costLines.find(line => line.objectId === placement.id)?.lineTotalMinor ?? null)}
              </p>
            </button>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={`${styles.prototypeButton} px-2`}
                onClick={() => onLocate(placement)}
              >
                На карте
              </button>
              <button
                type="button"
                className={`${isHidden ? styles.prototypeButtonPrimary : styles.prototypeButton} px-2`}
                onClick={() => onToggleVisibility(placement.id)}
                title={isHidden ? "Показать на карте" : "Скрыть на карте"}
                aria-pressed={!isHidden}
              >
                {isHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                {isHidden ? "Показать" : "Скрыть"}
              </button>
              <button
                type="button"
                className={`${styles.prototypeButtonDanger} px-2`}
                onClick={() => onRemove(placement.id)}
              >
                Удалить
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
