import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listProjects, createProject, patchProject } from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import type { ProjectSummary } from "../../types";
import "./ProjectListPage.css";

export function ProjectListPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  const updateProjectStatus = async (project: ProjectSummary, status: "active" | "archived" | "deleted") => {
    setBusyProjectId(project.id);
    setError(null);
    try {
      const updated = await patchProject(project.id, { status });
      setProjects((current) => {
        if (!current) return current;
        if (status === "deleted") {
          return current.filter((item) => item.id !== project.id);
        }
        return current.map((item) => item.id === project.id ? { ...item, ...updated } : item);
      });
      if (status === "deleted") setDeleteConfirmId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新项目失败");
    } finally {
      setBusyProjectId(null);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");
  const sortedProjects = projects ? [...projects].sort((a, b) => {
    const delta = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (delta !== 0) return delta;
    return a.name.localeCompare(b.name, "zh-CN");
  }) : null;
  const featuredProject = sortedProjects?.[0] ?? null;
  const activeCount = sortedProjects?.filter((project) => project.status !== "archived" && project.status !== "deleted").length ?? 0;
  const archivedCount = sortedProjects?.filter((project) => project.status === "archived").length ?? 0;
  const visibleProjects = sortedProjects?.filter((project) =>
    showArchived ? project.status === "archived" : project.status !== "archived" && project.status !== "deleted"
  );
  const featuredVisibleProject = showArchived
    ? null
    : featuredProject?.status === "archived" || featuredProject?.status === "deleted"
      ? visibleProjects?.[0] ?? null
      : featuredProject;
  // Keep the highlighted project in the manageable list as well. Otherwise a
  // single recent project has no archive/delete controls anywhere on the page.
  const listedProjects = visibleProjects;
  const memoryPreview = (summary: string) => {
    const latest = summary.split("\n").filter(Boolean).slice(-1)[0] ?? "";
    const cleaned = latest
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/^诊断[:：]\s*/, "")
      .replace(/\b(market|sales|product|ops|org|finance)[（(][^）)]+[）)][:：]\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const text = cleaned || "已有项目资料沉淀，进入项目工作台继续推进。";
    return text.length > 96 ? `${text.slice(0, 96)}...` : text;
  };

  return (
    <AppShell
      eyebrow="项目中枢"
      title="构造视界"
      description="构造视界 · 先把问题说清楚，再沉淀到项目和作战室。"
      showBrandMark
      actions={
        !creating ? (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            新建项目
          </button>
        ) : null
      }
    >
      {error && <p className="proj-error">{error}</p>}

      <section className="command-center">
        <div className="command-center__copy">
          <span className="proj-panel-kicker">项目</span>
          <h2>先选择一个咨询项目。</h2>
          <p>每个项目都有独立的问题入口、资料沉淀、顾问审核和作战室。进入项目后再描述本次要解决的经营问题。</p>
          <div className="command-center__actions">
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              新建项目
            </button>
            {featuredVisibleProject && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => navigate(`/projects/${featuredVisibleProject.id}`)}
              >
                继续最近项目
              </button>
            )}
          </div>
        </div>
      </section>

      {creating && (
        <section className="proj-create-panel">
          <div>
            <span className="proj-panel-kicker">新建项目</span>
            <h2>新建项目</h2>
            <p>建议用项目名、品牌名或业务线命名，后续诊断、资料、作战室都会归到这里。</p>
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
              创建项目
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
            <span className="proj-panel-kicker">项目</span>
            <h2>项目工作台</h2>
          </div>
          <div className="portfolio-board__tools">
            <button
              type="button"
              className={showArchived ? "proj-filter-btn" : "proj-filter-btn proj-filter-btn--active"}
              onClick={() => setShowArchived(false)}
            >
              进行中 {activeCount}
            </button>
            <button
              type="button"
              className={showArchived ? "proj-filter-btn proj-filter-btn--active" : "proj-filter-btn"}
              onClick={() => setShowArchived(true)}
            >
              归档箱 {archivedCount}
            </button>
          </div>
        </div>

        {featuredVisibleProject && (
          <button
            type="button"
            className="portfolio-spotlight"
            onClick={() => navigate(`/projects/${featuredVisibleProject.id}`)}
          >
            <div className="portfolio-spotlight__copy">
              <span className="proj-panel-kicker">最近</span>
              <h3>{featuredVisibleProject.name}</h3>
              <p>最近更新，适合从这里继续推进。</p>
              <strong>更新于 {fmt(featuredVisibleProject.updated_at)}</strong>
              {featuredVisibleProject.memory_summary ? (
                <details className="portfolio-spotlight__detail" onClick={(event) => event.stopPropagation()}>
                  <summary>查看最近进展</summary>
                  <p>{memoryPreview(featuredVisibleProject.memory_summary)}</p>
                </details>
              ) : null}
            </div>
            <span className="portfolio-spotlight__action">进入</span>
          </button>
        )}

        <div className="proj-list">
          {projects === null && !error && <p className="proj-empty">加载中…</p>}
          {projects && projects.length === 0 && (
            <div className="proj-empty-card">
              <span>01</span>
              <h3>先创建一个项目</h3>
              <p>项目会承载问题定位、资料、诊断、作战室和复盘记录。</p>
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                创建项目
              </button>
            </div>
          )}
          {projects && projects.length > 0 && visibleProjects?.length === 0 && (
            <div className="proj-empty-card">
              <span>{showArchived ? "Archive" : "Active"}</span>
              <h3>{showArchived ? "暂无归档项目" : "没有进行中的项目"}</h3>
              <p>
                {showArchived
                  ? "被归档的项目会在这里集中保存，后续可以进入项目工作台恢复。"
                  : "当前项目都已归档。需要继续推进时，可以进入归档箱恢复项目。"}
              </p>
              {!showArchived && archivedCount > 0 && (
                <button type="button" className="btn-ghost" onClick={() => setShowArchived(true)}>
                  查看归档箱
                </button>
              )}
            </div>
          )}
          {listedProjects?.map((p, index) => (
            <article
              key={p.id}
              className={p.status === "archived" ? "proj-card proj-card--archived" : "proj-card"}
            >
              <span className="proj-card__index">{String(featuredVisibleProject ? index + 2 : index + 1).padStart(2, "0")}</span>
              <span className="proj-card__name">{p.name}</span>
              <span className="proj-card__meta">
                {p.status === "archived" ? "已归档" : "更新于"} {fmt(p.updated_at)}
              </span>
              {p.memory_summary ? (
                <span className="proj-card__memory">{memoryPreview(p.memory_summary)}</span>
              ) : (
                <span className="proj-card__memory proj-card__memory--empty">
                  尚未开始诊断。
                </span>
              )}
              <span className="proj-card__actions">
                <button type="button" className="proj-card__arrow" onClick={() => navigate(`/projects/${p.id}`)}>
                  进入
                </button>
                {p.status === "archived" ? (
                  <>
                    <button
                      type="button"
                      className="proj-card__action-btn"
                      aria-label={`恢复项目：${p.name}`}
                      disabled={busyProjectId === p.id}
                      onClick={() => void updateProjectStatus(p, "active")}
                    >
                      恢复
                    </button>
                    {deleteConfirmId === p.id ? (
                      <span className="proj-card__confirm">
                        <button
                          type="button"
                          aria-label={`确认删除项目：${p.name}`}
                          disabled={busyProjectId === p.id}
                          onClick={() => void updateProjectStatus(p, "deleted")}
                        >
                          确认删除
                        </button>
                        <button type="button" onClick={() => setDeleteConfirmId(null)}>
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="proj-card__action-btn proj-card__action-btn--danger"
                        aria-label={`删除项目：${p.name}`}
                        disabled={busyProjectId === p.id}
                        onClick={() => setDeleteConfirmId(p.id)}
                      >
                        删除
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="proj-card__action-btn"
                    aria-label={`归档项目：${p.name}`}
                    disabled={busyProjectId === p.id}
                    onClick={() => void updateProjectStatus(p, "archived")}
                  >
                    归档
                  </button>
                )}
              </span>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
