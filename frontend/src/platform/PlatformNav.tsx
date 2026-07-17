import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import "./PlatformNav.css";

const GGOO_SITE_URL = (import.meta.env.VITE_GGOO_SITE_URL ?? "https://ggoo.ai").replace(/\/$/, "");

interface PlatformNavProps {
  onRequestLogin?: () => void;
}

/**
 * 平台顶部导航：GGOO / Build 品牌区 + 平台入口 + 账户区。
 * 点击 GGOO 跳转官网（API 主界面由 GGOO 官网承载），点击 Build 回平台主页。
 * 积分余额展示在计费链路接通后挂载到 account 区（预留插槽）。
 */
export function PlatformNav({ onRequestLogin }: PlatformNavProps) {
  const { isAuthenticated, logout } = useAuth();

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
