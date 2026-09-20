import { demoOnlyResponse, demoHeaders } from "@/modules/drone-defense/infra/backend-proxy";
import { getCatalog } from "@/modules/drone-defense/infra/mock-defense-repository";

export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const denied = demoOnlyResponse(request);
  if (denied) return denied;
  const catalog = await getCatalog();
  return Response.json(catalog, { headers: demoHeaders });
}
