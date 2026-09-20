import { forwardBackendJson, forwardBackendRequest } from "@/modules/drone-defense/infra/backend-proxy";
import { validateProjectPayload, validateVariantSummary } from "@/modules/drone-defense/infra/api-client";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Ctx) {
  const query = new URLSearchParams({ id: (await params).id });
  const version = new URL(request.url).searchParams.get("projectVersion");
  if (version !== null) query.set("projectVersion", version);
  return forwardBackendJson(`/projects/export?${query}`, request, validateProjectPayload);
}
export async function PUT(request: Request, { params }: Ctx) {
  return forwardBackendJson(`/projects/update?id=${encodeURIComponent((await params).id)}`, request, validateVariantSummary);
}
export async function DELETE(request: Request, { params }: Ctx) {
  return forwardBackendRequest(`/projects/delete?id=${encodeURIComponent((await params).id)}`, {}, { request });
}
