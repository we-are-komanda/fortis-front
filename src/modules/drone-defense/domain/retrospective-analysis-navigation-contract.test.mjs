import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pageSource = readFileSync("src/app/(defense-studio)/retrospective-analysis/page.tsx", "utf8");
const shellSource = readFileSync("src/modules/drone-defense/ui/defense-studio-shell.tsx", "utf8");
const sidebarSource = readFileSync("src/modules/dashboard/ui/sidebar.tsx", "utf8");
const pageImports = pageSource.match(/^import .*$/gm) ?? [];

assert(
  /const\s+\{\s*RetrospectiveAnalysisPage\s*\}\s*=\s*await import\("@\/modules\/drone-defense\/ui\/retrospective-analysis"\)/.test(
    pageSource,
  ),
  "Retrospective page should load its module after the server capability gate",
);
assert(pageImports.length === 3, "Retrospective page should import its server capability gate dependencies");
assert(!/usePathname/.test(pageSource), "Retrospective page should stay simple and server-safe");

assert(
  shellSource.includes("href=\"/retrospective-analysis\"") &&
    shellSource.includes('label="Анализ"') &&
    shellSource.includes("isRetrospective") &&
    shellSource.includes("<Drawer"),
  "DefenseStudioShell must expose the new WIP route in desktop rail and compact navigation drawer",
);
assert(
  shellSource.includes("<StudioNavigation {...navigationProps}") &&
    shellSource.includes("setNavigationOpen"),
  "DefenseStudioShell must reuse the complete navigation in compact mode",
);
assert(
  sidebarSource.includes("href=\"/retrospective-analysis\"") &&
    sidebarSource.includes(">Анализ (WIP)<"),
  "Dashboard sidebar must keep Конфигуратор and add a WIP 'Анализ' entry",
);

console.log("retrospective-analysis-navigation-contract.test.mjs: OK");
