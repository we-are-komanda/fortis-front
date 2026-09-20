import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canOpenCapability, productCapabilities, type ProductCapability } from "@/shared/config/product-capabilities";
import { CapabilityNotice } from "./release-capability";
import { DemoMarker } from "./demo-marker";

test("capability policy does not promote demo or unaccepted functionality into workspace", () => {
  for (const capability of Object.keys(productCapabilities) as ProductCapability[]) {
    const { status } = productCapabilities[capability];
    assert.equal(canOpenCapability(capability, "workspace"), status === "available", capability);
    assert.equal(canOpenCapability(capability, "demo"), status !== "not_released", capability);
  }
  for (const capability of ["compare", "report"] as const) assert.equal(productCapabilities[capability].status, "not_released");
});

test("unavailable notice has a working-zone exit and demo marker stays fixed", () => {
  const notice = renderToStaticMarkup(<CapabilityNotice capability="operational" />);
  assert.match(notice, /Раздел не включён/);
  assert.match(notice, /href="\/workspace"/);
  const marker = renderToStaticMarkup(<DemoMarker />);
  assert.match(marker, /Демонстрационные данные/);
  assert.match(marker, /fixed/);
});

test("direct operational pages and layout render notices without executing mock modules", async () => {
  const mode = process.env.FORTIS_RUNTIME_MODE;
  process.env.FORTIS_RUNTIME_MODE = "workspace";
  try {
    const pages = [
      await import("@/app/(dashboard)/dashboard/page"),
      await import("@/app/(dashboard)/dashboard/alert/page"),
      await import("@/app/(dashboard)/dashboard/incidents/page"),
      await import("@/app/(dashboard)/dashboard/reports/page"),
      await import("@/app/(dashboard)/dashboard/settings/page"),
      await import("@/app/(dashboard)/dashboard/sites/page"),
      await import("@/app/(dashboard)/dashboard/team/page"),
      await import("@/app/(defense-studio)/retrospective-analysis/page"),
    ];
    for (const page of pages) {
      const html = renderToStaticMarkup(await page.default());
      assert.match(html, /Раздел не включён/);
      assert.doesNotMatch(html, /admin@fortis|Завод|mock|\d+%/);
    }
    const detail = await import("@/app/(dashboard)/dashboard/sites/[id]/page");
    assert.match(renderToStaticMarkup(await detail.default({ params: Promise.resolve({ id: "arbitrary-direct-id" }) })), /Раздел не включён/);
    const layout = await import("@/app/(dashboard)/layout");
    assert.doesNotMatch(renderToStaticMarkup(await layout.default({ children: <p>Private-looking synthetic metric 987</p> })), /987/);
    const prototype = await import("@/app/(defense-studio)/prototype/page");
    for (const view of ["scenario-modeling", "3d", ["3d", "gis"]]) {
      assert.match(renderToStaticMarkup(await prototype.default({ searchParams: Promise.resolve({ view }) })), /Раздел не включён/);
    }
  } finally {
    if (mode === undefined) delete process.env.FORTIS_RUNTIME_MODE;
    else process.env.FORTIS_RUNTIME_MODE = mode;
  }
});
