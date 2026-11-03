import { redirect } from "next/navigation";
import { DefaultMapEntry } from "@/modules/workspace/ui/default-map-entry";
import { getRuntimeMode } from "@/shared/server/runtime-config";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; projectId?: string; project?: string }> }) {
  const { view, projectId, project } = await searchParams;
  const requestedView = Array.isArray(view) ? view[0] : view;
  if (requestedView !== "scenario-modeling" && requestedView !== "3d" && !projectId && !project) {
    if (requestedView === "gis") {
      if (getRuntimeMode() === "demo") {
        const { DroneDefensePrototype } = await import("@/modules/drone-defense/ui/drone-defense-prototype");
        return <DroneDefensePrototype />;
      }
      return <DefaultMapEntry />;
    }
    redirect("/prototype?view=scenario-modeling");
  }
  const { DroneDefensePrototype } = await import("@/modules/drone-defense/ui/drone-defense-prototype");
  return <DroneDefensePrototype />;
}
