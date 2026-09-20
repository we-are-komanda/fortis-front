// Run: npx tsx src/modules/defense-calculator/domain/project-asset-adapter.test.ts

import { readFileSync } from "node:fs";
import { defaultThresholds } from "@/modules/defense-calculator/infra/catalog-data";
import { computeWeightedScore, priorityForScore } from "@/modules/defense-calculator/domain/scoring";
import { projectAssetsToCalculatorAssets } from "@/modules/defense-calculator/domain/project-asset-adapter";
import { createDefaultDefenseProject } from "@/shared/lib/defense-project";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const project = createDefaultDefenseProject();
const calculatorAssets = projectAssetsToCalculatorAssets(project.assetLibrary);

const radar = calculatorAssets.find((asset) => asset.id === "mobile-radar");
assert(radar, "canonical project asset library must produce calculator mobile-radar");
assert(radar.unitPriceMln === 20 && radar.unit === "шт", "calculator adapter must preserve canonical price and unit");
assert(
  priorityForScore(
    computeWeightedScore(radar.scores, [
      { id: "effectiveness", name: "Эффективность защиты / поражения", weight: 25 },
      { id: "deploySpeed", name: "Скорость развёртывания", weight: 25 },
      { id: "cost", name: "Стоимость", weight: 20 },
      { id: "scalability", name: "Масштабируемость", weight: 10 },
      { id: "availability", name: "Доступность", weight: 10 },
      { id: "governance", name: "Управляемость", weight: 5 },
      { id: "adaptivity", name: "Адаптивность", weight: 5 },
    ]),
    defaultThresholds,
  ) === "green",
  "calculator-backed canonical assets must keep their existing scoring anchors",
);

const optical = calculatorAssets.find((asset) => asset.id === "l2-optical");
assert(optical, "calculator adapter must include map-only canonical assets");
assert(optical.unitPriceMln === 12, "map-only canonical assets must carry estimated CAPEX into calculator");

const calculatorPageSource = readFileSync("src/modules/defense-calculator/ui/calculator-page.tsx", "utf8");
const calculatorReportSource = readFileSync("src/modules/defense-calculator/ui/calculator-report.tsx", "utf8");
assert(
  !calculatorPageSource.includes("@/shared/config/defense-catalog"),
  "calculator page must not import the legacy defenseItems catalog directly",
);
assert(
  !calculatorPageSource.includes("setAssetQuantity"),
  "calculator page must not edit project quantities directly",
);
assert(
  !calculatorPageSource.includes("function Stepper"),
  "calculator page must not render interactive quantity steppers",
);
assert(
  calculatorReportSource.includes("objectLines"),
  "calculator report should receive object-level lines for report rendering",
);
assert(
  calculatorReportSource.includes("Размещённые объекты по эшелонам и типам"),
  "calculator report should include placed objects section for compound-aware output",
);

console.log("project-asset-adapter.test.ts: calculator reads canonical project asset library");
