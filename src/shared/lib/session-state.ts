import { create } from "zustand";

export const useSessionStore = create<{ userId: string | null; generation: number; invalid: boolean }>(() => ({ userId: "shared-workspace", generation: 0, invalid: false }));

export function setAuthenticatedIdentity(userId: string | null) {
  const state = useSessionStore.getState();
  if (userId === state.userId && state.invalid === (userId === null)) return;
  useSessionStore.setState({ userId, invalid: userId === null, generation: state.generation + 1 });
}

export function beginSessionVerification() {
  useSessionStore.setState({ userId: null, invalid: false, generation: sessionGeneration() + 1 });
}

export function sessionGeneration() { return useSessionStore.getState().generation; }
