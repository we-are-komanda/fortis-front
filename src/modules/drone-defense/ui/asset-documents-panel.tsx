"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createAssetDocument, deleteAssetDocument, downloadAssetDocument, listAssetDocuments, validateAssetDocumentFile, type AssetDocument, type AssetDocumentPage } from "@/modules/drone-defense/infra/asset-documents-api";
import { FortisApiError } from "@/shared/lib/api-client";
import { useSessionStore } from "@/shared/lib/session-state";
import styles from "./drone-defense-prototype.module.css";

type AssetDocumentsPanelProps = { assetId: string; onSourceSelected?: (document: AssetDocument) => void };
const statusLabels: Record<AssetDocument["status"], string> = {
  ready: "Готов к скачиванию",
  quarantined: "На проверке — скачивание недоступно",
  rejected: "Отклонён проверкой",
  legacy_unavailable: "Старый файл недоступен",
};

function errorMessage(error: unknown) {
  let message = "Не удалось выполнить операцию с документом. Повторите попытку.";
  if (error instanceof FortisApiError) {
    if (error.status === 503) message = "Проверка файлов или хранилище недоступны. Операция не завершена. Повторите попытку позже.";
    else if (error.status === 413) message = "Размер файла не должен превышать 10 МиБ.";
    else if (error.status === 415) message = "Содержимое файла не соответствует допустимому формату PDF, PNG, JPEG или TXT.";
    else if (error.status === 422) message = "Файл отклонён проверкой и недоступен для скачивания.";
    else if (error.status === 401) message = "Сессия истекла. Войдите снова.";
    else if (error.status === 403 || error.status === 404) message = "Документ или карточка недоступны. Проверьте доступ к библиотеке.";
    else if (error.status === 429) message = `Слишком много запросов. ${error.retryAfter === undefined ? "Повторите позже." : `Повторите через ${error.retryAfter} с.`}`;
  }
  const requestId = error && typeof error === "object" && "requestId" in error ? error.requestId : null;
  return typeof requestId === "string" ? `${message} Код обращения: ${requestId}` : message;
}

export function AssetDocumentsPanel(props: AssetDocumentsPanelProps) {
  const generation = useSessionStore(state => state.generation);
  const invalid = useSessionStore(state => state.invalid);
  if (invalid) return <p role="alert">Сессия истекла. Войдите снова.</p>;
  return <DocumentsForAsset key={`${generation}:${props.assetId}`} {...props} />;
}

