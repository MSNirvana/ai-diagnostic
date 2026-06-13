import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import "./AppShell.css";

interface AppShellProps {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
}

export function AppShell({ children, eyebrow, title, description, actions }: AppShellProps) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Link to="/projects" className="brand-mark" aria-label="睿策视界项目中心">
          <span className="brand-mark__logo">RC</span>
          <span>
            <strong>睿策视界</strong>
            <small>Enterprise Intelligence</small>
          </span>
        </Link>
        <nav className="app-nav">
          <NavLink to="/projects">项目</NavLink>
          <NavLink to="/history">历史</NavLink>
          <NavLink to="/admin">后台</NavLink>
          <button type="button" onClick={handleLogout}>退出</button>
        </nav>
      </header>

      {(title || description || actions) && (
        <section className="page-hero">
          <div>
            {eyebrow && <span className="page-hero__eyebrow">{eyebrow}</span>}
            {title && <h1>{title}</h1>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="page-hero__actions">{actions}</div>}
        </section>
      )}

      <main className="app-main">{children}</main>
    </div>
  );
}
