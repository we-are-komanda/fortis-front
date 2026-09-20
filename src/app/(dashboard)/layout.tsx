import { canOpenCapability } from "@/shared/config/product-capabilities";
import { getRuntimeMode } from "@/shared/server/runtime-config";
import { CapabilityNotice } from "@/shared/ui/release-capability";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!canOpenCapability("operational", getRuntimeMode())) return <CapabilityNotice capability="operational" />;
  const [{ DashboardSidebar }, { DashboardHeader }, { OnboardingModal }] = await Promise.all([
    import("@/modules/dashboard/ui/sidebar"),
    import("@/modules/dashboard/ui/header"),
    import("@/modules/onboarding/ui/onboarding-modal"),
  ]);
  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-120 w-120 rounded-full bg-sky-400/20 dark:bg-sky-500/10 blur-[96px]" />
        <div className="absolute -bottom-24 -right-24 h-105 w-105 rounded-full bg-indigo-400/15 dark:bg-indigo-500/10 blur-[80px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-150 w-150 rounded-full bg-slate-300/10 dark:bg-slate-700/10 blur-[120px]" />
      </div>

      <OnboardingModal />

      <div className="w-56 shrink-0 hidden md:flex flex-col glass-md border-r border-(--glass-border) z-10">
        <DashboardSidebar />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden z-10">
        <div className="glass border-b border-(--glass-border)">
          <p className="bg-amber-100 px-4 py-2 text-sm text-amber-950">Демонстрационные данные — синтетические примеры, не ваш рабочий проект.</p>
          <DashboardHeader />
        </div>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
