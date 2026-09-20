"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { readJson } from "@/shared/lib/api-client";
export type RuntimeMode = "workspace" | "demo";
const RuntimeContext = createContext<RuntimeMode | null>(null);
export function useRuntimeMode() { return useContext(RuntimeContext); }
export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<RuntimeMode | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readJson<{ mode: RuntimeMode }>("/api/runtime").then((data) => {
      if (data.mode !== "workspace" && data.mode !== "demo") throw new Error("Invalid runtime mode");
      if (!cancelled) setMode(data.mode);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  return <RuntimeContext.Provider value={mode}>
    {mode === "demo" && <div role="status" className="bg-amber-100 px-4 py-2 text-sm text-amber-950">Демо-режим — синтетические данные, не серверный клиентский проект.</div>}
    {error && <div role="alert">Рабочий режим недоступен. Обновите страницу или обратитесь к администратору.</div>}
    {children}
  </RuntimeContext.Provider>;
}
