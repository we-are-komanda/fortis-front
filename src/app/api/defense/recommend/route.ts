import { demoOnlyResponse, demoHeaders } from "@/modules/drone-defense/infra/backend-proxy";
import { recommendDefense } from "@/modules/drone-defense/infra/mock-defense-repository";
import type { RecommendRequest } from "@/shared/types/drone-defense";

// POST handler reads the request body — it cannot be statically generated.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = demoOnlyResponse(request);
  if (denied) return denied;
  const payload = (await request.json()) as RecommendRequest;
  if (!payload?.configuration || typeof payload?.budgetRub !== "number") {
    return Response.json({ error: "configuration and budgetRub are required" }, { status: 400 });
  }

  const result = await recommendDefense(payload);
  return Response.json(result, { headers: demoHeaders });
}
