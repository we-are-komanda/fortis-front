import { canOpenCapability } from "@/shared/config/product-capabilities";
import { getRuntimeMode } from "@/shared/server/runtime-config";
import { CapabilityNotice } from "@/shared/ui/release-capability";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  const requestedView = Array.isArray(view) ? view[0] : view;
  if ((requestedView === "scenario-modeling" || requestedView === "3d") && !canOpenCapability("scenarios", getRuntimeMode())) {
    return <CapabilityNotice capability="scenarios" />;
  }
  const { DroneDefensePrototype } = await import("@/modules/drone-defense/ui/drone-defense-prototype");
  return <DroneDefensePrototype />;
}
