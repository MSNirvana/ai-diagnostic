import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProject } from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import type { ProjectDetail, ProjectMemoryEntry } from "../../types";
import "./ProjectDetailPage.css";

const MEMORY_LABELS: Record<string, string> = {
  problem_map: "问题地图",
  diagnosis: "诊断",
  feedback: "反馈",
};

function memoryLabel(entry: ProjectMemoryEntry): string {
  return MEMORY_LABELS[entry.entry_type] ?? entry.entry_type;
}

function activeSession(project: ProjectDetail) {
  return project.sessions.find((s) => s.status === "filling" || s.status === "confirmed" || s.status === "chatting");
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  if (error) {
    return <div style={{ padding: 40 }}><p style={{ color: "var(--signal-red)" }}>{error}</p></div>;
  }
  if (!project) {
    return <div style={{ padding: 40, color: "var(--ink-soft)" }}>加载中…</div>;
  }

  const memoryEntries = project.memory_entries ?? [];
  const currentSession = activeSession(project);
  const diagnosedCount = project.records.length;
  const latestWarRoomRecord = project.records.find((record) => record.has_war_room_plan);
  const latestMemory = memoryEntries[0]?.summary ?? "暂无归档事件";

  return (
    <AppShell
      eyebrow="Project Command Center"
      title={project.name}
      description="项目工作台将对话、问题地图、专家诊断、证据包与反馈复诊统一沉淀到一份企业长期档案。"
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={() => navigate("/projects")}>
            返回项目中心
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate(`/projects/${project.id}/diagnose`)}
          >
            新建诊断
          </button>
        </>
      }
    >
      <section className="workbench-hero">
        <div className="workbench-hero__main">
          <span>项目工作台</span>
          <h2>从一次诊断，变成持续复盘的企业档案。</h2>
          <p>{latestMemory}</p>
          <div className="workbench-hero__actions">
            {currentSession && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate(`/projects/${project.id}/diagnose`, {
                  state: { resumeSessionId: currentSession.id, projectId: project.id },
                })}
              >
                继续跟进
              </button>
            )}
            {latestWarRoomRecord && (
              <button
                type="button"
                className="btn-primary btn-primary--war"
                onClick={() =>
                  navigate(
                    `/projects/${project.id}/war-room/${latestWarRoomRecord.id}`
                  )
                }
              >
                查看最新作战室
              </button>
            )}
            <button
              type="button"
              className={currentSession || latestWarRoomRecord ? "btn-ghost" : "btn-primary"}
              onClick={() => navigate(`/projects/${project.id}/diagnose`)}
            >
              新建诊断
            </button>
          </div>
        </div>
        <div className="workbench-metrics">
          <article>
            <span>{memoryEntries.length}</span>
            <p>档案事件</p>
          </article>
          <article>
            <span>{project.sessions.length}</span>
            <p>项目会话</p>
          </article>
          <article>
            <span>{diagnosedCount}</span>
            <p>诊断记录</p>
          </article>
        </div>
      </section>

      <div className="workbench-grid">
        <section className="pd-section pd-section--memory">
          <div className="pd-section__head">
            <div>
              <span className="pd-kicker">Long-Term File</span>
              <h2 className="pd-section__title">企业长期档案</h2>
            </div>
          </div>
          {memoryEntries.length === 0 ? (
            <p className="pd-empty">还没有诊断记忆，开始一次诊断后这里会沉淀核心问题。</p>
          ) : (
            <div className="pd-memory-timeline">
              {memoryEntries.map((entry) => (
                <article key={entry.id} className={`pd-memory-card pd-memory-card--${entry.entry_type}`}>
                  <div className="pd-memory-card__meta">
                    <span>{memoryLabel(entry)}</span>
                    <time>{fmt(entry.created_at)}</time>
                  </div>
                  <p>{entry.summary}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="workbench-side">
          <section className="pd-section">
            <div className="pd-section__head">
              <div>
                <span className="pd-kicker">Engagement Threads</span>
                <h2 className="pd-section__title">项目会话</h2>
              </div>
            </div>
            {project.sessions.length === 0 ? (
              <p className="pd-empty">暂无对话记录。</p>
            ) : (
              <div className="pd-list">
                {project.sessions.map((s) => {
                  const statusCn: Record<string, string> = {
                    chatting: "对话中",
                    confirmed: "已确认问题",
                    filling: "填写中",
                    diagnosed: "已诊断",
                  };
                  const isFilling = s.status === "filling";
                  return (
                    <div key={s.id} className="pd-item">
                      <div className="pd-item__main">
                        <span className="pd-item__title">{s.title || "未命名会话"}</span>
                        <span className="pd-item__meta">
                          {fmt(s.updated_at)} · {statusCn[s.status] ?? s.status}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="pd-continue"
                        onClick={() => navigate(`/projects/${project.id}/diagnose`, {
                          state: { resumeSessionId: s.id, projectId: project.id },
                        })}
                      >
                        {isFilling ? "继续填写" : "续聊"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="pd-section">
            <div className="pd-section__head">
              <div>
                <span className="pd-kicker">Deliverables</span>
                <h2 className="pd-section__title">诊断记录</h2>
              </div>
            </div>
            {project.records.length === 0 ? (
              <p className="pd-empty">暂无诊断记录。</p>
            ) : (
              <div className="pd-list">
                {project.records.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="pd-item pd-item--clickable"
                    onClick={() =>
                      navigate(`/projects/${project.id}/war-room/${r.id}`)
                    }
                  >
                    <div className="pd-item__main">
                      <span className="pd-item__title">{fmt(r.created_at)}</span>
                      <span className="pd-item__meta">{r.module_count} 个模块</span>
                    </div>
                    <span className={`pd-item__arrow ${r.has_war_room_plan ? "pd-item__arrow--war" : ""}`}>
                      {r.has_war_room_plan ? "进入作战室" : "查看"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
