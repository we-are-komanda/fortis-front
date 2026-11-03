"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isProjectSaveInFlight, markProjectInaccessible } from "@/shared/lib/identity";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";

// Navigation still protects unsaved work after account/session gates are removed.
export function ProjectBoundary({ children }: { children: React.ReactNode }) {
 const pathname = usePathname();
 const projectPage = ["/workspace", "/prototype", "/calculator"].some(path => pathname === path || pathname.startsWith(`${path}/`));
 useEffect(() => {
  if (!projectPage) return;
  const beforeUnload = (event: BeforeUnloadEvent) => {
   const state = useDefenseProjectStore.getState();
   if (state.syncStatus === "dirty" || state.saveAttempt || isProjectSaveInFlight() || (state.syncStatus === "unverified" && state.project.enterpriseId)) {
    event.preventDefault(); event.returnValue = "";
   }
  };
  const onAccessError = (event: Event) => {
   const { status, input } = (event as CustomEvent<{ status: number; input: string }>).detail;
   const project = useDefenseProjectStore.getState().project;
   if (project.source === "backend" && input.includes("/projects") && input.includes(encodeURIComponent(project.projectId))) markProjectInaccessible(status);
  };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("fortis-access-error", onAccessError);
  return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("fortis-access-error", onAccessError); };
 }, [projectPage]);
 return <>{children}</>;
}