function DocumentsForAsset({ assetId, onSourceSelected }: AssetDocumentsPanelProps) {
  const fileId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const actions = useRef(new Set<AbortController>());
  const [file, setFile] = useState<File | null>(null);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${offset}:${refresh}`;
  const [view, setView] = useState<AssetDocumentPage & { key: string; error: string | null }>({ key: "", items: [], totalItems: 0, error: null });
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileError = file ? validateAssetDocumentFile(file) : null;
  const loading = view.key !== requestKey;
  const busy = pending || loading;
  const refreshList = () => { setOffset(0); setRefresh(value => value + 1); };

  useEffect(() => {
    const controllers = actions.current;
    return () => { controllers.forEach(controller => controller.abort()); controllers.clear(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void listAssetDocuments(assetId, { offset, signal: controller.signal }).then(page => {
      if (!controller.signal.aborted) setView({ ...page, key: requestKey, error: null });
    }, error => {
      if (!controller.signal.aborted) setView({ key: requestKey, items: [], totalItems: 0, error: errorMessage(error) });
    });
    return () => controller.abort();
  }, [assetId, offset, requestKey]);

  const runAction = async (operation: (signal: AbortSignal) => Promise<string>, refreshAfter: boolean) => {
    if (actions.current.size) return;
    const controller = new AbortController();
    actions.current.add(controller);
    setPending(true); setActionError(null); setMessage(null);
    try {
      const result = await operation(controller.signal);
      if (!controller.signal.aborted) setMessage(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof FortisApiError && [403, 404].includes(error.status)) setView({ key: requestKey, items: [], totalItems: 0, error: errorMessage(error) });
        else setActionError(errorMessage(error));
      }
    } finally {
      actions.current.delete(controller);
      if (!controller.signal.aborted) {
        setPending(false);
        // Failed scans can leave a quarantined/rejected document: refresh without clearing the file.
        if (refreshAfter) refreshList();
      }
    }
  };

  const upload = () => {
    if (!file || fileError || busy) return;
    void runAction(async signal => {
      const document = await createAssetDocument({ assetId, file }, signal);
      if (!signal.aborted) {
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
      }
      return document.status === "ready" ? "Файл загружен и проверен." : statusLabels[document.status];
    }, true);
  };
  const download = (document: AssetDocument) => void runAction(async signal => {
    const blob = await downloadAssetDocument(document, signal);
    if (signal.aborted) return "";
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.name.replace(/[/\\]/g, "_");
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "Файл передан для скачивания.";
  }, false);

  return <section className={`${styles.prototypeFormCard} mt-3 min-w-0 space-y-3 p-3`} aria-label="Документы карточки" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={styles.prototypeCardTitle}>Документы карточки</h3>
      <button type="button" className={`${styles.prototypeButtonGhost} min-h-11 px-3`} disabled={busy} onClick={refreshList}>Обновить документы</button>
    </div>
    <p className="text-sm">Приватные вложения. Скачивание доступно после проверки файла.</p>
    <div className="space-y-2">
      <label htmlFor={fileId} className="block text-sm font-medium">Файл документа</label>
      <input ref={fileInput} id={fileId} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" className="block min-h-11 w-full min-w-0 text-sm" disabled={pending} aria-invalid={Boolean(fileError)} aria-describedby={`${fileId}-help${fileError ? ` ${fileId}-error` : ""}`} onChange={event => { setFile(event.target.files?.[0] ?? null); setActionError(null); setMessage(null); }} />
      <p id={`${fileId}-help`} className="text-sm">PDF, PNG, JPEG или TXT, не более 10 МиБ. Сервер проверит содержимое файла.</p>
      {fileError && <p id={`${fileId}-error`} role="alert" className={styles.prototypeNoticeDanger}>{fileError}</p>}
      <button type="button" className={`${styles.prototypeButtonPrimary} min-h-11 px-3`} disabled={!file || Boolean(fileError) || busy || Boolean(view.error)} onClick={upload}>{pending ? "Обработка…" : "Загрузить файл"}</button>
    </div>
    {actionError && <p role="alert" className={`${styles.prototypeNoticeDanger} break-words`}>{actionError}</p>}
    {view.error && <p role="alert" className={`${styles.prototypeNoticeDanger} break-words`}>{view.error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {loading && <p className="text-sm" role="status">Загрузка документов…</p>}
    {!loading && !view.error && view.items.length === 0 && <p className="text-sm">Документы пока не загружены.</p>}
    <ul className="space-y-3">
      {view.items.map(document => <li key={document.id} className="min-w-0 space-y-1 border-t border-slate-200 pt-3">
        <p className="break-words text-sm font-medium">{document.name}</p>
        <p className="text-sm">{statusLabels[document.status]}</p>
        <p className="break-words text-sm">Версия {document.revision} · {document.sizeBytes.toLocaleString("ru-RU")} байт</p>
        <p className="break-all text-sm">SHA-256: {document.checksum ?? "не указан"}</p>
        <div className="flex flex-wrap gap-2">
          {document.status === "ready" && <button type="button" className={`${styles.prototypeButtonGhost} min-h-11 px-3`} disabled={busy} onClick={() => download(document)}>Скачать</button>}
          {document.status === "ready" && onSourceSelected && <button type="button" className={`${styles.prototypeButtonGhost} min-h-11 px-3`} disabled={busy} onClick={() => onSourceSelected(document)}>Использовать как источник</button>}
          <button type="button" className={`${styles.prototypeButtonGhost} min-h-11 px-3`} disabled={busy} onClick={() => void runAction(async signal => { await deleteAssetDocument(document.id, signal); return "Документ удалён из активного списка."; }, true)}>Удалить документ</button>
        </div>
      </li>)}
    </ul>
    {(offset > 0 || offset + view.items.length < view.totalItems) && <nav aria-label="Страницы документов" className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className={`${styles.prototypeButtonGhost} min-h-11 px-3`} disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Назад</button>
      <span>{offset + 1}–{offset + view.items.length} из {view.totalItems}</span>
      <button type="button" className={`${styles.prototypeButtonGhost} min-h-11 px-3`} disabled={busy || offset + view.items.length >= view.totalItems} onClick={() => setOffset(offset + 50)}>Далее</button>
    </nav>}
  </section>;
}
