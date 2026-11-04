import { createWorkspaceDefenseProject } from "@/shared/lib/defense-project";
import { listVariants, prepareProjectSave, sendProjectSaveAttempt } from "@/modules/drone-defense/infra/api-client";

export const TEST_ENTERPRISE_ID = "f0711500-0000-4000-8000-000000000001";
let pending: Promise<string> | null = null;

// Share initialization across StrictMode remounts. Server idempotency also covers other tabs.
export function openDefaultMap(): Promise<string> {
  if (pending) return pending;
  pending = (async () => {
    const page = await listVariants({ enterpriseId: TEST_ENTERPRISE_ID, limit: 1, offset: 0 });
    if (page.items[0]) return page.items[0].projectId;
    const project = { ...createWorkspaceDefenseProject(),
      enterpriseId: TEST_ENTERPRISE_ID, projectName: "Тестовая конфигурация",
      baseObject: { id: TEST_ENTERPRISE_ID, name: "Тестовое предприятие", center: { lat: -41.2865, lng: 174.7762 } },
      updatedAt: "2026-10-18T00:00:00.000Z",
    };
    const attempt = prepareProjectSave("create", project.projectName, project, 0);
    attempt.body = JSON.stringify({ name: project.projectName, enterpriseId: TEST_ENTERPRISE_ID, projectJson: JSON.stringify(project) });
    attempt.idempotencyKey = "fortis-test-enterprise-initial-project-v1";
    return (await sendProjectSaveAttempt(attempt)).projectId;
  })().finally(() => { pending = null; });
  return pending;
}
