"use client";
import { useEffect, useRef, useState } from "react";
import type { VariantSummary } from "@/shared/types/defense-project";
import type { CompareResult, ProjectRef } from "@/shared/types/finance";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { savedProjectRef } from "@/shared/lib/project-save-state";
import { saveCurrentProject } from "@/shared/lib/identity";
import { compareBackendProjects } from "../infra/backend-project-api";

export function pairComparisonItems<T>(a: T[], b: T[], identity: (item: T) => string) {
  const left = new Map(a.map(item => [identity(item), item])), right = new Map(b.map(item => [identity(item), item]));
  return [...new Set([...left.keys(), ...right.keys()])].map(id => ({ id, a: left.get(id), b: right.get(id) }));
}
type Selection = { project: VariantSummary; version: string } | null;
const accessMessage = "Доступ к выбранной конфигурации не подтверждён. Откройте её заново или выберите другой проект.";
function reference(selection: Selection): ProjectRef | null {
  const version = Number(selection?.version);
  return selection && /^\d+$/.test(selection.version) && Number.isSafeInteger(version) && version > 0 ? { projectId: selection.project.projectId, projectVersion: version } : null;
}

export function useConfigurationComparison(enterpriseId: string) {
  const [a, setA] = useState<Selection>(null), [b, setB] = useState<Selection>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [dirtyPrompt, setDirtyPrompt] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const selectedIdA = a?.project.projectId, selectedIdB = b?.project.projectId;
  useEffect(() => useDefenseProjectStore.subscribe(current => {
    if (current.accessError && (current.project.projectId === selectedIdA || current.project.projectId === selectedIdB)) {
      generation.current++;
      setResult(null); setLoading(false); setError(accessMessage);
    }
  }), [selectedIdA, selectedIdB]);
  const refA = reference(a), refB = reference(b);
  const valid = Boolean(refA && refB && (refA.projectId !== refB.projectId || refA.projectVersion !== refB.projectVersion));
  function select(side: "a" | "b", value: Selection) {
    generation.current++;
    setResult(null); setError(null); setLoading(false); setDirtyPrompt(false);
    (side === "a" ? setA : setB)(value);
  }
  async function run(left = refA, right = refB) {
    if (!left || !right) return;
    const request = ++generation.current;
    setResult(null); setError(null); setLoading(true); setDirtyPrompt(false);
    try {
      const checkAccess = () => {
        const current = useDefenseProjectStore.getState();
        if (current.accessError && (current.project.projectId === left.projectId || current.project.projectId === right.projectId)) throw new Error(accessMessage);
      };
      checkAccess();
      const response = await compareBackendProjects(left, right, enterpriseId);
      checkAccess();
      if (request === generation.current) setResult(response);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : "Не удалось сравнить выбранные версии.");
    } finally { if (request === generation.current) setLoading(false); }
  }
  function compare() {
    if (!valid || saving || useDefenseVariantsStore.getState().saveStatus === "saving") return;
    const current = useDefenseProjectStore.getState();
    if (current.accessError && (current.project.projectId === selectedIdA || current.project.projectId === selectedIdB)) { setError(accessMessage); return; }
    if (current.syncStatus === "dirty" || current.saveAttempt || current.syncStatus === "unverified" && current.project.enterpriseId) { setResult(null); setDirtyPrompt(true); }
    else void run();
  }
  async function saveAndCompare(name: string) {
    if (!valid || saving) return;
    const request = ++generation.current;
    const before = useDefenseProjectStore.getState().project;
    setSaving(true); setError(null);
    try {
      const confirmed = await saveCurrentProject(name);
      if (request !== generation.current) return;
      const current = useDefenseProjectStore.getState();
      const saved = savedProjectRef(current.savedProject);
      if (!confirmed || !saved || !current.savedProject) { setError(useDefenseVariantsStore.getState().error ?? "Сравнение не запущено: текущие изменения ещё не полностью сохранены. Можно сравнить выбранные сохранённые версии."); return; }
      const repin = (selection: Selection) => selection?.project.projectId === before.projectId && Number(selection.version) === before.version && before.enterpriseId === enterpriseId
        ? { project: { ...selection.project, projectId: saved.projectId, version: saved.projectVersion, name: current.savedProject!.projectName, updatedAt: current.savedProject!.updatedAt }, version: String(saved.projectVersion) } : selection;
      const nextA = repin(a), nextB = repin(b);
      setA(nextA); setB(nextB);
      const left = reference(nextA), right = reference(nextB);
      if (left && right && left.projectId === right.projectId && left.projectVersion === right.projectVersion) { setError("Выберите две разные сохранённые версии."); return; }
      await run(left, right);
    } catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "Сохранение не подтверждено."); }
    finally { setSaving(false); }
  }
  return { a,b,result,error,loading,saving,dirtyPrompt,valid,select,compare,run,saveAndCompare,cancel: () => { setDirtyPrompt(false); setError(null); } };
}
