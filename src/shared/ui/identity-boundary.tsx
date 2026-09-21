"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigProvider, Modal } from "antd";
import { usePathname } from "next/navigation";
import { useRuntimeMode } from "./runtime-provider";
import { sessionGeneration, setAuthenticatedIdentity, useSessionStore } from "@/shared/lib/session-state";
import { isProjectSaveInFlight, logout, markProjectInaccessible, saveBeforeLogout, useProjectSaveInFlight } from "@/shared/lib/identity";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";

export function IdentityBoundary({ children }: { children: React.ReactNode }) {
 const generation = useSessionStore((state) => state.generation);
 return <SessionIdentityBoundary key={generation}>{children}</SessionIdentityBoundary>;
}

function SessionIdentityBoundary({ children }: { children: React.ReactNode }) {
 const pathname = usePathname();
 const mode = useRuntimeMode();
 const session = useSessionStore();
 const projectState = useDefenseProjectStore();
 const { accessError } = projectState;
 const protectedPage = ["/workspace", "/prototype", "/calculator"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
 const [verified, setVerified] = useState<{ path: string; generation: number } | null>(null);
 const [checking, setChecking] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [logoutPending, setLogoutPending] = useState(false);
 const [logoutBusy, setLogoutBusy] = useState(false);
 const [logoutError, setLogoutError] = useState<string | null>(null);
 const [saveName, setSaveName] = useState("");
 const saving = useProjectSaveInFlight();
 const protectedRoot = useRef<HTMLDivElement>(null);
 const popupContainer = useCallback(() => protectedRoot.current ?? document.body, []);

 useEffect(() => {
  if (!protectedPage || mode !== "workspace") return;
  let cancelled = false;
  let check = 0;
  async function validate() {
   const currentCheck = ++check;
   const generation = sessionGeneration();
   setChecking(true);
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
    setChecking(false);
   } catch (failure) {
    if (!cancelled && currentCheck === check) {
     setError(failure instanceof Error ? failure.message : "Сессия не подтверждена.");
     setChecking(false);
    }
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

 useEffect(() => {
  if (!protectedPage) return;
  const beforeUnload = (event: BeforeUnloadEvent) => {
   const state = useDefenseProjectStore.getState();
   if (state.syncStatus === "dirty" || state.saveAttempt || isProjectSaveInFlight() || (state.syncStatus === "unverified" && state.project.enterpriseId)) {
    event.preventDefault();
    event.returnValue = "";
   }
  };
  window.addEventListener("beforeunload", beforeUnload);
  return () => window.removeEventListener("beforeunload", beforeUnload);
 }, [protectedPage]);

 async function finishLogout() {
  setLogoutBusy(true);
  setLogoutError(null);
  try {
   await logout();
   window.location.replace("/login");
  } catch (failure) {
   setLogoutError(failure instanceof Error ? failure.message : "Не удалось завершить сессию.");
  } finally {
   setLogoutBusy(false);
  }
 }

 function requestLogout() {
  if (logoutBusy) return;
  const state = useDefenseProjectStore.getState();
  setLogoutError(null);
  if (state.syncStatus === "dirty" || state.saveAttempt || isProjectSaveInFlight() || (state.syncStatus === "unverified" && state.project.enterpriseId)) {
   setSaveName(state.saveAttempt?.name ?? state.project.projectName);
   setLogoutPending(true);
  } else void finishLogout();
 }

 async function resolveLogout(choice: "save" | "discard") {
  if (logoutBusy || isProjectSaveInFlight()) return;
  setLogoutBusy(true);
  setLogoutError(null);
  try {
   if (choice === "save" && !await saveBeforeLogout(saveName)) {
    setLogoutError("Сохранение не подтверждено. Изменения сохранены в текущей сессии; повторите сохранение или останьтесь здесь.");
    return;
   }
   if (choice === "discard" && !useDefenseProjectStore.getState().discardLocalChanges()) {
    setLogoutError(useDefenseProjectStore.getState().draftStorageError);
    return;
   }
   await finishLogout();
  } finally {
   setLogoutBusy(false);
  }
 }

 if (protectedPage && mode !== "demo" && (!mode || !session.userId || verified?.path !== pathname || verified.generation !== session.generation)) {
  return <div role={error ? "alert" : "status"} className="p-6 text-sm">{error ?? "Проверяем сессию…"}</div>;
 }
 const hiddenForVerification = protectedPage && mode === "workspace" && (checking || Boolean(error));
 return <>
  {hiddenForVerification ? <div role={error ? "alert" : "status"} className="p-6 text-sm">{error ?? "Проверяем сессию…"}</div> : null}
  <div ref={protectedRoot} hidden={hiddenForVerification} inert={hiddenForVerification}>
  <ConfigProvider getPopupContainer={popupContainer}>
  {protectedPage && mode === "workspace" && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
   <span role={accessError ? "alert" : undefined}>{accessError ?? "Рабочая сессия"}</span>
   <button type="button" disabled={logoutBusy} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold" onClick={requestLogout}>Выйти</button>
  </div>}
  {logoutError && !logoutPending ? <p role="alert" className="px-4 py-2 text-sm text-rose-700">{logoutError}</p> : null}
  {children}
  <Modal open={logoutPending && !hiddenForVerification} title="Есть несохранённые изменения" footer={null} closable={!logoutBusy} mask={{ closable: false }} onCancel={() => { if (!logoutBusy) setLogoutPending(false); }}>
   <p>Сохраните текущий проект, останьтесь здесь или явно откажитесь от локальных изменений перед выходом.</p>
   {projectState.project.source !== "backend" && projectState.saveAttempt?.kind !== "create" ? <label className="mt-4 block text-sm font-medium">Имя нового варианта перед выходом<input aria-label="Имя нового варианта перед выходом" value={saveName} onChange={(event) => setSaveName(event.target.value)} maxLength={120} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3" /></label> : null}
   {logoutError ? <p role="alert" className="mt-3 text-sm text-rose-700">{logoutError}</p> : null}
   <div className="mt-5 flex flex-wrap justify-end gap-2">
    <button type="button" onClick={() => setLogoutPending(false)} disabled={logoutBusy} className="min-h-11 rounded-md border border-slate-300 px-4 font-semibold">Остаться</button>
    <button type="button" onClick={() => void resolveLogout("discard")} disabled={logoutBusy || saving} className="min-h-11 rounded-md border border-rose-300 px-4 font-semibold text-rose-700">Отказаться и выйти</button>
    <button type="button" onClick={() => void resolveLogout("save")} disabled={logoutBusy || saving || !saveName.trim()} className="min-h-11 rounded-md bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">Сохранить и выйти</button>
   </div>
  </Modal>
  </ConfigProvider>
  </div>
 </>;
}
