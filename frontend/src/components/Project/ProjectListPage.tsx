import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { listProjects, createProject } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import type { ProjectSummary } from "../../types";
import "./ProjectListPage.css";

export function ProjectListPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = () => {
    listProjects()
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  };

  useEffect(load, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createProject(name);
      setNewName("");
      setCreating(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <header
        style={{
          marginBottom: 28,
          borderBottom: "1px solid var(--line)",
          paddingBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", margin: 0 }}>
          我的项目
        </h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/history" style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.9rem" }}>
            历史记录
          </Link>
          <Link to="/admin" style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.9rem" }}>
            ⚙ 后台管理
          </Link>
          <button
            type="button"
            onClick={() => { logout(); navigate("/login"); }}
            className="proj-logout-btn"
          >
            退出登录
          </button>
        </div>
      </header>

      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}

      <div style={{ marginBottom: 20 }}>
        {creating ? (
          <div className="proj-create-row">
            <input
              className="proj-create-input"
              placeholder="项目名称（如：星麦直播）"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
            />
            <button type="button" className="btn-primary" onClick={() => void handleCreate()}>
              创建
            </button>
            <button type="button" className="proj-cancel-btn" onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            + 新建项目
          </button>
        )}
      </div>

      <div className="proj-list">
        {projects === null && !error && <p style={{ color: "var(--ink-soft)" }}>加载中…</p>}
        {projects && projects.length === 0 && (
          <p style={{ color: "var(--ink-soft)" }}>
            还没有项目，新建一个开始持续诊断。
          </p>
        )}
        {projects?.map((p) => (
          <button
            key={p.id}
            type="button"
            className="proj-card"
            onClick={() => navigate(`/projects/${p.id}`)}
          >
            <span className="proj-card__name">{p.name}</span>
            <span className="proj-card__meta">更新于 {fmt(p.updated_at)}</span>
            {p.memory_summary && (
              <span className="proj-card__memory">
                {p.memory_summary.split("\n").slice(-1)[0]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
