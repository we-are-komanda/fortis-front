// Run: pnpm exec node src/modules/drone-defense/domain/prototype-3d-placeholder-contract.test.mjs

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const shellSource = readFileSync("src/modules/drone-defense/ui/defense-studio-shell.tsx", "utf8");
const prototypeSource = readFileSync("src/modules/drone-defense/ui/drone-defense-prototype.tsx", "utf8");
const facilityDrilldownSource = readFileSync("src/modules/drone-defense/ui/facility-drilldown.tsx", "utf8");
const topbarSource = readFileSync("src/modules/drone-defense/ui/topbar.tsx", "utf8");
const sceneSource = readFileSync("src/modules/drone-defense/ui/scene.tsx", "utf8");
const dashboardSidebarSource = readFileSync("src/modules/dashboard/ui/sidebar.tsx", "utf8");

assert(
  !shellSource.includes('onClick={() => setView("drilldown")}'),
  "Teaching navigation must preserve the existing project map view",
);
assert(
  shellSource.includes("href=\"/prototype?view=scenario-modeling\""),
  "Scenario modeling navigation must use a shareable prototype state URL",
);
assert(
  dashboardSidebarSource.includes("href=\"/prototype\"") &&
    dashboardSidebarSource.includes(">Конфигуратор<") &&
    !dashboardSidebarSource.includes(">Сценарии<"),
  "Dashboard tools entry must open the default 2D configurator, while scenario modeling stays inside the prototype shell",
);
assert(!shellSource.includes("href=\"/models\""), "3D navigation must not restore the legacy /models route");
assert(
  prototypeSource.includes("<FacilityDrilldown"),
  "Legacy 3D entry must retain the facility drilldown scene",
);
assert(
  prototypeSource.includes("searchParams.get(\"view\")") &&
    prototypeSource.includes('searchParams.get("view") === "scenario-modeling"') &&
    prototypeSource.includes("<ScenarioWorkspace") &&
    prototypeSource.includes('canOpenCapability("scenarios", runtimeMode)'),
  "Direct scenario entry must render the separate teaching workspace behind its runtime gate",
);
assert(
  prototypeSource.includes('searchParams.get("view") === "3d"') && prototypeSource.includes("<FactoryBimViewer") && prototypeSource.includes('returnParams.set("view", "gis")'),
  "Factory BIM must use its own 3D entry and return explicitly to GIS while preserving query parameters",
);
assert(
  !prototypeSource.includes("<Prototype3DPlaceholder />"),
  "Scenario modeling prototype must not render the planned-product placeholder as its primary content",
);
assert(
  shellSource.includes("Прототип Модуля сценарного моделирования"),
  "Scenario modeling navigation must expose the requested product title",
);
assert(
  facilityDrilldownSource.includes("Прототип Модуля сценарного моделирования"),
  "Restored 3D scene must be titled as the scenario modeling module prototype",
);
assert(
  facilityDrilldownSource.includes("onToggleDemo") &&
    topbarSource.includes("Запустить сценарий") &&
    topbarSource.includes("onToggleDemo"),
  "Scenario modeling navbar must expose a visible launch button for the drone scenario",
);
assert(
  sceneSource.includes("<DroneSwarm") && sceneSource.includes("demoMode && viewMode === \"scene3d\""),
  "Launching the scenario must still render the animated drone swarm in the 3D scene",
);

console.log("prototype-3d-placeholder-contract.test.mjs: scenario modeling prototype contract passed");
