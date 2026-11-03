// Run: pnpm exec tsx src/modules/drone-defense/infra/backend-integration-contract.test.ts

import { existsSync, readFileSync } from "node:fs";
import { buildAssetDocumentDownloadUrl, buildAssetDocumentsListUrl } from "@/modules/drone-defense/infra/asset-documents-api";
import {
  compareBackendProjects,
  getBackendProjectCost,
} from "@/modules/defense-calculator/infra/backend-project-api";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
function compareSide(projectId: string, projectVersion: number) {
  const identity = {projectId,projectVersion,calculationVersion:"cost-rub-v1",snapshotDigest:"a".repeat(64),inputDataVersions:{}};
  return { identity, name: projectId, updatedAt: "2026-09-21T00:00:00Z", cost: {identity,currency:"RUB",lines:[],byLayer:[],byType:[],totalMinor:"0",knownSubtotalMinor:"0",isComplete:true,unknownPriceObjectIds:[],warnings:[]}, budget: {identity,config:{budgetMode:"unlimited",budgetLimitMinor:null},spentMinor:"0",remainingMinor:null,status:"unlimited"} };
}
Object.defineProperty(globalThis, "fetch", {
  value: async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return Response.json(String(input).includes("/projects/cost") ? {
      identity: {projectId:"proj-1",projectVersion:7,calculationVersion:"cost-rub-v1",snapshotDigest:"a".repeat(64),inputDataVersions:{}},
      currency:"RUB",lines:[],byLayer:[],byType:[],totalMinor:"0",knownSubtotalMinor:"0",isComplete:true,unknownPriceObjectIds:[],warnings:[],
    } : String(input).includes("/projects/compare") ? {enterpriseId:"E",a:compareSide("proj-1",7),b:compareSide("proj-2",3),differenceMinor:"0",differencePercent:null,warnings:[]} : {ok:true});
  },
  configurable: true,
  writable: true,
});

async function main() {
  assert(
    buildAssetDocumentsListUrl("asset-1") === "/api/v1/assets/documents/list?assetId=asset-1",
    "documents list URL must target backend documents API",
  );
  assert(
    buildAssetDocumentDownloadUrl("doc-1") === "/api/v1/assets/documents/download?id=doc-1",
    "documents download URL must target backend documents API",
  );

  await getBackendProjectCost("proj-1", 7);
  await compareBackendProjects({projectId:"proj-1",projectVersion:7}, {projectId:"proj-2",projectVersion:3}, "E");

  assert(String(calls[0]?.input) === "/api/v1/projects/cost?projectId=proj-1&projectVersion=7", "cost helper must call /projects/cost");
  assert(
    String(calls[1]?.input) === "/api/v1/projects/compare?projectIdA=proj-1&projectVersionA=7&projectIdB=proj-2&projectVersionB=3",
    "compare helper must pin both saved revisions",
  );

  assert(!existsSync("src/proxy.ts"), "shared workspace must not restore the auth proxy");
  assert(!existsSync("src/app/api/auth/login/route.ts"), "shared workspace has no login endpoint");

  const defenseStudioShellSource = readFileSync("src/modules/drone-defense/ui/defense-studio-shell.tsx", "utf8");
  assert(
    !defenseStudioShellSource.includes("Проект не выбран"),
    "prototype shell must not show backend project warning while auth/backend flow is opt-in",
  );
  const assetLibraryManagerSource = readFileSync("src/modules/drone-defense/ui/asset-library-manager.tsx", "utf8");
  assert(
    !assetLibraryManagerSource.includes("Не удалось загрузить документы"),
    "asset library manager must not show backend documents UI while backend flow is opt-in",
  );

  console.log("backend-integration-contract.test.ts: contracts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
