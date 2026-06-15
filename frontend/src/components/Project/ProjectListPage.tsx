import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listProjects, createProject } from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import type { ProjectSummary } from "../../types";
import "./ProjectListPage.css";

export function ProjectListPage() {
  const navigate = useNavigate();
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
      const project = await createProject(name);
      setNewName("");
      setCreating(false);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");
  const memoryPreview = (summary: string) => {
    const latest = summary.split("\n").filter(Boolean).slice(-1)[0] ?? "";
    return latest.length > 128 ? `${latest.slice(0, 128)}...` : latest;
  };

  return (
    <AppShell
      eyebrow="Client Portfolio"
      title="项目中心"
      description="以企业项目为单位管理诊断、对话、证据与复诊记忆。所有工作从一个项目工作台开始。"
      actions={
        !creating ? (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            新建项目
          </button>
        ) : null
      }
    >
      {error && <p className="proj-error">{error}</p>}

      {creating && (
        <section className="proj-create-panel">
          <div>
            <span className="proj-panel-kicker">New Engagement</span>
            <h2>建立一个企业长期档案</h2>
            <p>建议使用企业名、业务线或咨询项目名，后续诊断和会话都会沉淀到这里。</p>
          </div>
          <div className="proj-create-row">
            <input
              className="proj-create-input"
              placeholder="项目名称，如：星麦直播增长诊断"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
            />
            <button type="button" className="btn-primary" onClick={() => void handleCreate()}>
              创建并进入
            </button>
            <button type="button" className="proj-cancel-btn" onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        </section>
      )}

      <section className="portfolio-board">
        <div className="portfolio-board__head">
          <div>
            <span className="proj-panel-kicker">Active Files</span>
            <h2>客户项目组合</h2>
          </div>
          <span>{projects?.length ?? 0} 个项目</span>
        </div>

        <div className="proj-list">
          {projects === null && !error && <p className="proj-empty">加载中…</p>}
          {projects && projects.length === 0 && (
            <div className="proj-empty-card">
              <span>01</span>
              <h3>先创建一个项目</h3>
              <p>项目会成为所有问题地图、专家会诊、证据包和反馈复诊的归档中心。</p>
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                创建第一个项目
              </button>
            </div>
          )}
          {projects?.map((p, index) => (
            <button
              key={p.id}
              type="button"
              className="proj-card"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <span className="proj-card__index">{String(index + 1).padStart(2, "0")}</span>
              <span className="proj-card__name">{p.name}</span>
              <span className="proj-card__meta">更新于 {fmt(p.updated_at)}</span>
              {p.memory_summary ? (
                <span className="proj-card__memory">
                  <strong>最新档案</strong>
                  {memoryPreview(p.memory_summary)}
                </span>
              ) : (
                <span className="proj-card__memory proj-card__memory--empty">
                  暂无档案事件，进入工作台开始诊断
                </span>
              )}
              <span className="proj-card__arrow">进入工作台</span>
            </button>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
