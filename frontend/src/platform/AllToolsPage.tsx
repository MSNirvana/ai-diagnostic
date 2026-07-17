import { useState } from "react";
import { Link } from "react-router-dom";
import { LoginPage } from "../components/Auth/LoginPage";
import { PlatformNav } from "./PlatformNav";
import { listVisibleTools } from "./registry";
import "./PlatformHomePage.css";

/**
 * 全部工具（"/tools"）：列出注册表中可见的工具。
 * 后续工具增多后可在此加入分类与搜索。
 */
export function AllToolsPage() {
  const [loginOpen, setLoginOpen] = useState(false);
  const visibleTools = listVisibleTools();

  return (
    <div className="platform-page">
      <PlatformNav onRequestLogin={() => setLoginOpen(true)} />
      <main className="platform-home">
        <section className="platform-section" aria-label="全部工具">
          <header className="platform-section__header">
            <h2>全部工具</h2>
          </header>
          <div className="platform-tools-grid">
            {visibleTools.map((tool) => (
              <Link key={tool.id} to={tool.entryPath} className="platform-tool-card">
                <h3>{tool.name}</h3>
                <p>{tool.tagline}</p>
                <span className="platform-tool-card__go">进入工具 →</span>
              </Link>
            ))}
          </div>
        </section>
      </main>

      {loginOpen && (
        <div
          className="platform-login-overlay"
          role="presentation"
          onMouseDown={() => setLoginOpen(false)}
        >
          <div
            className="platform-login-overlay__panel"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <LoginPage modal onClose={() => setLoginOpen(false)} returnTo="/tools" />
          </div>
        </div>
      )}
    </div>
  );
}
