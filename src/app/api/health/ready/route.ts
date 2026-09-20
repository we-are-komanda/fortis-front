import { getRuntimeMode } from "@/shared/server/runtime-config";
import { boundaryError, forwardBackendRequest } from "@/modules/drone-defense/infra/backend-proxy";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (getRuntimeMode() === "demo") return Response.json({ status: "ready", mode: "demo" });
    const response = await forwardBackendRequest("/", {}, { readiness: true });
    await response.body?.cancel();
    if (!response.ok) return boundaryError(503, "not_ready", "Backend is not ready", response.headers.get("x-request-id") ?? undefined);
    return Response.json({ status: "ready", mode: "workspace" }, { headers: { "cache-control": "no-store" } });
  } catch { return boundaryError(503, "configuration_error", "Runtime configuration is unavailable"); }
}
