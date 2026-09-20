import { canOpenCapability } from "@/shared/config/product-capabilities";
import { getRuntimeMode } from "@/shared/server/runtime-config";
import { CapabilityNotice } from "@/shared/ui/release-capability";

export default async function Page() {
  if (!canOpenCapability("operational", getRuntimeMode())) return <CapabilityNotice capability="operational" />;
  const { SettingsPage } = await import("@/modules/settings/ui/settings-page");
  return <SettingsPage />;
}
