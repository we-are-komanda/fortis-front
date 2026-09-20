"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { readJson } from "@/shared/lib/api-client";
import { useSessionStore } from "@/shared/lib/session-state";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { DemoMarker } from "./demo-marker";
export type RuntimeMode = "workspace" | "demo";
const RuntimeContext = createContext<RuntimeMode | null>(null);
export function useRuntimeMode() { return useContext(RuntimeContext); }
export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<RuntimeMode | null>(null);
  const [error, setError] = useState(false);
  const [localDraftsEnabled, setLocalDraftsEnabled] = useState(false);
  const generation = useSessionStore(state=>state.generation);
  useEffect(()=>{useDefenseProjectStore.getState().setLocalDraftsEnabled(localDraftsEnabled);},[localDraftsEnabled,generation]);
  useEffect(() => {
    let cancelled = false;
    void readJson<{ mode: RuntimeMode; localDraftsEnabled?: boolean }>("/api/runtime", {sessionBound:false}).then((data) => {
      if (data.mode !== "workspace" && data.mode !== "demo") throw new Error("Invalid runtime mode");
      if (data.localDraftsEnabled !== undefined && typeof data.localDraftsEnabled !== "boolean") throw new Error("Invalid draft policy");
      if (!cancelled) { setMode(data.mode); setLocalDraftsEnabled(data.localDraftsEnabled === true); }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  return <RuntimeContext.Provider value={mode}>
    {mode === "demo" && <DemoMarker />}
    {error && <div role="alert">Рабочий режим недоступен. Обновите страницу или обратитесь к администратору.</div>}
    {children}
  </RuntimeContext.Provider>;
}
