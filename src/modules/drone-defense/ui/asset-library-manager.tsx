"use client";

import { useMemo, useState } from "react";
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  createDefenseAsset,
  deleteDefenseAsset,
  updateDefenseAsset,
} from "@/modules/drone-defense/infra/asset-library-api";
import { assetPriceLabel } from "@/shared/lib/defense-project";
import { provenanceLabel } from "@/shared/lib/data-provenance";
import { emptyForm, formFromAsset, formToAssetInput, type AssetFormState } from "@/modules/drone-defense/domain/asset-library-form";
import styles from "./drone-defense-prototype.module.css";
import { AssetDocumentsPanel } from "./asset-documents-panel";
import type {
  DefenseAsset,
  DefenseAssetCategory,
  DefenseAssetCoverageType,
  PlacedDefenseObject,
} from "@/shared/types/defense-project";

type AssetLibraryManagerProps = {
  assets: DefenseAsset[];
  enterpriseId?: string;
  previewAssets?: DefenseAsset[] | null;
  onApplyPreview: () => boolean;
  onDiscardPreview: () => void;
  placedObjects: PlacedDefenseObject[];
  selectedAssetId?: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onSelectAsset: (assetId: string) => void;
  onAssetSaved: (asset: DefenseAsset) => void;
  onAssetDeleted: (assetId: string) => { ok: true } | { ok: false; message: string };
  onMessage: (message: string) => void;
};


const categoryOptions: Array<{ value: DefenseAssetCategory; label: string }> = [
  { value: "detection", label: "Обнаружение" },
  { value: "classification", label: "Классификация" },
  { value: "jamming", label: "РЭБ" },
  { value: "spoofing", label: "Спуфинг" },
  { value: "kinetic", label: "Поражение" },
  { value: "interceptor", label: "Перехват" },
  { value: "passive-protection", label: "Пассивная защита" },
  { value: "engineering-protection", label: "Инженерная защита" },
  { value: "infrastructure", label: "Инфраструктура" },
  { value: "command-center", label: "Командный центр" },
  { value: "early-warning", label: "Раннее предупреждение" },
  { value: "software", label: "ПО" },
  { value: "external-service", label: "Внешний сервис" },
];

const coverageTypeOptions: Array<{ value: DefenseAssetCoverageType; label: string }> = [
  { value: "circle", label: "Круг" },
  { value: "sector", label: "Сектор" },
  { value: "line", label: "Линия" },
  { value: "polygon", label: "Полигон" },
  { value: "none", label: "Нет" },
];


