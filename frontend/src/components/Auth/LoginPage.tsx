import { useEffect, useMemo } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { beginGGOOSSO } from "../../auth/ggooSso";
import { useAuth } from "../../auth/useAuth";
import "./LoginPage.css";

interface LoginPageProps {
  modal?: boolean;
  onClose?: () => void;
  returnTo?: string;
}

export function LoginPage({ modal = false, onClose, returnTo: forcedReturnTo }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const returnTo = useMemo(() => {
    const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
    if (forcedReturnTo) return forcedReturnTo;
    if (from?.pathname) return `${from.pathname}${from.search ?? ""}`;
    return "/";
  }, [forcedReturnTo, location.state]);

  useEffect(() => {
    if (modal && isAuthenticated) onClose?.();
  }, [isAuthenticated, modal, onClose]);

  if (isAuthenticated) {
    if (modal) return null;
    return <Navigate to={returnTo} replace />;
  }

  const authCard = (
    <div className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button
        className="auth-close"
        type="button"
        onClick={() => modal ? onClose?.() : navigate("/")}
        aria-label="关闭登录窗口"
        title="关闭"
      >
        ×
      </button>
      <div className="auth-logo" aria-hidden="true">
        <img src="/brand-logo.png" alt="" />
      </div>
      <h1 className="auth-title" id="auth-title">GGOO Build</h1>
      <p className="auth-subtitle">使用 GGOO 统一账户进入你的项目空间</p>
      <div className="auth-banner">
        <span className="auth-banner__icon" aria-hidden="true">G</span>
        <span>同一账户、同一模型额度</span>
      </div>
      <div className="auth-form">
        <button className="auth-submit" type="button" onClick={() => beginGGOOSSO(returnTo)}>
          使用 GGOO 登录 / 注册
        </button>
        <p className="auth-hint">登录后将自动返回 GGOO Build。</p>
      </div>
    </div>
  );

  if (modal) return authCard;

  return (
    <div className="auth-wrap auth-wrap--home">
      <div className="auth-backdrop" aria-hidden="true">
        <aside className="auth-home-sidebar">
          <div className="auth-home-brand">
            <span className="auth-home-logo"><img src="/brand-logo.png" alt="" /></span>
            <div><small>GGOO Build</small><strong>经营增长诊断</strong></div>
          </div>
          <div className="auth-home-menu"><span>＋ 新对话</span><span>□ 项目档案</span><span>⚑ 作战室</span></div>
          <div className="auth-home-history">
            <strong>对话记录</strong><span>渠道增长问题诊断</span><span>用户转化漏斗复盘</span><span>AI 改造路径推演</span>
          </div>
          <div className="auth-home-footer">项目列表</div>
        </aside>
        <section className="auth-home-main">
          <h2>今天，你想解决什么？</h2>
          <div className="auth-home-switch"><span>AI咨询</span><span>头脑风暴</span></div>
          <div className="auth-home-input"><span>＋</span><em>输入消息...</em><strong>↑</strong></div>
        </section>
      </div>
      {authCard}
    </div>
  );
}
