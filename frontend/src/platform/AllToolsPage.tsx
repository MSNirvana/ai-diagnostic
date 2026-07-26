import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoginPage } from "../components/Auth/LoginPage";
import { PlatformNav } from "./PlatformNav";
import { listVisibleTools } from "./registry";
import "./PlatformHomePage.css";

function ToolEntry({
  tool,
  children,
}: {
  tool: ReturnType<typeof listVisibleTools>[number];
  children: ReactNode;
}) {
  if (tool.external) {
    return <a className="platform-tool-card" href={tool.entryPath}>{children}</a>;
  }
  return <Link className="platform-tool-card" to={tool.entryPath}>{children}</Link>;
}

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
              <ToolEntry key={tool.id} tool={tool}>
                <h3>{tool.name}</h3>
                <p>{tool.tagline}</p>
                <span className="platform-tool-card__go">进入工具 →</span>
              </ToolEntry>
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
