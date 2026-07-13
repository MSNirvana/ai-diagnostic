import { useEffect, useState } from "react";
import { fetchMe } from "../api/client";
import { AUTH_TOKEN_CHANGED, getToken } from "./authStore";

// 模块级缓存：同一 token 只查一次 /auth/me；token 变化即失效。
// 返回 null=校验中、true=管理员、false=非管理员/未登录。
let cacheToken: string | null = null;
let cacheValue: boolean | null = null;

export function useIsAdmin(): boolean | null {
  const [val, setVal] = useState<boolean | null>(
    cacheToken && cacheToken === getToken() ? cacheValue : null
  );

  useEffect(() => {
    let cancelled = false;

    const evaluate = () => {
      const token = getToken();
      if (!token) {
        cacheToken = null;
        cacheValue = null;
        if (!cancelled) setVal(false);
        return;
      }
      if (cacheToken === token && cacheValue !== null) {
        if (!cancelled) setVal(cacheValue);
        return;
      }
      if (!cancelled) setVal(null);
      let request: ReturnType<typeof fetchMe>;
      try {
        request = fetchMe();
      } catch {
        cacheToken = token;
        cacheValue = false;
        if (!cancelled) setVal(false);
        return;
      }
      request
        .then((m) => { cacheToken = token; cacheValue = m.is_admin; })
        .catch(() => { cacheToken = token; cacheValue = false; })
        .finally(() => { if (!cancelled) setVal(cacheValue); });
    };

    evaluate();
    const onChange = () => { cacheToken = null; cacheValue = null; evaluate(); };
    window.addEventListener(AUTH_TOKEN_CHANGED, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_TOKEN_CHANGED, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return val;
}
