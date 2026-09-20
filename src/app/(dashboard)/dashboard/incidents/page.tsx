import { canOpenCapability } from "@/shared/config/product-capabilities";
import { getRuntimeMode } from "@/shared/server/runtime-config";
import { CapabilityNotice } from "@/shared/ui/release-capability";

export default async function Page() {
  if (!canOpenCapability("operational", getRuntimeMode())) return <CapabilityNotice capability="operational" />;
  const { IncidentsPage } = await import("@/modules/incidents/ui/incidents-page");
  return <IncidentsPage />;
}
