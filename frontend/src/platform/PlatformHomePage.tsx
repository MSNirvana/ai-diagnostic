import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listProjects } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { LoginPage } from "../components/Auth/LoginPage";
import type { ProjectSummary } from "../types";
import { PlatformNav } from "./PlatformNav";
import { listVisibleTools } from "./registry";
import "./PlatformHomePage.css";

const RECENT_PROJECT_LIMIT = 4;

function formatUpdatedAt(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 平台主页（"/"）：GGOO Build 的工具与工作台入口。
 * 未登录展示品牌与工具介绍 + 登录入口；登录后展示最近项目与工具卡片。
 * 不直接打开任何具体工具（工具不硬编码在根路由）。
 */
export function PlatformHomePage() {
  const { isAuthenticated } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[] | null>(null);
  const [recentError, setRecentError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      setRecentProjects(null);
      setRecentError("");
      return;
    }
    let active = true;
    listProjects()
      .then((projects) => {
        if (!active) return;
        const recent = [...projects]
          .filter((project) => project.status !== "archived" && project.status !== "deleted")
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, RECENT_PROJECT_LIMIT);
        setRecentProjects(recent);
      })
      .catch((e) => {
        if (!active) return;
        setRecentError(e instanceof Error ? e.message : "项目加载失败");
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  const visibleTools = listVisibleTools();

  return (
    <div className="platform-page">
      <PlatformNav onRequestLogin={() => setLoginOpen(true)} />
      <main className="platform-home">
        <section className="platform-hero">
          <p className="platform-hero__eyebrow">GGOO Build</p>
          <h1>把 AI 模型变成上手即用的工具</h1>
          <p className="platform-hero__lead">
            使用 GGOO 统一账户与积分，直接完成真实工作任务；高级工作台与 API 共享同一身份和余额。
          </p>
          {!isAuthenticated && (
            <button type="button" className="platform-hero__cta" onClick={() => setLoginOpen(true)}>
              使用 GGOO 账户开始
            </button>
          )}
        </section>

        {isAuthenticated && (
          <section className="platform-section" aria-label="最近项目">
            <header className="platform-section__header">
              <h2>最近项目</h2>
              <Link to="/projects" className="platform-section__more">
                全部项目
              </Link>
            </header>
            {recentError ? (
              <p className="platform-empty">{recentError}</p>
            ) : recentProjects === null ? (
              <p className="platform-empty">正在加载最近项目…</p>
            ) : recentProjects.length === 0 ? (
              <div className="platform-empty platform-empty--guide">
                <p>还没有项目。从一个工具开始，创建你的第一个项目。</p>
                <Link to="/projects" className="platform-empty__action">
                  去创建项目
                </Link>
              </div>
            ) : (
              <div className="platform-recent-grid">
                {recentProjects.map((project) => (
                  <Link key={project.id} to={`/projects/${project.id}`} className="platform-recent-card">
                    <div className="platform-recent-card__head">
                      <h3>{project.name}</h3>
                      <span>{formatUpdatedAt(project.updated_at)}</span>
                    </div>
                    {project.memory_summary && <p>{project.memory_summary}</p>}
                    <span className="platform-recent-card__go">继续工作 →</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="platform-section" aria-label="工具">
          <header className="platform-section__header">
            <h2>工具</h2>
            <Link to="/tools" className="platform-section__more">
              全部工具
            </Link>
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
            <LoginPage modal onClose={() => setLoginOpen(false)} returnTo="/" />
          </div>
        </div>
      )}
    </div>
  );
}
