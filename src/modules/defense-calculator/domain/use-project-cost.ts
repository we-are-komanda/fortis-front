"use client";

import { useEffect, useMemo, useState } from "react";
import { FortisApiError } from "@/shared/lib/api-client";
import { buildDraftCostProjection, CostProjectionInputError } from "@/shared/lib/cost-projection";
import { useSessionStore } from "@/shared/lib/session-state";
import type { DefenseProject } from "@/shared/types/defense-project";
import type { CostProjection } from "@/shared/types/finance";
import { getBackendProjectCost } from "../infra/backend-project-api";

export function useProjectCost(project: DefenseProject, syncStatus: string, runtimeMode: "workspace" | "demo" | null) {
  const generation = useSessionStore(state => state.generation);
  const [result, setResult] = useState<{key:string;cost?:CostProjection;error?:string} | null>(null);
  const [attempt,setAttempt] = useState(0);
  const saved = runtimeMode === "workspace" && project.source === "backend" && syncStatus === "saved";
  const blocked = !runtimeMode || (project.source === "backend" && syncStatus === "unverified");
  const key = `${generation}:${project.projectId}:${project.version ?? "local"}`;
  useEffect(() => {
    if (!saved || typeof project.version !== "number") return;
    const controller = new AbortController();
    let active = true;
    getBackendProjectCost(project.projectId,project.version,controller.signal).then(cost => {
      if (active) setResult({key,cost});
    }).catch(error => {
      if (!active) return;
      const support = error instanceof FortisApiError && error.requestId ? ` Код обращения: ${error.requestId}.` : "";
      setResult({key,error:`Расчёт сохранённой версии недоступен. Повторите запрос.${support}`});
    });
    return () => { active=false;controller.abort(); };
  },[saved,project.projectId,project.version,key,attempt]);
  const draft = useMemo(() => {
    if (saved || blocked) return null;
    try { return {cost:buildDraftCostProjection(project)}; }
    catch(error) {
      const objects = error instanceof CostProjectionInputError ? error.issues.flatMap(issue=>issue.objectIds).map(id=>project.placedObjects.find(object=>object.id===id)?.name ?? id) : [];
      return {error:`Проверьте цены, источники, валюту и целые количества от 1 до 1 000 000.${objects.length ? ` Позиции: ${[...new Set(objects)].join(", ")}.` : ""}`};
    }
  },[project,saved,blocked]);
  const current = result?.key===key ? result : null;
  const cost = blocked ? undefined : saved ? current?.cost : draft?.cost;
  const error = blocked ? undefined : saved ? (typeof project.version !== "number" ? "Сохранённая версия проекта не определена." : current?.error) : draft?.error;
  return {cost,error,blocked,saved,retry:()=>{setResult(null);setAttempt(value=>value+1);}};
}
