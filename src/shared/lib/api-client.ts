import { sessionGeneration, setAuthenticatedIdentity } from "./session-state";

type ApiQueryValue = string | number | boolean | null | undefined;

export type ApiQueryParams = Record<string, ApiQueryValue>;

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: ApiQueryParams;
  fetcher?: typeof fetch;
};

export type ApiJsonReadOptions = Omit<ApiRequestOptions, "body">;

export type ApiJsonWriteOptions = Omit<ApiRequestOptions, "body"> & {
  body?: unknown;
};

export class FortisApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly code?: string;
  readonly body?: unknown;
  readonly requestId?: string;

  constructor(response: Response, body?: unknown) {
    const outer = isRecord(body) ? body : undefined;
    const payload = isRecord(outer?.error) ? outer.error : outer;
    const codes: Record<number, string> = { 401: "unauthenticated", 403: "forbidden", 404: "not_found", 409: "version_conflict", 502: "backend_unreachable", 504: "backend_timeout" };
    const messages: Record<number, string> = { 401: "Сессия отсутствует или истекла. Войдите снова.", 403: "Доступ запрещён.", 404: "Объект не найден.", 409: "Конфликт версии проекта.", 502: "Не удалось связаться с сервером.", 504: "Сервер не ответил вовремя." };
    super(typeof payload?.message === "string" ? payload.message : messages[response.status] ?? `Ошибка сервера (${response.status})`);
    this.name = "FortisApiError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.code = typeof payload?.code === "string" ? payload.code : codes[response.status] ?? "backend_error";
    this.requestId = response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id") ?? (typeof payload?.requestId === "string" ? payload.requestId : undefined);
    this.body = body;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appendQuery(path: string, query?: ApiQueryParams) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }

  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function buildApiV1Url(path: string, query?: ApiQueryParams) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiPath = normalizedPath.startsWith("/api/v1") ? normalizedPath : `/api/v1${normalizedPath}`;
  return appendQuery(apiPath, query);
}

export class FortisProtocolError extends Error {
  readonly code = "protocol_error";
  readonly status = 502;
  constructor(readonly requestId?: string) { super("Сервер вернул некорректные данные."); this.name = "FortisProtocolError"; }
}

export function requireListItems<T>(value: unknown): T[] {
  const items = Array.isArray(value) ? value : isRecord(value) ? value.items : undefined;
  if (!Array.isArray(items)) throw new FortisProtocolError();
  return items as T[];
}

export async function readJson<T>(input: RequestInfo | URL, init?: RequestInit & { fetcher?: typeof fetch }): Promise<T> {
  const generation = sessionGeneration();
  const { fetcher = fetch, ...requestInit } = init ?? {};
  let response: Response;
  try { response = await fetcher(input, requestInit); } catch {
    throw new FortisApiError(new Response(null, { status: 502 }));
  }
  const text = await response.text();
  if (generation !== sessionGeneration()) throw new DOMException("Identity changed", "AbortError");
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch {
    if (response.ok) throw new FortisProtocolError(response.headers.get("x-request-id") ?? undefined);
    body = text;
  }
  if (!response.ok) {
    if (response.status === 401) {
      setAuthenticatedIdentity(null);
      if (typeof window !== "undefined") window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    if (typeof window !== "undefined" && [403, 404].includes(response.status)) window.dispatchEvent(new CustomEvent("fortis-access-error", { detail: { status: response.status, input: String(input) } }));
    throw new FortisApiError(response, body);
  }
  if (response.status !== 204 && body === undefined) throw new FortisProtocolError(response.headers.get("x-request-id") ?? undefined);
  return body as T;
}

function withJsonContentType(headers?: HeadersInit) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  return requestHeaders;
}

function requestApiJson<T>(path: string, method: string, options: ApiRequestOptions = {}) {
  const { body, headers, query, fetcher, ...init } = options;
  const hasBody = body !== undefined;
  return readJson<T>(buildApiV1Url(path, query), {
    ...init,
    method,
    headers: hasBody ? withJsonContentType(headers) : headers,
    body: hasBody ? JSON.stringify(body) : undefined,
    fetcher,
  });
}

export function getApiJson<T>(path: string, options: ApiJsonReadOptions = {}) {
  return requestApiJson<T>(path, "GET", options);
}

export function postApiJson<T>(path: string, options: ApiJsonWriteOptions = {}) {
  return requestApiJson<T>(path, "POST", options);
}

export function putApiJson<T>(path: string, options: ApiJsonWriteOptions = {}) {
  return requestApiJson<T>(path, "PUT", options);
}

export function deleteApiJson<T>(path: string, options: ApiJsonWriteOptions = {}) {
  return requestApiJson<T>(path, "DELETE", options);
}

export function readApiJson<T>(path: string, options: ApiJsonReadOptions = {}) {
  return getApiJson<T>(path, options);
}

export function writeApiJson<T>(path: string, options: ApiJsonWriteOptions = {}) {
  const method = options.method?.toUpperCase();
  switch (method) {
    case undefined:
    case "POST":
      return postApiJson<T>(path, options);
    case "PUT":
      return putApiJson<T>(path, options);
    case "DELETE":
      return deleteApiJson<T>(path, options);
    default:
      return requestApiJson<T>(path, method, options);
  }
}
