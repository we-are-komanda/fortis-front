import { canOpenCapability } from "@/shared/config/product-capabilities";
import { getRuntimeMode } from "@/shared/server/runtime-config";
import { CapabilityNotice } from "@/shared/ui/release-capability";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!canOpenCapability("operational", getRuntimeMode())) return <CapabilityNotice capability="operational" />;
  const { SiteDetailPage } = await import("@/modules/sites/ui/site-detail-page");
  return <SiteDetailPage siteId={(await params).id} />;
}
