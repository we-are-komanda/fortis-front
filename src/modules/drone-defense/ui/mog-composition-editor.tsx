"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { formatMinorRub } from "@/shared/lib/cost-projection";
import type { FinancialLine } from "@/shared/types/finance";
import { cn } from "@/lib/utils";
import {
  buildMogCoverageInputMap,
  clampMogAzimuth,
  clampMogSector,
  formatMogOption,
  formatMogRange,
  hasMogErrors,
  isMogDirty,
  MOG_ACCOUNTABILITY_OPTIONS,
  MOG_POST_TYPE_OPTIONS,
  type MogCoverageInputMap,
  parseMogCount,
  sanitizeMogCountInput,
  syncMogDraft,
  validateMogDraft,
} from "@/modules/drone-defense/domain/mog-editor";
import {
  getVisibleMogCoverageWeapons,
  MOG_WEAPON_COVERAGE_COLORS,
} from "@/modules/drone-defense/domain/mog-coverage";
import type { DefenseAsset, PlacedDefenseObject } from "@/shared/types/defense-project";
import type { MogEquipmentId, MogWeaponId, PlacedDefenseCompoundProfile } from "@/shared/types/defense-configuration";
import styles from "./drone-defense-prototype.module.css";

type MogCompositionEditorProps = {
  objectId: string;
  asset: DefenseAsset;
  costLine?: FinancialLine;
  layerLabel: string;
  profile: PlacedDefenseCompoundProfile;
  onPreviewChange: (patch: Partial<PlacedDefenseObject>) => void;
  onSave: (patch: Partial<PlacedDefenseObject>) => void;
  onCancel: (patch: Partial<PlacedDefenseObject>) => void;
};

function EditorSection({
  title,
  eyebrow,
  tone = "default",
  children,
}: {
  title: string;
  eyebrow?: string;
  tone?: "default" | "muted" | "accent";
  children: ReactNode;
}) {
  return (
    <section
      className={styles.prototypeDrawerSection}
      data-tone={tone}
    >
      <div className={styles.prototypeDrawerSectionHeader}>
        {eyebrow ? <p className={styles.prototypeEyebrow}>{eyebrow}</p> : null}
        <h3 className={styles.prototypeTitle}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-rose-600">{message}</p>;
}

function Stepper({
  value,
  onDecrease,
  onIncrease,
  ariaLabel,
}: {
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.prototypeCounter}>
      <button
        type="button"
        onClick={onDecrease}
        disabled={value <= 0}
        aria-label={`${ariaLabel}: уменьшить`}
        className={styles.prototypeCounterButton}
      >
        −
      </button>
      <output
        aria-label={`${ariaLabel}: текущее значение`}
        className={styles.prototypeCounterValue}
      >
        {value}
      </output>
      <button
        type="button"
        onClick={onIncrease}
        aria-label={`${ariaLabel}: увеличить`}
        className={styles.prototypeCounterButton}
      >
        +
      </button>
    </div>
  );
}

function normalizeMogAzimuth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

function readMogAzimuthPointer(event: PointerEvent<HTMLButtonElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radians = Math.atan2(event.clientX - centerX, centerY - event.clientY);
  return normalizeMogAzimuth((radians * 180) / Math.PI);
}

function normalizeMogSectorDial(value: number): number {
  return clampMogSector(Math.round(value));
}

function readMogSectorPointer(event: PointerEvent<HTMLButtonElement>): number {
  const value = readMogAzimuthPointer(event);
  return value === 0 ? 360 : normalizeMogSectorDial(value);
}

function MogAzimuthDial({
  value,
  color,
  weaponLabel,
  onChange,
}: {
  value: number;
  color: string;
  weaponLabel: string;
  onChange: (value: number) => void;
}) {
  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onChange(readMogAzimuthPointer(event));
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const stepMap: Partial<Record<string, number>> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 15,
      PageDown: -15,
    };
    const step = stepMap[event.key];
    if (step !== undefined) {
      event.preventDefault();
      onChange(normalizeMogAzimuth(value + step));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(359);
    }
  };

  return (
    <button
      type="button"
      role="slider"
      className={styles.mogAzimuthDial}
      aria-label={`Настроить азимут ${weaponLabel}: ${value} градусов`}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      style={
        {
          "--mog-azimuth-angle": `${value}deg`,
          "--mog-azimuth-color": color,
        } as CSSProperties
      }
    >
      <span className={styles.mogAzimuthDialNeedle} aria-hidden="true" />
      <span className={styles.mogAzimuthDialHandle} aria-hidden="true" />
    </button>
  );
}

