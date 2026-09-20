import { useSessionStore, setAuthenticatedIdentity } from "./session-state";
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
 setAuthenticatedIdentity(null);
 const response = await fetch("/api/auth/logout", { method: "POST" });
 if (!response.ok) throw new Error("Не удалось завершить сессию. Повторите выход.");
}
