import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { consumeGGOOSSOReturnTo } from "../../auth/ggooSso";
import { useAuth } from "../../auth/useAuth";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState("");
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("access_token")?.trim();
    window.history.replaceState({}, document.title, "/auth/callback");
    if (!token) {
      setError("GGOO 登录凭证未返回，请重新登录");
      return;
    }
    login(token);
    navigate(consumeGGOOSSOReturnTo(), { replace: true });
  }, [login, navigate]);

  return (
    <div className="auth-wrap auth-wrap--home">
      <div className="auth-card" role="status">
        <div className="auth-logo" aria-hidden="true">
          <img src="/brand-logo.png" alt="" />
        </div>
        <h1 className="auth-title">构造视界</h1>
        {error ? (
          <>
            <p className="auth-error">{error}</p>
            <button className="auth-submit" type="button" onClick={() => navigate("/login", { replace: true })}>
              重新登录
            </button>
          </>
        ) : (
          <p className="auth-status">正在连接 GGOO 账户...</p>
        )}
      </div>
    </div>
  );
}
