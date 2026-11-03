"use client";
import { useEffect, useMemo, useState } from "react";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { businessContent, savedProjectRef } from "@/shared/lib/project-save-state";
import { sessionGeneration, useSessionStore } from "@/shared/lib/session-state";
import { projectBudgetCandidate } from "@/shared/lib/budget-projection";
import { exportDefenseProjectJson } from "@/shared/lib/defense-project";
import type { BudgetCheckResponse } from "@/shared/types/finance";
import { checkBackendProjectBudget, getBackendBudgetConfig } from "../infra/backend-project-api";

export function useProjectBudget() {
  const { project, savedProject, budgetProjection, budgetError, accessError, runtimeMode } = useDefenseProjectStore();
  const generation = useSessionStore(state => state.generation);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [checked, setChecked] = useState<{ key: string; content: string; result: BudgetCheckResponse } | null>(null);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
  const ref = useMemo(() => savedProjectRef(savedProject), [savedProject]);
  const key = `${generation}:${project.projectId}:${ref?.projectVersion ?? "local"}`;
  const checking = checkingKey === key;
  const available = runtimeMode === "workspace" && !accessError && ref?.projectId === project.projectId && ref.projectVersion === project.version;
  const budget = available && budgetProjection?.identity.projectId === ref?.projectId && budgetProjection.identity.projectVersion === ref.projectVersion ? budgetProjection : null;
  useEffect(() => {
    if (!available || !ref || budget) return;
    const controller = new AbortController();
    let active = true;
    getBackendBudgetConfig(ref.projectId, ref.projectVersion, controller.signal).then(projection => {
      const current = useDefenseProjectStore.getState();
      if (active && generation === sessionGeneration() && current.project.projectId === ref.projectId && current.project.version === ref.projectVersion && current.project.enterpriseId === project.enterpriseId) {
        useDefenseProjectStore.setState({ budgetProjection: projection });
        setFailure(null);
      }
    }).catch(error => { if (active) setFailure({ key, message: error instanceof Error ? error.message : "Бюджет недоступен." }); });
    return () => { active = false; controller.abort(); };
  }, [available, ref, project.enterpriseId, generation, key, budget, attempt]);
  const preview = useMemo(() => {
    if (!budget) return null;
    try { return projectBudgetCandidate(project, budget); } catch { return null; }
  }, [project, budget]);
  async function check() {
    if (!available || !ref || checking) return;
    const content = businessContent(project);
    setCheckingKey(key);
    try {
      const result = await checkBackendProjectBudget(ref.projectId, { version: ref.projectVersion, projectJson: exportDefenseProjectJson(project) });
      const current = useDefenseProjectStore.getState();
      if (generation === sessionGeneration() && current.project.projectId === ref.projectId && current.project.version === ref.projectVersion && businessContent(current.project) === content) setChecked({ key, content, result });
    } catch (error) { if (generation === sessionGeneration()) setFailure({ key, message: error instanceof Error ? error.message : "Проверка недоступна." }); }
    finally { setCheckingKey(current => current === key ? null : current); }
  }
  return { project, budget, preview, budgetError, available, key, checking, check,
    checked: checked?.key === key && checked.content === businessContent(project) ? checked.result : null,
    error: failure?.key === key ? failure.message : null,
    retry: () => { setFailure(null); useDefenseProjectStore.setState({ budgetProjection: null }); setAttempt(value => value + 1); } };
}
