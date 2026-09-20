"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useRuntimeMode } from "./runtime-provider";
import { sessionGeneration, setAuthenticatedIdentity, useSessionStore } from "@/shared/lib/session-state";
import { logout, markProjectInaccessible } from "@/shared/lib/identity";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";

export function IdentityBoundary({ children }: { children: React.ReactNode }) {
 const pathname = usePathname();
 const mode = useRuntimeMode();
 const session = useSessionStore();
 const accessError = useDefenseProjectStore((state) => state.accessError);
 const protectedPage = ["/workspace", "/prototype", "/calculator"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
 const [verified, setVerified] = useState<{ path: string; generation: number } | null>(null);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
  if (!protectedPage || mode !== "workspace") return;
  let cancelled = false;
  let check = 0;
  async function validate() {
   const currentCheck = ++check;
   const generation = sessionGeneration();
   setVerified(null);
   setError(null);
   try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (cancelled || currentCheck !== check || generation !== sessionGeneration()) return;
    if (response.status === 401) {
     setAuthenticatedIdentity(null);
     window.location.replace(`/login?next=${encodeURIComponent(pathname + window.location.search)}`);
     return;
    }
    if (!response.ok) throw new Error("Не удалось проверить сессию. Обновите страницу.");
    const user = await response.json() as { id?: unknown };
    if (cancelled || currentCheck !== check || generation !== sessionGeneration()) return;
    if (typeof user?.id !== "string" || !user.id) throw new Error("Сервер не подтвердил пользователя.");
    setAuthenticatedIdentity(user.id);
    setVerified({ path: pathname, generation: sessionGeneration() });
   } catch (failure) {
    if (!cancelled && currentCheck === check) setError(failure instanceof Error ? failure.message : "Сессия не подтверждена.");
   }
  }
  const onVisible = () => { if (document.visibilityState === "visible") void validate(); };
  const onAccessError = (event: Event) => {
   const { status, input } = (event as CustomEvent<{ status: number; input: string }>).detail;
   const project = useDefenseProjectStore.getState().project;
   if (project.source === "backend" && input.includes("/projects") && input.includes(encodeURIComponent(project.projectId))) markProjectInaccessible(status);
  };
  void validate();
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("fortis-access-error", onAccessError);
  return () => { cancelled = true; window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("fortis-access-error", onAccessError); };
 }, [pathname, protectedPage, mode]);


 if (protectedPage && mode !== "demo" && (!mode || !session.userId || verified?.path !== pathname || verified.generation !== session.generation)) {
  return <div role={error ? "alert" : "status"} className="p-6 text-sm">{error ?? "Проверяем сессию…"}</div>;
 }
 return <Fragment key={session.generation}>
  {protectedPage && mode === "workspace" && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
   <span role={accessError ? "alert" : undefined}>{accessError ?? "Рабочая сессия"}</span>
   <button type="button" className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold" onClick={() => { void logout().then(() => { window.location.replace("/login"); }).catch((failure: Error) => setError(failure.message)); }}>Выйти</button>
  </div>}
  {children}
 </Fragment>;
}
