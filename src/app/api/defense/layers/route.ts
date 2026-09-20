import { demoOnlyResponse, demoHeaders } from "@/modules/drone-defense/infra/backend-proxy";
import { getLayers } from "@/modules/drone-defense/infra/mock-defense-repository";
import type { DefenseScenarioId } from "@/shared/types/drone-defense";

// Reads facilityId/scenarioId from the request query, so the response cannot be
// statically generated — force-static would null out searchParams and 400 every call.
export const dynamic = "force-dynamic";

const scenarioIds: DefenseScenarioId[] = ["baseline", "balanced", "reinforced"];

export async function GET(request: Request) {
  const denied = demoOnlyResponse(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  const scenarioId = searchParams.get("scenarioId");

  if (!facilityId || !scenarioId || !scenarioIds.includes(scenarioId as DefenseScenarioId)) {
    return Response.json(
      { error: "facilityId and scenarioId are required" },
      { status: 400 },
    );
  }

  const layers = await getLayers(facilityId, scenarioId as DefenseScenarioId);
  return Response.json(layers, { headers: demoHeaders });
}
