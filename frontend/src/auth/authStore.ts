const KEY = "auth_token";
export const AUTH_TOKEN_CHANGED = "auth_token_changed";

// 防御：非浏览器/残缺环境（node 测试、SSR）下 localStorage 可能不存在或无方法
function safe<T>(fn: () => T, fallback: T): T {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
      return fallback;
    }
    return fn();
  } catch {
    return fallback;
  }
}

export const getToken = (): string | null => safe(() => localStorage.getItem(KEY), null);

function notifyAuthChanged(): void {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event(AUTH_TOKEN_CHANGED));
    }
  } catch {
    // ignore non-browser/test environments
  }
}

export const setToken = (t: string): void => {
  safe(() => localStorage.setItem(KEY, t), undefined);
  notifyAuthChanged();
};

export const clearToken = (): void => {
  safe(() => localStorage.removeItem(KEY), undefined);
  notifyAuthChanged();
};
