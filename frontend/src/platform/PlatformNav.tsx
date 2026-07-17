import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { fetchCreditsBalance } from "../api/client";
import type { CreditsBalance } from "../types";
import "./PlatformNav.css";

const GGOO_SITE_URL = (import.meta.env.VITE_GGOO_SITE_URL ?? "https://ggoo.ai").replace(/\/$/, "");

const CREDITS_FORMATTER = new Intl.NumberFormat("zh-CN");

interface PlatformNavProps {
  onRequestLogin?: () => void;
}

/**
 * 平台顶部导航：GGOO / Build 品牌区 + 平台入口 + 账户区。
 * 点击 GGOO 跳转官网（API 主界面由 GGOO 官网承载），点击 Build 回平台主页。
 * 积分余额：GGOO 余额接口尚未最终确认，查不到时静默隐藏，不展示假数字。
 */
export function PlatformNav({ onRequestLogin }: PlatformNavProps) {
  const { isAuthenticated, logout } = useAuth();
  const [credits, setCredits] = useState<CreditsBalance | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setCredits(null);
      return;
    }
    let cancelled = false;
    fetchCreditsBalance()
      .then((balance) => {
        if (!cancelled) setCredits(balance);
      })
      .catch(() => {
        if (!cancelled) setCredits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const showCredits = isAuthenticated && credits?.available && credits.points != null;

  return (
    <header className="platform-nav">
      <div className="platform-nav__brand">
        <a className="platform-nav__ggoo" href={GGOO_SITE_URL} target="_blank" rel="noreferrer">
          GGOO
        </a>
        <span className="platform-nav__divider" aria-hidden="true">
          /
        </span>
        <Link to="/" className="platform-nav__build">
          <img src="/brand-logo.png" alt="" />
          <span>Build</span>
        </Link>
      </div>
      <nav className="platform-nav__links" aria-label="平台导航">
        <Link to="/tools">全部工具</Link>
        <Link to="/projects">我的项目</Link>
      </nav>
      <div className="platform-nav__account">
        {showCredits && (
          <a
            className="platform-nav__credits"
            href={GGOO_SITE_URL}
            target="_blank"
            rel="noreferrer"
            title="积分余额由 GGOO 账户统一管理"
          >
            {CREDITS_FORMATTER.format(credits!.points as number)} 积分
          </a>
        )}
        {isAuthenticated ? (
          <button type="button" className="platform-nav__logout" onClick={logout}>
            退出登录
          </button>
        ) : (
          <button type="button" className="platform-nav__login" onClick={onRequestLogin}>
            登录 / 注册
          </button>
        )}
      </div>
    </header>
  );
}
