import { useSessionStore, setAuthenticatedIdentity, sessionGeneration } from "./session-state";
import { useDefenseProjectStore as projects } from "./use-defense-project-store";
import { useDefenseVariantsStore as variants } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { useDefenseStudioStore as studio } from "@/modules/drone-defense/domain/use-defense-studio-store";
import { useDefenseConfigurationStore as configuration } from "./use-defense-configuration-store";

// A generation change invalidates pending requests as well as every active customer store.
useSessionStore.subscribe((next, previous) => {
 if (next.generation === previous.generation) return;
 projects.setState({ ...projects.getInitialState(), identityId: next.userId, localDraftsEnabled: projects.getState().localDraftsEnabled }, true);
 variants.setState(variants.getInitialState(), true);
 studio.setState(studio.getInitialState(), true);
 configuration.setState(configuration.getInitialState(), true);
});

export function markProjectInaccessible(status: number) {
 if (status !== 403 && status !== 404) return;
 projects.setState({ syncStatus: "unverified", accessError: status === 404
  ? "Серверный проект больше недоступен. Изменения сохранены только локально; откройте проект заново после восстановления доступа."
  : "Операция запрещена. Изменения не сохранены на сервере." });
}

export async function logout() {
 const generation = sessionGeneration();
 const response = await fetch("/api/auth/logout", { method: "POST" });
 if (generation !== sessionGeneration()) throw new Error("Сессия изменилась. Повторите выход из текущего аккаунта.");
 if (!response.ok) throw new Error("Не удалось завершить сессию. Повторите выход.");
 setAuthenticatedIdentity(null);
}

export function isProjectSaveInFlight() {
 return variants.getState().saveStatus === "saving";
}

export function useProjectSaveInFlight() {
 return variants((state) => state.saveStatus === "saving");
}

export async function saveCurrentProject(name: string): Promise<boolean> {
 if (isProjectSaveInFlight()) return false;
 const generation = sessionGeneration();
 const attempt = projects.getState().saveAttempt;
 if (attempt?.kind === "create") await variants.getState().saveAsNewVariant(attempt.name);
 else if (variants.getState().activeVariantId) await variants.getState().overwriteActiveVariant();
 else if (name.trim()) await variants.getState().saveAsNewVariant(name.trim());
 const current = projects.getState();
 const result = variants.getState();
 return generation === sessionGeneration() && current.syncStatus === "saved" && !current.saveAttempt && !current.accessError && result.saveStatus === "idle";
}

export const saveBeforeLogout = saveCurrentProject;
