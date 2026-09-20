import { demoOnlyResponse, demoHeaders } from "@/modules/drone-defense/infra/backend-proxy";
import { getFacilities } from "@/modules/drone-defense/infra/mock-defense-repository";

export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const denied = demoOnlyResponse(request);
  if (denied) return denied;
  const items = await getFacilities();
  return Response.json(items, { headers: demoHeaders });
}
