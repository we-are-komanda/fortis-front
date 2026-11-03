"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRuntimeMode } from "@/shared/ui/runtime-provider";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { openDefaultMap } from "../domain/default-map";

export function DefaultMapEntry() {
  const router = useRouter();
  const mode = useRuntimeMode();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    if (mode === "demo") { router.replace("/prototype"); return; }
    const state = useDefenseProjectStore.getState();
    const current = state.project;
    const keepCurrent = (current.source === "backend" && current.enterpriseId) ||
      (state.hydrated && (state.syncStatus === "dirty" || state.saveAttempt));
    const target = keepCurrent
      ? Promise.resolve(current.projectId) : openDefaultMap();
    void target.then(id => {
      if (!cancelled) router.replace(`/prototype?projectId=${encodeURIComponent(id)}`);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [mode, router, attempt]);
  return <main className="grid min-h-screen place-content-center gap-4 bg-slate-50 p-6 text-slate-900">
    {error ? <><p role="alert">Не удалось открыть карту. Проверьте подключение к серверу.</p>
      <button className="min-h-11 rounded-lg border border-slate-300 bg-white px-4" onClick={() => { setError(false); setAttempt(n => n + 1); }}>Повторить</button></>
      : <p role="status">Открываем карту…</p>}
  </main>;
}
