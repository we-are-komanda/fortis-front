// Server imports only: backend addresses must never be passed to browser state.
export type RuntimeMode = "workspace" | "demo";

export function getRuntimeMode(): RuntimeMode {
  const mode = process.env.FORTIS_RUNTIME_MODE?.trim() || "workspace";
  if (mode !== "workspace" && mode !== "demo") throw new Error("Invalid FORTIS_RUNTIME_MODE");
  return mode;
}

function localDevelopment() {
  return process.env.NODE_ENV !== "production" && process.env.FORTIS_LOCAL_DEVELOPMENT === "true";
}

function normalizeBackendUrl(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid backend URL");
  const host = url.hostname;
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const privateHost = /^[a-z][a-z0-9-]*$/i.test(host) || /\.(internal|local)$/.test(host) ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ((loopback && localDevelopment()) || (!loopback && privateHost && process.env.FORTIS_BACKEND_PRIVATE_HTTP === "true")))) {
    throw new Error("Backend requires HTTPS or explicitly configured private HTTP");
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/(?:\/api\/v1)+$/, "");
  if (path) throw new Error("Backend URL must be an origin with optional /api/v1");
  return `${url.origin}/api/v1`;
}

export function resolveBackendBaseUrl() {
  getRuntimeMode();
  const configured = process.env.BACKEND_URL?.trim();
  const fallback = localDevelopment() && process.env.NODE_ENV === "development" ? "http://localhost:8090" : undefined;
  if (!configured && !fallback) throw new Error("BACKEND_URL is required");
  const base = normalizeBackendUrl(configured || fallback!);
  for (const alias of [process.env.FORTIS_API_BASE_URL, process.env.NEXT_PUBLIC_FORTIS_API_BASE_URL]) {
    if (alias?.trim() && normalizeBackendUrl(alias) !== base) throw new Error("Conflicting backend configuration");
  }
  return base;
}

export function backendTimeoutMs(document: boolean) {
  const value = process.env[document ? "FORTIS_DOCUMENT_TIMEOUT_MS" : "FORTIS_API_TIMEOUT_MS"];
  const timeout = value === undefined ? (document ? 30_000 : 10_000) : Number(value);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) throw new Error("Invalid backend timeout");
  return timeout;
}

/** Persistent recovery is an explicit workspace deployment policy. */
export function getLocalDraftsEnabled(): boolean {
  const value = process.env.FORTIS_LOCAL_DRAFTS_ENABLED;
  if (value !== undefined && value !== "true" && value !== "false") throw new Error("Invalid local draft policy");
  return value === undefined ? getRuntimeMode() === "demo" : value === "true";
}
