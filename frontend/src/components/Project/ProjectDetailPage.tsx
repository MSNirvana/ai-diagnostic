import { useEffect, useMemo, useState } from "react";
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

const MODULE_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "销售与增长",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
};

const SIGNAL_LABELS: Record<string, string> = {
  red: "需立即关注",
  yellow: "持续观察",
  green: "状态健康",
};

const FOCUS_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "销售与增长",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finishSentence(value: unknown): string {
  const text = normalizeText(value).replace(/[；;，,\s]+$/g, "");
  if (!text) return "";
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function sentenceList(values: unknown[]): string[] {
  return values.map(finishSentence).filter(Boolean);
}

function splitSummary(text: string): string[] {
  return text
    .split("；")
    .map(finishSentence)
    .filter(Boolean);
}

function joinDetail(items: string[]): string {
  return items.filter(Boolean).join(" · ");
}

function isLongText(text: string, threshold = 140): boolean {
  return text.trim().length > threshold;
}

function problemMapRows(payload: Record<string, unknown>) {
  const focus = FOCUS_LABELS[normalizeText(payload.diagnosis_focus)] ?? normalizeText(payload.diagnosis_focus);
  const rows = [
    { label: "核心问题", value: finishSentence(payload.core_problem), tone: "lead" as const },
    { label: "目标", value: finishSentence(payload.goal), tone: "normal" as const },
    { label: "约束", value: finishSentence(payload.constraints), tone: "note" as const },
    { label: "成功标准", value: finishSentence(payload.success_criteria), tone: "normal" as const },
    { label: "影响", value: finishSentence(payload.impact), tone: "note" as const },
    {
      label: "优先诊断",
      value: focus ? finishSentence(`优先进入${focus}诊断`) : "",
      tone: "note" as const,
    },
  ];
  return rows.filter((row) => row.value);
}

function diagnosisRows(payload: Record<string, unknown>) {
  const topModule = String(payload.top_module ?? "").trim();
  const signal = String(payload.signal ?? "").trim();
  const moduleLabel = MODULE_LABELS[topModule] ?? topModule;
  const signalLabel = SIGNAL_LABELS[signal] ?? signal;
  const conclusion = finishSentence(payload.conclusion);
  const actions = Array.isArray(payload.actions)
    ? sentenceList(payload.actions)
    : [];
  const triage = typeof payload.triage === "object" && payload.triage ? (payload.triage as Record<string, unknown>) : null;
  const priorityActions = Array.isArray(triage?.priority_actions)
    ? sentenceList(triage.priority_actions)
    : [];

  return {
    signal,
    signalLabel,
    moduleLabel,
    badge: joinDetail([
      moduleLabel,
      signalLabel,
    ]),
    conclusion,
    actions,
    priorityActions,
  };
}

function feedbackRows(payload: Record<string, unknown>) {
  const rating = payload.rating ? `${payload.rating}/5` : "";
  const useful = payload.is_useful === true ? "有帮助" : payload.is_useful === false ? "待改进" : "";
  return [
    { label: "评价", value: finishSentence(joinDetail([useful, rating])) },
    { label: "反馈内容", value: finishSentence(payload.comment) },
    { label: "对应模块", value: finishSentence(MODULE_LABELS[String(payload.module ?? "").trim()] ?? String(payload.module ?? "").trim()) },
  ].filter((row) => row.value);
}

function memoryHighlightLines(entry: ProjectMemoryEntry): string[] {
  if (entry.entry_type === "diagnosis") {
    const rows = diagnosisRows(entry.payload);
    return [rows.conclusion].filter(Boolean);
  }
  if (entry.entry_type === "problem_map") {
    const rows = problemMapRows(entry.payload);
    const core = rows.find((row) => row.label === "核心问题")?.value;
    return [core ? `核心问题：${core}` : ""].filter(Boolean);
  }
  if (entry.entry_type === "feedback") {
    const rows = feedbackRows(entry.payload);
    if (rows.length > 0) {
      return rows.slice(0, 1).map((row) => `${row.label}：${row.value}`).filter(Boolean);
    }
  }
  return splitSummary(entry.summary);
}

function renderEntryLead(entry: ProjectMemoryEntry) {
  const lines = memoryHighlightLines(entry);
  if (lines.length === 0) return null;

  return (
    <div className={`pd-memory-lead pd-memory-lead--${entry.entry_type}`}>
      <span>重点</span>
      {lines.slice(0, 2).map((line, index) => (
        <p key={`${entry.id}-lead-${index}`}>{line}</p>
      ))}
    </div>
  );
}

function renderEntryBody(entry: ProjectMemoryEntry, expanded: boolean) {
  if (entry.entry_type === "problem_map") {
    const rows = problemMapRows(entry.payload);
    if (rows.length === 0) {
      return renderSummaryFallback(entry);
    }
    const subProblems = Array.isArray(entry.payload.sub_problems)
      ? sentenceList(entry.payload.sub_problems)
      : [];
    const visibleRows = rows
      .filter((row) => row.label !== "核心问题")
      .filter((row) => expanded || row.tone !== "note")
      .slice(0, expanded ? rows.length : 3);
    return (
      <>
        <div className="pd-memory-grid">
          {visibleRows.map((row) => (
            <div key={`${entry.id}-${row.label}`} className={`pd-memory-fact pd-memory-fact--${row.tone}`}>
              <span>{row.label}</span>
              <p>{row.value}</p>
            </div>
          ))}
        </div>
        {expanded && subProblems.length > 0 && (
          <div className="pd-memory-detail-block">
            <span>相关子问题</span>
            <ul className="pd-memory-list">
              {subProblems.map((item, index) => (
                <li key={`${entry.id}-sub-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (entry.entry_type === "diagnosis") {
    const rows = diagnosisRows(entry.payload);
    if (!rows.conclusion && rows.actions.length === 0) {
      return renderSummaryFallback(entry);
    }
    return (
      <>
        <div className="pd-memory-grid">
          {rows.badge && (
            <div className="pd-memory-fact pd-memory-fact--lead">
              <span>本次主判断</span>
              <p>{rows.badge}</p>
            </div>
          )}
          {rows.actions[0] && (
            <div className="pd-memory-fact">
              <span>首要动作</span>
              <p>{rows.actions[0]}</p>
            </div>
          )}
        </div>
        {expanded && rows.actions.length > 1 && (
          <div className="pd-memory-detail-block">
            <span>建议动作</span>
            <ul className="pd-memory-list">
              {rows.actions.slice(1).map((item, index) => (
                <li key={`${entry.id}-action-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {expanded && rows.priorityActions.length > 0 && (
          <div className="pd-memory-detail-block">
            <span>联动优先级</span>
            <ul className="pd-memory-list">
              {rows.priorityActions.map((item, index) => (
                <li key={`${entry.id}-priority-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  if (entry.entry_type === "feedback") {
    const rows = feedbackRows(entry.payload);
    if (rows.length === 0) {
      return null;
    }
    return (
      <div className="pd-memory-grid">
        {rows.slice(0, expanded ? rows.length : 2).map((row) => (
          <div key={`${entry.id}-${row.label}`} className="pd-memory-fact pd-memory-fact--note">
            <span>{row.label}</span>
            <p>{row.value}</p>
          </div>
        ))}
      </div>
    );
  }

  return renderSummaryFallback(entry);
}

function renderSummaryFallback(entry: ProjectMemoryEntry) {
  const sections = splitSummary(entry.summary);
  return (
    <div className="pd-memory-summary">
      {sections.map((section, index) => (
        <p key={`${entry.id}-summary-${index}`}>{section}</p>
      ))}
    </div>
  );
}

function entryNeedsExpand(entry: ProjectMemoryEntry): boolean {
  if (entry.entry_type === "problem_map") {
    const rowCount = problemMapRows(entry.payload).length;
    const subProblemCount = Array.isArray(entry.payload.sub_problems) ? entry.payload.sub_problems.length : 0;
    return rowCount > 3 || subProblemCount > 0 || isLongText(entry.summary);
  }
  if (entry.entry_type === "diagnosis") {
    const { actions, priorityActions } = diagnosisRows(entry.payload);
    return actions.length > 1 || priorityActions.length > 0;
  }
  if (entry.entry_type === "feedback") {
    return feedbackRows(entry.payload).length > 2 || isLongText(entry.summary, 100);
  }
  return isLongText(entry.summary);
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});
  const [heroExpanded, setHeroExpanded] = useState(false);

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  const memoryEntries = project?.memory_entries ?? [];
  const latestEntry = memoryEntries[0] ?? null;
  const latestHighlights = useMemo(() => {
    if (!latestEntry) return ["暂无归档事件"];
    const lines = memoryHighlightLines(latestEntry);
    if (heroExpanded) return lines;
    return lines.slice(0, 2);
  }, [heroExpanded, latestEntry]);

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  if (error) {
    return <div style={{ padding: 40 }}><p style={{ color: "var(--signal-red)" }}>{error}</p></div>;
  }
  if (!project) {
    return <div style={{ padding: 40, color: "var(--ink-soft)" }}>加载中…</div>;
  }

  const memoryEntriesResolved = project.memory_entries ?? [];
  const currentSession = activeSession(project);
  const diagnosedCount = project.records.length;
  const hasWarRoom = Boolean(project.war_room_plan);

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
          <div className="workbench-hero__summary">
            {latestEntry ? (
              <>
                <div className="workbench-hero__summary-meta">
                  <strong>{memoryLabel(latestEntry)}</strong>
                  <span>{fmt(latestEntry.created_at)}</span>
                </div>
                <div className="workbench-hero__summary-body">
                  {latestHighlights.map((line, index) => (
                    <p key={`${latestEntry.id}-hero-${index}`}>{line}</p>
                  ))}
                  {!heroExpanded && latestHighlights.length === 0 && <p>暂无归档事件</p>}
                </div>
                {entryNeedsExpand(latestEntry) && (
                  <button
                    type="button"
                    className="pd-inline-toggle"
                    onClick={() => setHeroExpanded((value) => !value)}
                  >
                    {heroExpanded ? "收起本次摘要" : "展开本次摘要"}
                  </button>
                )}
              </>
            ) : (
              <div className="workbench-hero__summary-body">
                <p>暂无归档事件</p>
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
            <span>{memoryEntriesResolved.length}</span>
            <p>档案事件</p>
          </article>
          <article>
            <span>{project.sessions.length}</span>
            <p>项目会话</p>
          </article>
          <article>
            <span>{project.war_room_plan?.iteration_count ?? diagnosedCount}</span>
            <p>作战室迭代</p>
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
          {memoryEntriesResolved.length === 0 ? (
            <p className="pd-empty">还没有诊断记忆，开始一次诊断后这里会沉淀核心问题。</p>
          ) : (
            <div className="pd-memory-timeline">
              {memoryEntriesResolved.map((entry) => (
                <article key={entry.id} className={`pd-memory-card pd-memory-card--${entry.entry_type}`}>
                  <div className="pd-memory-card__meta">
                    <span>{memoryLabel(entry)}</span>
                    <time>{fmt(entry.created_at)}</time>
                  </div>
                  {renderEntryLead(entry)}
                  {renderEntryBody(entry, Boolean(expandedEntries[entry.id]))}
                  {entryNeedsExpand(entry) && (
                    <button
                      type="button"
                      className="pd-inline-toggle"
                      onClick={() =>
                        setExpandedEntries((current) => ({
                          ...current,
                          [entry.id]: !current[entry.id],
                        }))
                      }
                    >
                      {expandedEntries[entry.id] ? "收起详情" : "展开详情"}
                    </button>
                  )}
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
