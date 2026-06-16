import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getProject } from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import type { ProjectDetail } from "../../types";
import "./ProjectDetailPage.css";

function activeSession(project: ProjectDetail) {
  return project.sessions.find((s) => s.status === "filling" || s.status === "confirmed" || s.status === "chatting");
}

const MODULE_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "销售与增长",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
};

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("zh-CN");

  if (error) {
    return <div style={{ padding: 40 }}><p style={{ color: "var(--signal-red)" }}>{error}</p></div>;
  }
  if (!project) {
    return <div style={{ padding: 40, color: "var(--ink-soft)" }}>加载中…</div>;
  }

  const archive = project.archive;
  const currentSession = activeSession(project);
  const diagnosedCount = project.records.length;
  const hasWarRoom = Boolean(project.war_room_plan);
  const filledModules = archive.modules.filter((m) => m.has_data).length;
  // hero 一句话企业简介（纯事实：行业 · 主营 · 规模）
  const profileMap = Object.fromEntries(archive.profile.map((f) => [f.label, f.value]));
  const heroLine = [profileMap["所属行业"], profileMap["主营业务"], profileMap["规模"]]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppShell
      eyebrow="Project Command Center"
      title={project.name}
      description="项目工作台把老板填写、上传的信息整理归档，形成持续累积、保持最新的企业事实档案。"
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
          <span>企业长期档案</span>
          <h2>{profileMap["公司名称"] || project.name}</h2>
          <div className="workbench-hero__summary">
            {heroLine ? (
              <div className="workbench-hero__summary-body">
                <p>{heroLine}</p>
                {archive.last_updated && (
                  <p className="workbench-hero__updated">资料最近更新 {fmtDate(archive.last_updated)}</p>
                )}
              </div>
            ) : (
              <div className="workbench-hero__summary-body">
                <p>还没有归档信息，完成一次诊断后这里会沉淀企业资料。</p>
              </div>
            )}
          </div>
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
            {hasWarRoom && (
              <button
                type="button"
                className="btn-primary btn-primary--war"
                onClick={() => navigate(`/projects/${project.id}/war-room`)}
              >
                进入项目作战室
              </button>
            )}
            <button
              type="button"
              className={currentSession || hasWarRoom ? "btn-ghost" : "btn-primary"}
              onClick={() => navigate(`/projects/${project.id}/diagnose`)}
            >
              新建诊断
            </button>
          </div>
        </div>
        <div className="workbench-metrics">
          <article>
            <span>{filledModules}/6</span>
            <p>已归档板块</p>
          </article>
          <article>
            <span>{archive.files.length}</span>
            <p>上传资料</p>
          </article>
          <article>
            <span>{diagnosedCount}</span>
            <p>诊断次数</p>
          </article>
        </div>
      </section>

      <div className="workbench-grid">
        <section className="pd-section pd-section--memory">
          <div className="pd-section__head">
            <div>
              <span className="pd-kicker">Company File</span>
              <h2 className="pd-section__title">企业事实档案</h2>
            </div>
            {hasWarRoom && (
              <button
                type="button"
                className="pd-section__link"
                onClick={() => navigate(`/projects/${project.id}/war-room`)}
              >
                查看诊断与问题 →
              </button>
            )}
          </div>

          {/* 一、企业基本盘 */}
          <div className="pd-archive-block">
            <h3 className="pd-archive-block__title">企业基本盘</h3>
            {archive.profile.length === 0 ? (
              <p className="pd-empty">暂未提供企业基本信息。</p>
            ) : (
              <div className="pd-profile-grid">
                {archive.profile.map((f) => (
                  <div key={f.label} className="pd-profile-item">
                    <span>{f.label}</span>
                    <p>{f.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 二、经营数据档案（按 6 板块归类，纯事实） */}
          <div className="pd-archive-block">
            <h3 className="pd-archive-block__title">
              经营数据档案
              <span className="pd-archive-block__hint">{filledModules}/6 板块已提供</span>
            </h3>
            <div className="pd-fact-modules">
              {archive.modules.map((m) => {
                const isOpen = openModule === m.module;
                const preview = m.facts.slice(0, 3);
                const rest = m.facts.slice(3);
                return (
                  <div
                    key={m.module}
                    className={`pd-fact-card${m.has_data ? "" : " pd-fact-card--empty"}`}
                  >
                    <div className="pd-fact-card__head">
                      <span className="pd-fact-card__label">{m.label}</span>
                      {m.has_data ? (
                        <span className="pd-fact-card__count">{m.facts.length} 项</span>
                      ) : (
                        <span className="pd-fact-card__count pd-fact-card__count--muted">暂未提供</span>
                      )}
                    </div>
                    {m.has_data && (
                      <div className="pd-fact-list">
                        {(isOpen ? m.facts : preview).map((f) => (
                          <div key={f.label} className="pd-fact-row">
                            <span>{f.label}</span>
                            <p>{f.value}</p>
                          </div>
                        ))}
                        {rest.length > 0 && (
                          <button
                            type="button"
                            className="pd-fact-more"
                            onClick={() => setOpenModule(isOpen ? null : m.module)}
                          >
                            {isOpen ? "收起" : `展开其余 ${rest.length} 项`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 三、上传资料 */}
          <div className="pd-archive-block">
            <h3 className="pd-archive-block__title">上传资料</h3>
            {archive.files.length === 0 ? (
              <p className="pd-empty">暂无上传文件。</p>
            ) : (
              <ul className="pd-file-list">
                {archive.files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="pd-file-item">
                    <span className="pd-file-item__icon">📎</span>
                    <span className="pd-file-item__name">{f.name}</span>
                    <span className="pd-file-item__meta">
                      {MODULE_LABELS[f.module] ?? f.module} · {fmtDate(f.uploaded_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 四、信息更新记录（审计用，默认折叠） */}
          {project.records.length > 0 && (
            <div className="pd-archive-block">
              <button
                type="button"
                className="pd-timeline-toggle"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                {historyOpen
                  ? "收起信息更新记录"
                  : `查看信息更新记录（${project.records.length} 次提交）`}
              </button>
              {historyOpen && (
                <ul className="pd-update-list">
                  {project.records.map((r) => (
                    <li key={r.id} className="pd-update-item">
                      <time>{fmt(r.created_at)}</time>
                      <span>提交了 {r.module_count} 个板块的信息</span>
                    </li>
                  ))}
                </ul>
              )}
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
                      navigate(`/records/${r.id}`)
                    }
                  >
                    <div className="pd-item__main">
                      <span className="pd-item__title">{fmt(r.created_at)}</span>
                      <span className="pd-item__meta">{r.module_count} 个模块</span>
                    </div>
                    <span className="pd-item__arrow">查看记录</span>
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
