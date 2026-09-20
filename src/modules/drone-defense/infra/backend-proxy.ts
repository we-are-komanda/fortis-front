import { backendTimeoutMs, getRuntimeMode, resolveBackendBaseUrl } from "@/shared/server/runtime-config";

export { resolveBackendBaseUrl as getBackendApiBaseUrl };

function requestId(headers?: Headers) {
  const value = headers?.get("x-request-id") ?? headers?.get("x-correlation-id");
  return value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

export function boundaryError(status: number, code: string, message: string, id = crypto.randomUUID()) {
  return Response.json({ error: { code, message, requestId: id, retryable: false } }, {
    status, headers: { "x-request-id": id, "cache-control": "no-store" },
  });
}

export function accessTokenFromRequest(request: Request): string | null {
  const match = request.headers.get("cookie")?.match(/(?:^|;\s*)access-token=([^;]+)/);
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}

const responseHeaders = ["content-type", "content-disposition", "content-range", "accept-ranges", "etag", "last-modified", "retry-after", "www-authenticate", "x-correlation-id"];

// Transparent HTTP boundary. JSON adapters below opt in to parsing explicitly.
export async function forwardBackendRequest(path: string, init: RequestInit = {}, options: { request?: Request; readiness?: boolean } = {}): Promise<Response> {
  const id = requestId(options.request?.headers);
  let target: URL;
  let timeout: number;
  try {
    if (getRuntimeMode() === "demo") return boundaryError(404, "workspace_only", "Backend operations are unavailable in demo mode", id);
    const base = resolveBackendBaseUrl();
    if (!path.startsWith("/") || path.startsWith("//") || /[\\#]/.test(path)) throw new Error("Invalid backend path");
    target = new URL(options.readiness ? `${new URL(base).origin}/_/readiness` : `${base}${path}`);
    if (target.origin !== new URL(base).origin || (!options.readiness && !target.pathname.startsWith("/api/v1/"))) throw new Error("Invalid backend path");
    timeout = backendTimeoutMs(target.pathname.startsWith("/api/v1/assets/documents"));
  } catch {
    return boundaryError(503, "configuration_error", "Backend configuration is unavailable", id);
  }
  const headers = new Headers();
  for (const name of ["accept", "content-type", "range", "if-range", "if-none-match", "if-modified-since", "authorization"]) {
    const value = new Headers(init.headers).get(name) ?? options.request?.headers.get(name);
    if (value) headers.set(name, value);
  }
  const token = options.request && accessTokenFromRequest(options.request);
  if (token) {
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    headers.set("cookie", `access-token=${encodeURIComponent(token)}`);
  }
  headers.set("x-request-id", id);
  const deadline = AbortSignal.timeout(timeout);
  const signal = options.request ? AbortSignal.any([deadline, options.request.signal]) : deadline;
  try {
    const method = init.method ?? options.request?.method ?? "GET";
    const body = init.body ?? (method === "GET" || method === "HEAD" ? undefined : options.request?.body);
    const upstream = await fetch(target, { ...init, method, body, headers, signal, redirect: "manual", cache: "no-store", ...(body ? { duplex: "half" } : {}) } as RequestInit);
    const outgoing = new Headers({ "cache-control": "no-store", "x-request-id": requestId(upstream.headers.has("x-request-id") || upstream.headers.has("x-correlation-id") ? upstream.headers : headers) });
    for (const name of responseHeaders) {
      const value = upstream.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    // Redirects are not followed with credentials; only same-backend API locations are exposed locally.
    const location = upstream.headers.get("location");
    if (location) {
      const redirect = new URL(location, target);
      if (redirect.origin === target.origin && redirect.pathname.startsWith("/api/v1/")) outgoing.set("location", redirect.pathname + redirect.search);
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outgoing });
  } catch {
    return boundaryError(deadline.aborted ? 504 : 502, deadline.aborted ? "backend_timeout" : "backend_unreachable",
      deadline.aborted ? "Backend request timed out" : "Не удалось связаться с сервером", id);
  }
}

export async function readBackendJson(response: Response): Promise<unknown> {
  if (!response.ok) throw response;
  try { return await response.json(); } catch (error) {
    throw boundaryError((error as Error)?.name === "TimeoutError" ? 504 : 502,
      (error as Error)?.name === "TimeoutError" ? "backend_timeout" : "protocol_error", "Invalid successful backend JSON", requestId(response.headers));
  }
}

export async function backendFetch(path: string, init?: RequestInit, options: { request?: Request } = {}) {
  return readBackendJson(await forwardBackendRequest(path, init, options));
}

export function backendErrorResponse(error: unknown): Response {
  return error instanceof Response ? error : boundaryError(502, "protocol_error", "Invalid backend response");
}

export async function forwardBackendJson(path: string, request: Request, validate: (data: unknown) => void) {
  const response = await forwardBackendRequest(path, {}, { request });
  if (!response.ok) return response;
  try {
    const data = await readBackendJson(response);
    validate(data);
    return Response.json(data, { status: response.status, headers: { "x-request-id": requestId(response.headers), "cache-control": "no-store" } });
  } catch (error) {
    return error instanceof Response ? error : boundaryError(502, "protocol_error", "Invalid successful backend payload", requestId(response.headers));
  }
}

export function demoOnlyResponse(request?: Request) {
  try {
    return getRuntimeMode() === "demo" ? null : boundaryError(404, "demo_only", "This endpoint is available only in demo mode", requestId(request?.headers));
  } catch { return boundaryError(503, "configuration_error", "Runtime configuration is unavailable"); }
}
export const demoHeaders = { "x-fortis-runtime-mode": "demo", "cache-control": "no-store" };
