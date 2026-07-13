const RETURN_TO_KEY = "build:ggoo-sso:return-to";

function ggooWebBase(): string {
  return (import.meta.env.VITE_GGOO_WEB_BASE ?? "https://ggoo.ai").replace(/\/$/, "");
}

function safeLocalPath(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function beginGGOOSSO(returnTo: string): void {
  const localReturnTo = safeLocalPath(returnTo);
  sessionStorage.setItem(RETURN_TO_KEY, localReturnTo);
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  const ssoUrl = new URL("/sso", ggooWebBase());
  ssoUrl.searchParams.set("return_to", callbackUrl.toString());
  window.location.assign(ssoUrl.toString());
}

export function consumeGGOOSSOReturnTo(): string {
  const value = sessionStorage.getItem(RETURN_TO_KEY) ?? "/";
  sessionStorage.removeItem(RETURN_TO_KEY);
  return safeLocalPath(value);
}

