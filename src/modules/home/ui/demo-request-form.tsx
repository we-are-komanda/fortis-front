"use client";

import { useEffect, useRef, useState } from "react";
import { FortisApiError, isRecord } from "@/shared/lib/api-client";
import { getDemoRequestConfiguration, sendDemoRequest, type DemoRequestConfiguration, type DemoRequestInput } from "../infra/demo-request-api";

type Fields = Omit<DemoRequestInput, "consentVersion">;
type FieldErrors = Partial<Record<keyof Fields, string>>;
type FormFailure = { message: string; requestId?: string; consentChanged?: boolean };
const emptyFields: Fields = { name: "", organization: "", email: "", comment: "", consent: false };
const fieldMessages = {
  name: "Укажите имя: от 2 до 120 символов.",
  organization: "Укажите организацию: от 1 до 200 символов.",
  email: "Укажите корректный email длиной до 254 символов.",
  comment: "Комментарий должен содержать не больше 2000 символов.",
  consent: "Для отправки необходимо согласие с опубликованным текстом.",
};
const inputClassName = "min-h-11 w-full rounded-xl border border-slate-300 dark:border-white/20 bg-white dark:bg-white/5 px-4 py-3 text-base text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60";

function validate(input: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const size = (value: string) => [...value.trim()].length;
  if (size(input.name) < 2 || size(input.name) > 120 || /[\r\n\x00]/.test(input.name)) errors.name = fieldMessages.name;
  if (size(input.organization) < 1 || size(input.organization) > 200 || /[\r\n\x00]/.test(input.organization)) errors.organization = fieldMessages.organization;
  if (size(input.email) > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) errors.email = fieldMessages.email;
  if (size(input.comment) > 2000) errors.comment = fieldMessages.comment;
  if (!input.consent) errors.consent = fieldMessages.consent;
  return errors;
}

