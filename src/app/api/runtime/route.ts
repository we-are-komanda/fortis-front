import { getLocalDraftsEnabled, getRuntimeMode } from "@/shared/server/runtime-config";
import { boundaryError } from "@/modules/drone-defense/infra/backend-proxy";
export const dynamic = "force-dynamic";
export function GET() {
  try { return Response.json({ mode: getRuntimeMode(), localDraftsEnabled: getLocalDraftsEnabled() }, { headers: { "cache-control": "no-store" } }); }
  catch { return boundaryError(503, "configuration_error", "Runtime configuration is unavailable"); }
}
