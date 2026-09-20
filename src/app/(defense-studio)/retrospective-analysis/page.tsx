import { canOpenCapability } from "@/shared/config/product-capabilities";
import { getRuntimeMode } from "@/shared/server/runtime-config";
import { CapabilityNotice } from "@/shared/ui/release-capability";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!canOpenCapability("retrospective", getRuntimeMode())) return <CapabilityNotice capability="retrospective" />;
  const { RetrospectiveAnalysisPage } = await import("@/modules/drone-defense/ui/retrospective-analysis");
  return <>
    <p className="bg-amber-100 px-4 py-2 text-sm text-amber-950">Демонстрационные данные — синтетические примеры, не ваш рабочий проект.</p>
    <RetrospectiveAnalysisPage />
  </>;
}