export function DemoRequestForm() {
  const [configuration, setConfiguration] = useState<DemoRequestConfiguration | null>(null);
  const [configurationAttempt, setConfigurationAttempt] = useState(0);
  const [configurationError, setConfigurationError] = useState<FormFailure | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<FormFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const pending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDemoRequestConfiguration().then((config) => {
      if (!cancelled) setConfiguration(config);
    }).catch((error: unknown) => {
      if (!cancelled) setConfigurationError({ message: "Не удалось проверить доступность формы. Попробуйте ещё раз.", requestId: error instanceof FortisApiError ? error.requestId : undefined });
    });
    return () => { cancelled = true; };
  }, [configurationAttempt]);

  function refreshConfiguration() {
    setConfiguration(null);
    setConfigurationError(null);
    setFields((current) => ({ ...current, consent: false }));
    setFailure(null);
    setFieldErrors({});
    setConfigurationAttempt((current) => current + 1);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || receipt || !configuration?.enabled) return;
    const errors = validate(fields);
    setFieldErrors(errors);
    setFailure(null);
    if (Object.keys(errors).length) {
      event.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(errors)[0]}"]`)?.focus();
      return;
    }
    const input: DemoRequestInput = { name: fields.name.trim(), organization: fields.organization.trim(), email: fields.email.trim().toLowerCase(), comment: fields.comment.trim(), consent: true, consentVersion: configuration.consentVersion };
    const body = JSON.stringify(input);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    pending.current = true;
    setSubmitting(true);
    try {
      const accepted = await sendDemoRequest(input, attempt.current.key);
      setReceipt(accepted.requestId);
    } catch (error) {
      const apiError = error instanceof FortisApiError ? error : undefined;
      const outer = apiError?.body;
      const detail = isRecord(outer) && isRecord(outer.error) ? outer.error.details : undefined;
      const invalid = isRecord(detail) && isRecord(detail.fields) ? detail.fields : {};
      const serverErrors: FieldErrors = {};
      for (const field of Object.keys(fieldMessages) as (keyof Fields)[]) if (field in invalid) serverErrors[field] = fieldMessages[field];
      const consentChanged = "consentVersion" in invalid;
      if (consentChanged) serverErrors.consent = "Текст согласия обновлён. Загрузите его и подтвердите согласие заново.";
      setFieldErrors(serverErrors);
      const message = apiError?.status === 400 ? "Проверьте отмеченные поля. Заявка не принята."
        : apiError?.status === 429 ? `Слишком много попыток. ${apiError.retryAfter ? `Повторите через ${apiError.retryAfter} сек.` : "Повторите позже."}`
        : apiError?.status === 409 ? "Не удалось повторить эту отправку. Обновите страницу перед новой попыткой."
        : "Не удалось подтвердить получение заявки. Введённые данные сохранены в форме; повторите отправку.";
      setFailure({ message, requestId: apiError?.requestId, consentChanged });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  if (receipt) return <p role="status" className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-base text-emerald-700 dark:text-emerald-300">Заявка получена. Номер: {receipt}</p>;
  if (configurationError) return <div className="mt-6 space-y-3">
    <p role="alert">{configurationError.message}{configurationError.requestId && <span className="block text-sm">Номер обращения для поддержки: {configurationError.requestId}</span>}</p>
    <button type="button" onClick={refreshConfiguration} className="min-h-11 rounded-xl border border-slate-300 px-4">Проверить ещё раз</button>
  </div>;
  if (!configuration) return <p role="status" className="mt-6 text-slate-500 dark:text-slate-400">Проверяем доступность формы…</p>;
  if (!configuration.enabled) return <p role="status" className="mt-6 text-slate-500 dark:text-slate-400">Приём заявок сейчас недоступен. Данные не отправляются и заявка не создаётся.</p>;

  return <form noValidate onSubmit={submit} aria-busy={submitting} className="mt-8 space-y-5 text-left">
    {!failure && Object.keys(fieldErrors).length > 0 && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">Проверьте отмеченные поля.</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      {(["name", "organization", "email"] as const).map((field) => <div key={field} className={field === "email" ? "sm:col-span-2" : undefined}>
        <label htmlFor={`demo-${field}`} className="mb-2 block text-sm font-semibold">{field === "name" ? "Имя" : field === "organization" ? "Организация" : "Email"}</label>
        <input id={`demo-${field}`} name={field} type={field === "email" ? "email" : "text"} autoComplete={field === "organization" ? "organization" : field} required disabled={submitting} value={fields[field]} onChange={(event) => setFields({ ...fields, [field]: event.target.value })} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={fieldErrors[field] ? `demo-${field}-error` : undefined} className={inputClassName} />
        {fieldErrors[field] && <p id={`demo-${field}-error`} className="mt-1 text-sm text-rose-700 dark:text-rose-300">{fieldErrors[field]}</p>}
      </div>)}
    </div>
    <div>
      <label htmlFor="demo-comment" className="mb-2 block text-sm font-semibold">Комментарий</label>
      <textarea id="demo-comment" name="comment" rows={4} disabled={submitting} value={fields.comment} onChange={(event) => setFields({ ...fields, comment: event.target.value })} aria-invalid={Boolean(fieldErrors.comment)} aria-describedby={fieldErrors.comment ? "demo-comment-error" : "demo-comment-hint"} className={inputClassName} />
      <p id={fieldErrors.comment ? "demo-comment-error" : "demo-comment-hint"} className={`mt-1 text-sm ${fieldErrors.comment ? "text-rose-700 dark:text-rose-300" : "text-slate-500 dark:text-slate-400"}`}>{fieldErrors.comment ?? "Необязательно. До 2000 символов."}</p>
    </div>
    <div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed">
        <input name="consent" type="checkbox" required disabled={submitting} checked={fields.consent} onChange={(event) => setFields({ ...fields, consent: event.target.checked })} aria-invalid={Boolean(fieldErrors.consent)} aria-describedby={fieldErrors.consent ? "demo-consent-error" : undefined} className="mt-1 h-5 w-5 shrink-0 accent-sky-600" />
        <span className="whitespace-pre-line">{configuration.consentText}</span>
      </label>
      {fieldErrors.consent && <p id="demo-consent-error" className="mt-1 text-sm text-rose-700 dark:text-rose-300">{fieldErrors.consent}</p>}
    </div>
    {failure && <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
      <p>{failure.message}</p>
      {failure.requestId && <p className="mt-2 break-words">Номер обращения для поддержки: {failure.requestId}</p>}
      {failure.consentChanged && <button type="button" onClick={refreshConfiguration} className="mt-2 min-h-11 underline">Обновить текст согласия</button>}
    </div>}
    <button type="submit" disabled={submitting || failure?.consentChanged} className="min-h-11 w-full rounded-xl bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Отправляем…" : failure ? "Повторить отправку" : "Запросить демонстрацию"}</button>
  </form>;
}
