/**
 * Local-only preview switch. It is intentionally opt-in so production builds
 * and normal test runs keep the real GGOO authentication gate.
 */
const queryBypass =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("devAuthBypass") === "1";

export const DEV_AUTH_BYPASS =
  import.meta.env.DEV && (import.meta.env.VITE_DEV_AUTH_BYPASS === "true" || queryBypass);
