import { isIP } from "node:net";
import { boundaryError, forwardBackendRequest, readBackendJson } from "@/modules/drone-defense/infra/backend-proxy";
import { isRecord } from "@/shared/lib/api-client";
import { getRuntimeMode, resolveBackendBaseUrl } from "@/shared/server/runtime-config";

function publicationConfig() {
  try {
    if (process.env.FORTIS_DEMO_REQUESTS_ENABLED !== "true" || getRuntimeMode() !== "workspace") return null;
    const origin = new URL(process.env.FORTIS_DEMO_FORM_ORIGIN ?? "").origin;
    const local = process.env.NODE_ENV !== "production" && process.env.FORTIS_LOCAL_DEVELOPMENT === "true";
    if (!origin.startsWith("https://") && !(local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return null;
    const consentVersion = process.env.FORTIS_DEMO_CONSENT_VERSION?.trim();
    const consentText = process.env.FORTIS_DEMO_CONSENT_TEXT?.trim();
    const clientIpHeader = process.env.FORTIS_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
    if (!consentVersion || !consentText || (!clientIpHeader && !local)) return null;
    if (clientIpHeader && !/^x-[a-z0-9-]+$/.test(clientIpHeader)) return null;
    resolveBackendBaseUrl();
    return { origin, consentVersion, consentText, clientIpHeader, local };
  } catch { return null; }
}

export function demoRequestConfiguration() {
  const config = publicationConfig();
  return Response.json(config ? { enabled: true, consentVersion: config.consentVersion, consentText: config.consentText } : { enabled: false }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function submitDemoRequest(request: Request) {
  const config = publicationConfig();
  if (!config) return boundaryError(503, "collection_disabled", "Приём заявок сейчас недоступен.");
  if (request.headers.get("origin") !== config.origin) return boundaryError(403, "origin_not_allowed", "Request origin is not allowed");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return boundaryError(415, "unsupported_media_type", "JSON body required");
  }
  // The configured edge must overwrite this header; publication requires deployment evidence.
  const clientIp = config.clientIpHeader ? request.headers.get(config.clientIpHeader) : config.local ? "127.0.0.1" : null;
  if (!clientIp || !isIP(clientIp)) return boundaryError(503, "client_identity_unavailable", "Приём заявок сейчас недоступен.");
  const reader = request.body?.getReader();
  if (!reader) return boundaryError(400, "invalid_input", "Request body required");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) {
        await reader.cancel();
        return boundaryError(413, "body_too_large", "Request body exceeds 16 KiB");
      }
      parts.push(value);
    }
  } catch { return boundaryError(400, "invalid_input", "Unable to read request body"); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  const response = await forwardBackendRequest("/demo-requests", {
    method: "POST", body,
    headers: { origin: config.origin, "x-forwarded-for": clientIp },
  }, { request });
  if (!response.ok) return response;
  try {
    const result = await readBackendJson(response);
    if (![200, 201].includes(response.status) || !isRecord(result) || result.status !== "received" || typeof result.requestId !== "string" || !result.requestId) {
      return boundaryError(502, "protocol_error", "Сервер вернул некорректные данные.");
    }
    return Response.json(result, { status: response.status, headers: response.headers });
  } catch (error) {
    return error instanceof Response ? error : boundaryError(502, "protocol_error", "Сервер вернул некорректные данные.");
  }
}
