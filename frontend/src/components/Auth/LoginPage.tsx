import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login as apiLogin, register as apiRegister } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import "./LoginPage.css";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const returnTo = useMemo(() => {
    const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
    if (from?.pathname) return `${from.pathname}${from.search ?? ""}`;
    return "/";
  }, [location.state]);

  if (isAuthenticated) {
    return <Navigate to={returnTo} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("请输入邮箱");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    setLoading(true);
    try {
      setStatus("正在登录...");
      const token = await apiLogin(normalizedEmail, password);
      login(token);
      navigate(returnTo, { replace: true });
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "登录失败";
      if (!message.includes("邮箱或密码错误")) {
        setError(message);
        return;
      }
      try {
        setStatus("首次使用中，正在自动创建账号...");
        const token = await apiRegister(normalizedEmail, password);
        login(token);
        navigate(returnTo, { replace: true });
      } catch (registerError) {
        const registerMessage = registerError instanceof Error ? registerError.message : "注册失败";
        if (registerMessage.includes("该邮箱已注册")) {
          setError("该邮箱已存在，请检查密码后重试。");
        } else {
          setError(registerMessage);
        }
      }
    } finally {
      setStatus(null);
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap auth-wrap--home">
      <div className="auth-backdrop" aria-hidden="true">
        <aside className="auth-home-sidebar">
          <div className="auth-home-brand">
            <span className="auth-home-logo">
              <img src="/brand-logo.png" alt="" />
            </span>
            <div>
              <small>构造视界项目</small>
              <strong>经营增长诊断</strong>
            </div>
          </div>
          <div className="auth-home-menu">
            <span>＋ 新对话</span>
            <span>□ 项目档案</span>
            <span>⚑ 作战室</span>
          </div>
          <div className="auth-home-history">
            <strong>对话记录</strong>
            <span>渠道增长问题诊断</span>
            <span>用户转化漏斗复盘</span>
            <span>AI 改造路径推演</span>
          </div>
          <div className="auth-home-footer">项目列表</div>
        </aside>
        <section className="auth-home-main">
          <h2>今天，你想解决什么？</h2>
          <div className="auth-home-switch">
            <span>AI咨询</span>
            <span>头脑风暴</span>
          </div>
          <div className="auth-home-input">
            <span>＋</span>
            <em>输入消息...</em>
            <strong>↑</strong>
          </div>
        </section>
      </div>
      <div className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button
          className="auth-close"
          type="button"
          onClick={() => navigate("/")}
          aria-label="关闭并打开构造视界官网"
          title="打开构造视界官网"
        >
          ×
        </button>
        <div className="auth-logo" aria-hidden="true">
          <img src="/brand-logo.png" alt="" />
        </div>
        <h1 className="auth-title" id="auth-title">构造视界</h1>
        <p className="auth-subtitle">一个账号，进入项目、作战室与长期档案。</p>
        <div className="auth-banner">
          <span className="auth-banner__icon" aria-hidden="true">✦</span>
          <span>邮箱登录 / 注册一体化，首次使用会自动创建账号</span>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label">
            邮箱
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="name@company.com"
              required
            />
          </label>
          <label className="auth-label">
            密码
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="至少 6 位"
              required
            />
          </label>
          <p className="auth-hint">如果这是新邮箱，提交后会直接完成注册并登录。</p>
          {status && <p className="auth-status">{status}</p>}
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "处理中…" : "登录 / 注册"}
          </button>
        </form>
      </div>
    </div>
  );
}