export function AssetLibraryManager({
  assets,
  enterpriseId, previewAssets, onApplyPreview, onDiscardPreview,
  placedObjects,
  selectedAssetId,
  loading,
  error,
  onRefresh,
  onSelectAsset,
  onAssetSaved,
  onAssetDeleted,
  onMessage,
}: AssetLibraryManagerProps) {
  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId],
  );
  const [form, setForm] = useState<AssetFormState>(() => (selectedAsset ? formFromAsset(selectedAsset) : emptyForm(enterpriseId)));
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const usedAssetIds = useMemo(() => new Set(placedObjects.map((object) => object.assetId)), [placedObjects]);
  const selectedAssetUsed = Boolean(selectedAsset && usedAssetIds.has(selectedAsset.id));

  const startCreate = () => {
    setMode("create");
    setForm(emptyForm(enterpriseId));
    setLocalError(null);
  };

  const startEdit = () => {
    if (!selectedAsset) return;
    setMode("edit");
    setForm(formFromAsset(selectedAsset));
    onSelectAsset(selectedAsset.id);
    setLocalError(null);
  };

  const saveAsset = async () => {
    if (!form.name.trim()) {
      setLocalError("Укажите название средства защиты.");
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      const payload = formToAssetInput(form);
      const asset = mode === "edit" && form.id
        ? await updateDefenseAsset(form.id, payload)
        : await createDefenseAsset(payload);
      onAssetSaved(asset);
      onSelectAsset(asset.id);
      setMode("edit");
      setForm(formFromAsset(asset));
      onMessage(`${asset.name} сохранено в библиотеке. Проверьте обновление данных проекта.`);
    } catch (error) {
      setLocalError(error instanceof Error && !("status" in error) ? error.message : "Не удалось сохранить карточку на сервере. Проверьте источник и доступ к библиотеке.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedAsset = async () => {
    if (!selectedAsset) return;
    if (selectedAssetUsed) {
      setLocalError("Средство уже размещено на карте. Удаление заблокировано.");
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      await deleteDefenseAsset(selectedAsset.id);
      const result = onAssetDeleted(selectedAsset.id);
      if (!result.ok) {
        setLocalError(result.message);
        return;
      }
      setMode("closed");
      setForm(emptyForm(enterpriseId));
      onMessage(`${selectedAsset.name} удалено из библиотеки`);
    } catch {
      setLocalError("Не удалось удалить карточку на сервере.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.prototypeSection}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={styles.prototypeEyebrow}>Управление карточками</p>
          <p className={`${styles.prototypeMeta} truncate`}>{assets.length} средств в текущей библиотеке</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={`${styles.prototypeIconButton} cursor-pointer disabled:cursor-wait`}
            onClick={() => void onRefresh()}
            disabled={loading}
            title="Обновить каталог с сервера"
            aria-label="Обновить каталог с сервера"
          >
            <ReloadOutlined />
          </button>
          <button
            type="button"
            className={`${styles.prototypeButtonPrimary} w-8 cursor-pointer`}
            onClick={startCreate}
            title="Создать средство защиты"
            aria-label="Создать средство защиты"
          >
            <PlusOutlined />
          </button>
          <button
            type="button"
            className={`${styles.prototypeIconButton} cursor-pointer`}
            onClick={startEdit}
            disabled={!selectedAsset}
            title="Редактировать выбранное средство"
            aria-label="Редактировать выбранное средство"
          >
            <EditOutlined />
          </button>
        </div>
      </div>

      {loading ? <p className={`${styles.prototypeMeta} mt-2 text-blue-600`}>Загрузка библиотеки…</p> : null}
      {error ? <p className={`${styles.prototypeNoticeWarning} mt-2`}>{error}</p> : null}
      {localError ? <p className={`${styles.prototypeNoticeDanger} mt-2`}>{localError}</p> : null}

      {selectedAsset && <p className="mt-2 text-sm" data-testid="asset-provenance">{provenanceLabel(selectedAsset.fieldProvenance?.unitPriceMinor ?? selectedAsset.fieldProvenance?.pricePerUnitMln ?? selectedAsset.provenance)} · {assetPriceLabel(selectedAsset)}</p>}
      {previewAssets && <section className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3" aria-label="Просмотр изменений каталога">
        <h3 className="font-medium">Обновить данные проекта</h3>
        <p className="text-sm">Изменения станут черновиком. Сохранённые версии и цены экземпляров сохранятся.</p>
        {previewAssets.filter(asset=>JSON.stringify(asset)!==JSON.stringify(assets.find(item=>item.id===asset.id))).map(asset=>{
          const before=assets.find(item=>item.id===asset.id);
          return <div key={asset.id} className="border-t border-amber-200 pt-2 text-sm"><p>{before?.name ?? "Новая карточка"} → {asset.name}</p><p>{before ? assetPriceLabel(before) : "—"} → {assetPriceLabel(asset)}</p><p>{provenanceLabel(asset.provenance)}</p><details><summary className="min-h-11 cursor-pointer py-2">Изменённые поля карточки</summary><dl>{Object.keys(asset).filter(key=>JSON.stringify(asset[key as keyof DefenseAsset])!==JSON.stringify(before?.[key as keyof DefenseAsset])).map(key=><div key={key} className="my-2 break-words"><dt className="font-medium">{key}</dt><dd className="whitespace-pre-wrap break-all">{JSON.stringify(before?.[key as keyof DefenseAsset]) ?? "—"} → {JSON.stringify(asset[key as keyof DefenseAsset]) ?? "—"}</dd></div>)}</dl></details></div>;
        })}
        <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded border px-3" onClick={()=>{if(!onApplyPreview())setLocalError("Проект изменился. Запросите обновление каталога ещё раз.");}}>Применить к черновику</button><button type="button" className="min-h-11 rounded border px-3" onClick={onDiscardPreview}>Отменить обновление</button></div>
      </section>}

      {mode !== "closed" ? (
        <div className={`${styles.prototypeFormCard} mt-3 grid gap-2 bg-slate-50 p-2`}>
          <div className="flex items-center justify-between gap-2">
            <p className={styles.prototypeCardTitle}>
              {mode === "create" ? "Новая карточка" : "Редактирование"}
            </p>
            <button
              type="button"
              className={`${styles.prototypeIconButton} cursor-pointer`}
              onClick={() => setMode("closed")}
              title="Закрыть форму"
              aria-label="Закрыть форму"
            >
              <CloseOutlined />
            </button>
          </div>

          <input
            className={styles.prototypeField}
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            aria-label="Название"
              placeholder="Название"
          />

          <div className="grid grid-cols-2 gap-2">
            <select
              className={styles.prototypeSelect}
              aria-label="Категория средства"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({ ...current, category: event.target.value as DefenseAssetCategory }))
              }
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className={styles.prototypeSelect}
              aria-label="Тип покрытия"
              value={form.coverageType}
              onChange={(event) =>
                setForm((current) => ({ ...current, coverageType: event.target.value as DefenseAssetCoverageType }))
              }
            >
              {coverageTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              className={styles.prototypeField}
              value={form.protectionType}
              onChange={(event) => setForm((current) => ({ ...current, protectionType: event.target.value }))}
              aria-label="Тип защиты"
              placeholder="Тип защиты"
            />
            <input
              className={styles.prototypeField}
              value={form.recommendedLayerCodes}
              onChange={(event) => setForm((current) => ({ ...current, recommendedLayerCodes: event.target.value }))}
              aria-label="Эшелоны: L2, L3"
              placeholder="Эшелоны: L2, L3"
            />
          </div>

          {form.priceError && <p role="alert" className="text-sm text-red-700">{form.priceError}</p>}
          <div className="grid grid-cols-3 gap-2">
            <input
              className={styles.prototypeField}
              value={form.pricePerUnitMln}
              onChange={(event) => setForm((current) => ({ ...current, pricePerUnitMln: event.target.value, priceError: undefined, sourceQuality: current.sourceQuality === "demo" ? "demo" : "estimated" }))}
              aria-label="млн ₽"
              placeholder="млн ₽"
              inputMode="decimal"
            />
            <input
              className={styles.prototypeField}
              value={form.coverageRadiusKm}
              onChange={(event) => setForm((current) => ({ ...current, coverageRadiusKm: event.target.value }))}
              aria-label="радиус, км"
              placeholder="радиус, км"
              inputMode="decimal"
            />
            <input
              className={styles.prototypeField}
              value={form.coverageAngle}
              onChange={(event) => setForm((current) => ({ ...current, coverageAngle: event.target.value }))}
              aria-label="угол"
              placeholder="угол"
              inputMode="decimal"
            />
          </div>

          <input
            className={styles.prototypeField}
            value={form.maxEffectiveDistanceKm}
            onChange={(event) => setForm((current) => ({ ...current, maxEffectiveDistanceKm: event.target.value }))}
            aria-label="максимальная дальность, км"
              placeholder="максимальная дальность, км"
            inputMode="decimal"
          />

          <textarea
            className={`${styles.prototypeTextarea} min-h-16 resize-y`}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            aria-label="Описание"
              placeholder="Описание"
          />

          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium">Источник карточки и цены</legend>
            <label className="block text-sm">Качество данных<select aria-label="Качество данных" className={styles.prototypeSelect} value={form.sourceQuality} disabled={form.original?.provenance?.quality === "demo"} onChange={event=>setForm(current=>({...current,sourceQuality:event.target.value as AssetFormState["sourceQuality"]}))}><option value="unknown">Источник не указан</option><option value="estimated">Оценка</option><option value="confirmed">Подтверждено пользователем</option><option value="demo">Демонстрационные данные</option></select></label>
            <label className="block text-sm">Описание источника<input className={styles.prototypeField} value={form.sourceLabel} onChange={event=>setForm(current=>({...current,sourceLabel:event.target.value}))}/></label>
            <label className="block text-sm">Дата источника<input type="date" className={styles.prototypeField} value={form.sourceDate} onChange={event=>setForm(current=>({...current,sourceDate:event.target.value}))}/></label>
            <label className="block text-sm">Ссылка на источник<input type="url" className={styles.prototypeField} value={form.sourceUrl} onChange={event=>setForm(current=>({...current,sourceUrl:event.target.value}))}/></label>
            {form.sourceDocumentId && <p className="break-all text-sm">Документ: {form.sourceDocumentId} <button type="button" className="min-h-11 px-2 underline" onClick={()=>setForm(current=>({...current,sourceDocumentId:null}))}>Убрать ссылку</button></p>}
            <p className="text-sm text-slate-600">Подтверждение означает проверку ответственным пользователем. Fortis не сертифицирует источник независимо. Для замены демонстрационных данных создайте карточку по данным заказчика.</p>
          </fieldset>
          {mode === "edit" && form.id && <AssetDocumentsPanel key={form.id} assetId={form.id} onSourceSelected={document=>setForm(current=>({...current,sourceDocumentId:document.id,sourceLabel:current.sourceLabel||document.name,sourceQuality:current.sourceQuality === "unknown" ? "estimated" : current.sourceQuality}))}/>}

          <label className={`${styles.prototypeInlineCard} text-xs text-slate-600`}>
            <span>Общий каталог</span>
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) => setForm((current) => ({ ...current, isPublic: event.target.checked }))}
            />
          </label>

          {!form.isPublic ? (
            <input
              className={styles.prototypeField}
              value={form.enterpriseId}
              onChange={(event) => setForm((current) => ({ ...current, enterpriseId: event.target.value }))}
              aria-label="enterpriseId"
              placeholder="enterpriseId"
            />
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${styles.prototypeButtonPrimary} flex-1 cursor-pointer px-3 disabled:cursor-wait`}
              onClick={() => void saveAsset()}
              disabled={saving}
            >
              <SaveOutlined />
              Сохранить
            </button>
            {mode === "edit" ? (
              <button
                type="button"
                className={`${styles.prototypeButtonDanger} w-10 cursor-pointer`}
                onClick={() => void deleteSelectedAsset()}
                disabled={saving || selectedAssetUsed}
                title={selectedAssetUsed ? "Средство размещено на карте" : "Удалить средство защиты"}
                aria-label="Удалить средство защиты"
              >
                <DeleteOutlined />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
