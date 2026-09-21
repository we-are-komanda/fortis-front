"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CalculatorOutlined,
  EnvironmentOutlined,
  LineChartOutlined,
  RadarChartOutlined,
} from "@ant-design/icons";
import { useDefenseStudioStore } from "@/modules/drone-defense/domain/use-defense-studio-store";
import { canOpenCapability } from "@/shared/config/product-capabilities";
import { useRuntimeMode } from "@/shared/ui/runtime-provider";
import { VariantSaveButton, VariantStatusButton } from "@/modules/drone-defense/ui/variant-selector";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";

type DefenseStudioShellProps = {
  children: React.ReactNode;
};

const railItemClassName =
  "flex h-14 w-full flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition";
const mobileItemClassName = "grid min-h-11 place-items-center rounded-lg text-xs font-semibold transition";
const scenarioModelingTitle = "Прототип Модуля сценарного моделирования";

export function DefenseStudioShell({ children }: DefenseStudioShellProps) {
  const pathname = usePathname();
  const runtimeMode = useRuntimeMode();
  const searchParams = useSearchParams();
  const view = useDefenseStudioStore((state) => state.view);
  const setView = useDefenseStudioStore((state) => state.setView);
  const syncStatus = useDefenseProjectStore((state) => state.syncStatus);
  const saveAttempt = useDefenseProjectStore((state) => state.saveAttempt);
  const saveStatus = useDefenseVariantsStore((state) => state.saveStatus);
  const hasPendingSave = syncStatus === "dirty" || saveAttempt !== null || saveStatus === "saving";

  useEffect(() => {
    if (!hasPendingSave) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasPendingSave]);

  const normalizedPathname = pathname.replace(/\/$/, "");
  const isPrototype = normalizedPathname === "/prototype";
  const isCalculator = normalizedPathname === "/calculator";
  const isRetrospective = normalizedPathname === "/retrospective-analysis";
  const requestedView = searchParams.get("view");
  const is3DQueryActive = isPrototype && (requestedView === "scenario-modeling" || requestedView === "3d");
  const isDrilldownActive = isPrototype && (is3DQueryActive || view === "drilldown");
  const isMapActive = isPrototype && !isDrilldownActive;
  const mobileTitle = isCalculator ? "Калькулятор" : isDrilldownActive ? "Сценарии" : isRetrospective ? "Анализ" : "Моя карта";
  const mobileSubtitle = isCalculator
    ? "Defense Cost Estimator"
    : isDrilldownActive
      ? scenarioModelingTitle
      : isRetrospective
        ? "Ретро-анализ"
        : "Defense Configuration Studio";

  const activeRailClassName = "bg-blue-600 text-white shadow-md shadow-blue-600/25";
  const idleRailClassName = "text-slate-500 hover:bg-slate-100 hover:text-slate-900";
  const activeMobileClassName = "bg-white text-blue-700 shadow-sm";
  const idleMobileClassName = "text-slate-500 hover:bg-white/70 hover:text-slate-900";

  return (
    <div className="h-screen overflow-hidden bg-[#eef3f8] text-slate-900">
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <aside className="hidden w-[76px] shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm lg:flex">
          <div className="flex h-[74px] items-center justify-center border-b border-slate-100">
            <Link
              href="/workspace"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              title="Назад"
            >
              <ArrowLeftOutlined />
            </Link>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-2 py-4">
            <Link
              href="/prototype"
              className={`${railItemClassName} ${isMapActive ? activeRailClassName : idleRailClassName}`}
              onClick={() => setView("gis")}
              title="Карта"
            >
              <span className="text-lg">
                <EnvironmentOutlined />
              </span>
              <span>Карта</span>
            </Link>
            {canOpenCapability("calculation", runtimeMode) && (<Link
              href="/calculator"
              className={`${railItemClassName} ${isCalculator ? activeRailClassName : idleRailClassName}`}
              title="Просчитать конфигурацию в калькуляторе"
            >
              <span className="text-lg">
                <CalculatorOutlined />
              </span>
              <span>Расчёт</span>
            </Link>)}
            {canOpenCapability("scenarios", runtimeMode) && (<Link
              href="/prototype?view=scenario-modeling"
              className={`${railItemClassName} ${isDrilldownActive ? activeRailClassName : idleRailClassName}`}
              onClick={() => setView("drilldown")}
              title={scenarioModelingTitle}
            >
              <span className="text-lg">
                <RadarChartOutlined />
              </span>
              <span>Сценарии</span>
            </Link>)}
            {canOpenCapability("retrospective", runtimeMode) && (<Link
              href="/retrospective-analysis"
              className={`${railItemClassName} ${isRetrospective ? activeRailClassName : idleRailClassName}`}
              title="Анализ цепочки атаки (WIP)"
            >
              <span className="text-lg">
                <LineChartOutlined />
              </span>
              <span>Анализ</span>
            </Link>)}
          </nav>
          <div className="space-y-2 border-t border-slate-100 px-2 py-3">
            <VariantSaveButton
              iconOnly
              className="flex h-12 w-full items-center justify-center rounded-xl text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-wait disabled:opacity-60"
            />
          </div>
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-slate-200 bg-white px-3 py-2 shadow-sm lg:hidden">
            <div className="flex items-center gap-3">
              <Link
                href="/workspace"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                title="Назад"
              >
                <ArrowLeftOutlined />
              </Link>
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white">
                <AppstoreOutlined />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{mobileTitle}</p>
                <p className="truncate text-xs text-slate-500">{mobileSubtitle}</p>
              </div>
              <div className="ml-auto">
                <VariantSaveButton />
              </div>
            </div>
            <div className="mt-2">
              <VariantStatusButton fullWidth />
            </div>

            <nav className="mt-2 grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-100 p-1">
              <Link
                href="/prototype"
                className={`${mobileItemClassName} ${isMapActive ? activeMobileClassName : idleMobileClassName}`}
                onClick={() => setView("gis")}
              >
                Карта
              </Link>
              {canOpenCapability("calculation", runtimeMode) && (<Link
                href="/calculator"
                className={`${mobileItemClassName} ${isCalculator ? activeMobileClassName : idleMobileClassName}`}
              >
                Расчёт
              </Link>)}
              {canOpenCapability("scenarios", runtimeMode) && (<Link
                href="/prototype?view=scenario-modeling"
                className={`${mobileItemClassName} ${isDrilldownActive ? activeMobileClassName : idleMobileClassName}`}
                onClick={() => setView("drilldown")}
                title={scenarioModelingTitle}
              >
                Сценарии
              </Link>)}
              {canOpenCapability("retrospective", runtimeMode) && (<Link
                href="/retrospective-analysis"
                className={`${mobileItemClassName} ${isRetrospective ? activeMobileClassName : idleMobileClassName}`}
                title="Анализ цепочки атаки (WIP)"
              >
                Анализ
              </Link>)}
            </nav>
          </div>

          <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
