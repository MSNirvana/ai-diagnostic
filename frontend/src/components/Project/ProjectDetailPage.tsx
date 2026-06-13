import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProject } from "../../api/client";
import type { ProjectDetail } from "../../types";
import "./ProjectDetailPage.css";

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

  const memoryLines = project.memory_summary.split("\n").filter((l) => l.trim());

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

      {/* 项目记忆 */}
      <section className="pd-section">
        <h2 className="pd-section__title">项目记忆</h2>
        {memoryLines.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>还没有诊断记忆，开始一次诊断后这里会沉淀核心问题。</p>
        ) : (
          <ul className="pd-memory">
            {memoryLines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
      </section>

      {/* 诊断对话 */}
      <section className="pd-section">
        <h2 className="pd-section__title">诊断对话</h2>
        {project.sessions.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>暂无对话记录。</p>
        ) : (
          <div className="pd-list">
            {project.sessions.map((s) => (
              <div key={s.id} className="pd-item">
                <div className="pd-item__main">
                  <span className="pd-item__title">{s.title || "未命名会话"}</span>
                  <span className="pd-item__meta">{fmt(s.updated_at)} · {s.status}</span>
                </div>
                <button
                  type="button"
                  className="pd-continue"
                  onClick={() => navigate("/", { state: { resumeSessionId: s.id, projectId: project.id } })}
                >
                  续聊 →
                </button>
              </div>
            ))}
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
