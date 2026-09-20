import { forwardBackendJson } from "@/modules/drone-defense/infra/backend-proxy";
import { validateProjectList, validateVariantSummary } from "@/modules/drone-defense/infra/api-client";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return forwardBackendJson(`/projects${new URL(request.url).search}`, request, validateProjectList);
}
export function POST(request: Request) {
  return forwardBackendJson("/projects", request, validateVariantSummary);
}
