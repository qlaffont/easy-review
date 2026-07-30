import { useSessionState } from "#/lib/session/provider.tsx";

export function useAuthViewer() {
    return useSessionState((state) => state.auth.viewer);
}