function MogSectorDial({
  value,
  color,
  weaponLabel,
  onChange,
}: {
  value: number;
  color: string;
  weaponLabel: string;
  onChange: (value: number) => void;
}) {
  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onChange(readMogSectorPointer(event));
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const stepMap: Partial<Record<string, number>> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 15,
      PageDown: -15,
    };
    const step = stepMap[event.key];
    if (step !== undefined) {
      event.preventDefault();
      onChange(normalizeMogSectorDial(value + step));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(1);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(360);
    }
  };

  return (
    <button
      type="button"
      role="slider"
      className={styles.mogSectorDial}
      aria-label={`Настроить сектор ${weaponLabel}: ${value} градусов`}
      aria-valuemin={1}
      aria-valuemax={360}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      style={
        {
          "--mog-sector-angle": `${value}deg`,
          "--mog-sector-color": color,
        } as CSSProperties
      }
    >
      <span className={styles.mogSectorDialCore} aria-hidden="true" />
      <span className={styles.mogSectorDialHandle} aria-hidden="true" />
    </button>
  );
}

export function MogCompositionEditor({
  objectId,
  asset,
  costLine,
  layerLabel,
  profile,
  onPreviewChange,
  onSave,
  onCancel,
}: MogCompositionEditorProps) {
  const initialProfile = syncMogDraft(profile);
  const lastObjectIdRef = useRef(objectId);
  const [baselineProfile, setBaselineProfile] = useState(initialProfile);
  const [draft, setDraft] = useState(initialProfile);
  const [coverageInputs, setCoverageInputs] = useState<MogCoverageInputMap>(() =>
    buildMogCoverageInputMap(initialProfile),
  );

  useEffect(() => {
    if (lastObjectIdRef.current === objectId) return;
    lastObjectIdRef.current = objectId;
    const nextInitialProfile = syncMogDraft(profile);
    setBaselineProfile(nextInitialProfile);
    setDraft(nextInitialProfile);
    setCoverageInputs(buildMogCoverageInputMap(nextInitialProfile));
  }, [objectId, profile]);

  const visibleCoverageWeapons = useMemo(() => getVisibleMogCoverageWeapons(draft), [draft]);
  const visibleCoverageWeaponIds = useMemo(
    () => new Set(visibleCoverageWeapons.map((weapon) => weapon.id)),
    [visibleCoverageWeapons],
  );
  const errors = useMemo(
    () =>
      validateMogDraft({
        draft,
        coverageInputs,
      }),
    [coverageInputs, draft],
  );
  const hasErrors = hasMogErrors(errors);
  const isDirty = isMogDirty(baselineProfile, draft);

  const applyDraft = (updater: (current: PlacedDefenseCompoundProfile) => PlacedDefenseCompoundProfile) => {
    setDraft((current) => {
      const next = syncMogDraft(updater(current));
      setCoverageInputs(buildMogCoverageInputMap(next));
      onPreviewChange({ compoundProfile: next });
      return next;
    });
  };

  const setCoverageInputValue = (
    weaponId: MogWeaponId,
    patch: Partial<NonNullable<MogCoverageInputMap[MogWeaponId]>>,
  ) => {
    setCoverageInputs((current) => ({
      ...current,
      [weaponId]: {
        ...current[weaponId],
        ...patch,
      },
    }));
  };

  const handleEquipmentStep = (id: MogEquipmentId, delta: number) => {
    applyDraft((current) => ({
      ...current,
      equipment: current.equipment?.map((item) =>
        item.id === id ? { ...item, quantity: String(Math.max(0, parseMogCount(item.quantity) + delta)) } : item,
      ),
    }));
  };

  const handleWeaponStep = (id: MogWeaponId, delta: number) => {
    applyDraft((current) => {
      const nextWeapons = current.weapons?.map((item) =>
        item.id === id ? { ...item, quantity: String(Math.max(0, parseMogCount(item.quantity) + delta)) } : item,
      );
      const nextVisibleCoverageWeaponIds = (current.visibleCoverageWeaponIds ?? []).filter((weaponId) => {
        const weapon = nextWeapons?.find((item) => item.id === weaponId);
        return Boolean(weapon && parseMogCount(weapon.quantity) > 0);
      });
      return {
        ...current,
        weapons: nextWeapons,
        visibleCoverageWeaponIds: nextVisibleCoverageWeaponIds,
      };
    });
  };

  const handleCoverageToggle = (id: MogWeaponId) => {
    const selectedWeapon = draft.weapons?.find((item) => item.id === id);
    if (!selectedWeapon || parseMogCount(selectedWeapon.quantity) === 0) return;
    applyDraft((current) => {
      const currentVisible = new Set(current.visibleCoverageWeaponIds ?? []);
      const nextVisible = new Set(currentVisible);
      if (nextVisible.has(id)) {
        nextVisible.delete(id);
      } else {
        nextVisible.add(id);
      }

      const nextVisibleCoverageWeaponIds = (current.weapons ?? [])
        .map((weapon) => weapon.id)
        .filter((weaponId) => nextVisible.has(weaponId));

      return {
        ...current,
        coverageWeaponId: id,
        visibleCoverageWeaponIds: nextVisibleCoverageWeaponIds,
      };
    });
  };

  const handleWeaponAzimuthInput = (weaponId: MogWeaponId, value: string) => {
    setCoverageInputValue(weaponId, { azimuth: value });
    const parsed = Number(value.replace(",", "."));
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 359) return;
    applyDraft((current) => ({
      ...current,
      weapons: current.weapons?.map((weapon) =>
        weapon.id === weaponId ? { ...weapon, coverageAzimuth: clampMogAzimuth(parsed) } : weapon,
      ),
    }));
  };

  const handleWeaponAzimuthDialChange = (weaponId: MogWeaponId, value: number) => {
    const nextValue = normalizeMogAzimuth(value);
    setCoverageInputValue(weaponId, { azimuth: String(nextValue) });
    applyDraft((current) => ({
      ...current,
      weapons: current.weapons?.map((weapon) =>
        weapon.id === weaponId ? { ...weapon, coverageAzimuth: nextValue } : weapon,
      ),
    }));
  };

  const commitWeaponAzimuthInput = (weaponId: MogWeaponId) => {
    const weapon = draft.weapons?.find((item) => item.id === weaponId);
    if (!weapon) return;
    const parsed = Number((coverageInputs[weaponId]?.azimuth ?? "").replace(",", "."));
    const nextValue =
      Number.isInteger(parsed) && parsed >= 0 && parsed <= 359
        ? clampMogAzimuth(parsed)
        : clampMogAzimuth(weapon.coverageAzimuth ?? draft.azimuth);
    setCoverageInputValue(weaponId, { azimuth: String(nextValue) });
    if (nextValue !== (weapon.coverageAzimuth ?? draft.azimuth)) {
      applyDraft((current) => ({
        ...current,
        weapons: current.weapons?.map((item) =>
          item.id === weaponId ? { ...item, coverageAzimuth: nextValue } : item,
        ),
      }));
    }
  };

  const handleWeaponSectorInput = (weaponId: MogWeaponId, value: string) => {
    setCoverageInputValue(weaponId, { sectorWidthDeg: value });
    const parsed = Number(value.replace(",", "."));
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 360) return;
    applyDraft((current) => ({
      ...current,
      weapons: current.weapons?.map((weapon) =>
        weapon.id === weaponId ? { ...weapon, coverageSectorWidthDeg: clampMogSector(parsed) } : weapon,
      ),
    }));
  };

  const commitWeaponSectorInput = (weaponId: MogWeaponId) => {
    const weapon = draft.weapons?.find((item) => item.id === weaponId);
    if (!weapon) return;
    const parsed = Number((coverageInputs[weaponId]?.sectorWidthDeg ?? "").replace(",", "."));
    const nextValue =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 360
        ? clampMogSector(parsed)
        : clampMogSector(weapon.coverageSectorWidthDeg ?? draft.sectorWidthDeg ?? 90);
    setCoverageInputValue(weaponId, { sectorWidthDeg: String(nextValue) });
    if (nextValue !== (weapon.coverageSectorWidthDeg ?? draft.sectorWidthDeg ?? 90)) {
      applyDraft((current) => ({
        ...current,
        weapons: current.weapons?.map((item) =>
          item.id === weaponId ? { ...item, coverageSectorWidthDeg: nextValue } : item,
        ),
      }));
    }
  };

  const handleWeaponSectorDialChange = (weaponId: MogWeaponId, value: number) => {
    const nextValue = normalizeMogSectorDial(value);
    setCoverageInputValue(weaponId, { sectorWidthDeg: String(nextValue) });
    applyDraft((current) => ({
      ...current,
      weapons: current.weapons?.map((weapon) =>
        weapon.id === weaponId ? { ...weapon, coverageSectorWidthDeg: nextValue } : weapon,
      ),
    }));
  };

  const handleCancel = () => {
    onCancel({ compoundProfile: baselineProfile });
  };

  const handleSave = () => {
    if (hasErrors) return;
    const finalizedDraft = syncMogDraft({
      ...draft,
      personnelCount: sanitizeMogCountInput(draft.personnelCount),
    });
    onSave({ compoundProfile: finalizedDraft });
  };

  return (
    <div className={styles.prototypeDrawerWrap}>
      <aside className={styles.prototypeDrawer}>
        <header className={styles.prototypeDrawerHeader}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={styles.prototypeBadgeMuted}>
                  {asset.name}
                </span>
                {isDirty ? (
                  <span className={styles.prototypeBadge}>
                    Есть несохраненные изменения
                  </span>
                ) : null}
              </div>
              <h2 className={`${styles.prototypeTitleLarge} mt-3`}>Настройка МОГ</h2>
              <p className={`${styles.prototypeMeta} mt-2`}>
                {draft.postType} · {layerLabel} · {formatMinorRub(costLine?.unitPriceMinor ?? null)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className={`${styles.prototypeIconButton} shrink-0`}
              aria-label="Закрыть редактор МОГ"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className={styles.prototypeDrawerBody}>
          <div className={styles.prototypeDrawerStack}>
            <EditorSection title="Основные параметры" eyebrow="Пост и контекст">
              <div className="grid gap-4">
                <label className={styles.prototypeLabel}>
                  Тип поста
                  <select
                    value={draft.postType}
                    onChange={(event) => applyDraft((current) => ({ ...current, postType: event.target.value }))}
                    className={styles.prototypeSelect}
                  >
                    {MOG_POST_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {formatMogOption(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={styles.prototypeLabel}>
                    Количество личного состава
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={draft.personnelCount}
                        onChange={(event) =>
                          applyDraft((current) => ({
                            ...current,
                            personnelCount: sanitizeMogCountInput(event.target.value),
                          }))
                        }
                        className={`${styles.prototypeField} pr-14`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                        чел.
                      </span>
                    </div>
                    <FieldError message={errors.personnelCount} />
                  </label>

                  <label className={styles.prototypeLabel}>
                    Подотчётность
                    <select
                      value={draft.accountability}
                      onChange={(event) => applyDraft((current) => ({ ...current, accountability: event.target.value }))}
                      className={styles.prototypeSelect}
                    >
                      {MOG_ACCOUNTABILITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {formatMogOption(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </EditorSection>

            <EditorSection title="Оснащение" eyebrow="Штатный комплект" tone="muted">
              <div className="space-y-2">
                {draft.equipment?.map((item) => (
                  <div
                    key={item.id}
                    className={styles.prototypeInlineCard}
                  >
                    <div className="min-w-0">
                      <p className={`${styles.prototypeCardTitle} truncate`}>{item.label}</p>
                      <FieldError message={errors.equipment[item.id]} />
                    </div>
                    <Stepper
                      value={parseMogCount(item.quantity)}
                      onDecrease={() => handleEquipmentStep(item.id, -1)}
                      onIncrease={() => handleEquipmentStep(item.id, 1)}
                      ariaLabel={`${item.label}: количество`}
                    />
                  </div>
                ))}
              </div>
            </EditorSection>

            <EditorSection title="Оружие и покрытия" eyebrow="Покрытия на карте" tone="default">
              <div className="space-y-3">
                {draft.weapons?.map((weapon) => {
                  const quantity = parseMogCount(weapon.quantity);
                  const isActive = visibleCoverageWeaponIds.has(weapon.id);
                  const isDisabled = quantity === 0;
                  const color = MOG_WEAPON_COVERAGE_COLORS[weapon.id];
                  const committedAzimuth = clampMogAzimuth(weapon.coverageAzimuth ?? draft.azimuth);
                  const azimuthInputValue = coverageInputs[weapon.id]?.azimuth ?? String(committedAzimuth);
                  const parsedAzimuthInput = Number(azimuthInputValue.replace(",", "."));
                  const dialAzimuth =
                    Number.isInteger(parsedAzimuthInput) && parsedAzimuthInput >= 0 && parsedAzimuthInput <= 359
                      ? normalizeMogAzimuth(parsedAzimuthInput)
                      : committedAzimuth;
                  const committedSector = clampMogSector(weapon.coverageSectorWidthDeg ?? draft.sectorWidthDeg ?? 90);
                  const sectorInputValue = coverageInputs[weapon.id]?.sectorWidthDeg ?? String(committedSector);
                  const parsedSectorInput = Number(sectorInputValue.replace(",", "."));
                  const dialSector =
                    Number.isInteger(parsedSectorInput) && parsedSectorInput >= 1 && parsedSectorInput <= 360
                      ? normalizeMogSectorDial(parsedSectorInput)
                      : committedSector;

                  return (
                    <article
                      key={weapon.id}
                      className={styles.prototypeWeaponCard}
                      data-active={isActive ? "true" : "false"}
                      data-disabled={isDisabled ? "true" : "false"}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: color.stroke }}
                            />
                            <h4 className={`${styles.prototypeCardTitle} truncate`}>{weapon.label}</h4>
                            {isActive ? (
                              <span className={styles.prototypeBadge} style={{ borderColor: color.stroke, color: color.stroke }}>
                                На карте
                              </span>
                            ) : null}
                          </div>
                          <p className={styles.prototypeMeta}>Дальность: {formatMogRange(weapon.rangeM)}</p>
                        </div>
                        <Stepper
                          value={quantity}
                          onDecrease={() => handleWeaponStep(weapon.id, -1)}
                          onIncrease={() => handleWeaponStep(weapon.id, 1)}
                          ariaLabel={`${weapon.label}: количество`}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className={styles.prototypeMeta}>
                          Кол-во: <span className="font-semibold text-slate-700">{quantity}</span>
                        </div>
                        <label
                          className={cn(
                            styles.prototypeButton,
                            "min-h-9 cursor-pointer px-3",
                            isActive && "bg-white",
                            !isActive && "bg-white text-slate-700",
                            isDisabled && "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400",
                          )}
                          style={!isDisabled && isActive ? { borderColor: color.stroke, color: color.stroke } : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={isActive}
                            disabled={isDisabled}
                            onChange={() => handleCoverageToggle(weapon.id)}
                            className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                          />
                          <span>{isActive ? "Покрытие на карте" : "Показать покрытие"}</span>
                        </label>
                      </div>

                      {!isDisabled ? (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label className={styles.prototypeLabel}>
                            Азимут
                            <div className={styles.mogAzimuthControl}>
                              <MogAzimuthDial
                                value={dialAzimuth}
                                color={color.stroke}
                                weaponLabel={weapon.label}
                                onChange={(nextAzimuth) => handleWeaponAzimuthDialChange(weapon.id, nextAzimuth)}
                              />
                              <div className={cn(styles.mogAzimuthInput, "relative")}>
                                <input
                                  type="number"
                                  min={0}
                                  max={359}
                                  step={1}
                                  inputMode="numeric"
                                  value={azimuthInputValue}
                                  onChange={(event) => handleWeaponAzimuthInput(weapon.id, event.target.value)}
                                  onBlur={() => commitWeaponAzimuthInput(weapon.id)}
                                  className={cn(
                                    styles.prototypeField,
                                    "pr-10",
                                    errors.weaponCoverageAzimuth[weapon.id]
                                      ? "border-rose-300 focus:border-rose-400"
                                      : "border-slate-200 focus:border-blue-300",
                                  )}
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                                  °
                                </span>
                              </div>
                            </div>
                            <FieldError message={errors.weaponCoverageAzimuth[weapon.id]} />
                          </label>

                          <label className={styles.prototypeLabel}>
                            Сектор
                            <div className={styles.mogAzimuthControl}>
                              <MogSectorDial
                                value={dialSector}
                                color={color.stroke}
                                weaponLabel={weapon.label}
                                onChange={(nextSector) => handleWeaponSectorDialChange(weapon.id, nextSector)}
                              />
                              <div className={cn(styles.mogSectorInput, "relative")}>
                                <input
                                  type="number"
                                  min={1}
                                  max={360}
                                  step={1}
                                  inputMode="numeric"
                                  value={sectorInputValue}
                                  onChange={(event) => handleWeaponSectorInput(weapon.id, event.target.value)}
                                  onBlur={() => commitWeaponSectorInput(weapon.id)}
                                  className={cn(
                                    styles.prototypeField,
                                    "pr-10",
                                    errors.weaponCoverageSectorWidthDeg[weapon.id]
                                      ? "border-rose-300 focus:border-rose-400"
                                      : "border-slate-200 focus:border-blue-300",
                                  )}
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                                  °
                                </span>
                              </div>
                            </div>
                            <FieldError message={errors.weaponCoverageSectorWidthDeg[weapon.id]} />
                          </label>
                        </div>
                      ) : null}

                      {!isDisabled ? (
                        <p className={`${styles.prototypeMeta} mt-3`}>
                          Это покрытие использует собственные азимут и сектор независимо от остальных типов оружия.
                        </p>
                      ) : null}

                      {isDisabled ? (
                        <p className={`${styles.prototypeMeta} mt-3`}>
                          Добавьте количество, чтобы показать покрытие на карте.
                        </p>
                      ) : null}
                      <FieldError message={errors.weapons[weapon.id]} />
                    </article>
                  );
                })}
              </div>

              <div className={`${styles.prototypeCard} mt-4`}>
                <p className={styles.prototypeEyebrow}>Легенда покрытий</p>
                {visibleCoverageWeapons.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {visibleCoverageWeapons.map((weapon) => (
                      <div key={weapon.id} className={`${styles.prototypeMeta} flex items-center gap-2`}>
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: MOG_WEAPON_COVERAGE_COLORS[weapon.id].stroke }}
                        />
                        <span>
                          {weapon.label} — {formatMogRange(weapon.rangeM)} · {weapon.coverageAzimuth ?? draft.azimuth}° /{" "}
                          {weapon.coverageSectorWidthDeg ?? draft.sectorWidthDeg ?? 90}°
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={`${styles.prototypeMeta} mt-3`}>Покрытия на карте не выбраны.</p>
                )}
              </div>
            </EditorSection>

            <EditorSection title="Стоимость" eyebrow="По указанным ценам" tone="accent">
              <div className="space-y-3">
                <p className={styles.prototypeMeta}>Цена за единицу: {formatMinorRub(costLine?.unitPriceMinor ?? null)}</p>
                <p className="text-base font-semibold text-slate-950">{costLine?.quantity ?? "—"} единиц · {formatMinorRub(costLine?.lineTotalMinor ?? null)}</p>
                <p className={styles.prototypeMeta}>Состав поста сам по себе не задаёт цену. В смету входят явно заданная цена экземпляра, цена комплекта или его финансовые компоненты.</p>
              </div>
            </EditorSection>
          </div>
        </div>

        <footer className={styles.prototypeDrawerFooter}>
          <div className={`${styles.prototypeNotice} flex items-start gap-2`}>
            {hasErrors ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
            <p>
              {hasErrors
                ? "Исправьте ошибки в форме, прежде чем сохранять объект."
                : "Каждое покрытие на карте обновляется сразу со своим азимутом и сектором. Сохранение фиксирует текущую конфигурацию, отмена возвращает исходный вариант."}
            </p>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className={`${styles.prototypeButton} flex-1 px-4`}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={hasErrors || !isDirty}
              className={`${styles.prototypeButtonPrimary} flex-1 px-4`}
            >
              Сохранить изменения
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
