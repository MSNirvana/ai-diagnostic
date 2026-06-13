import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProject } from "../../api/client";
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

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 24px" }}>
      <button type="button" className="pd-back" onClick={() => navigate("/projects")}>
        ← 返回项目列表
      </button>

      <header className="pd-head">
        <h1 className="pd-title">{project.name}</h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate("/", { state: { projectId: project.id } })}
        >
          开始新诊断
        </button>
      </header>

      {/* 企业长期档案 */}
      <section className="pd-section">
        <h2 className="pd-section__title">企业长期档案</h2>
        {memoryEntries.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>还没有诊断记忆，开始一次诊断后这里会沉淀核心问题。</p>
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

      {/* 诊断对话 */}
      <section className="pd-section">
        <h2 className="pd-section__title">诊断对话</h2>
        {project.sessions.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>暂无对话记录。</p>
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
                    onClick={() => navigate("/", { state: { resumeSessionId: s.id, projectId: project.id } })}
                  >
                    {isFilling ? "继续填写 →" : "续聊 →"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 诊断结果 */}
      <section className="pd-section">
        <h2 className="pd-section__title">诊断结果</h2>
        {project.records.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>暂无诊断记录。</p>
        ) : (
          <div className="pd-list">
            {project.records.map((r) => (
              <button
                key={r.id}
                type="button"
                className="pd-item pd-item--clickable"
                onClick={() => navigate(`/records/${r.id}`)}
              >
                <div className="pd-item__main">
                  <span className="pd-item__title">{fmt(r.created_at)}</span>
                  <span className="pd-item__meta">{r.module_count} 个模块</span>
                </div>
                <span className="pd-item__arrow">查看 →</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
