import { demoOnlyResponse, demoHeaders } from "@/modules/drone-defense/infra/backend-proxy";
import { evaluateDefense } from "@/modules/drone-defense/infra/mock-defense-repository";
import type { EvaluateRequest } from "@/shared/types/drone-defense";

// POST handler reads the request body — it cannot be statically generated.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = demoOnlyResponse(request);
  if (denied) return denied;
  const payload = (await request.json()) as EvaluateRequest;
  if (!payload?.configuration || !payload.scope) {
    return Response.json({ error: "configuration and scope are required" }, { status: 400 });
  }

  const result = await evaluateDefense(payload);
  return Response.json(result, { headers: demoHeaders });
}
