import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchHistory,
  fetchRecord,
  listSessions,
  getSessionDetail,
} from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import { Dashboard } from "../Dashboard/Dashboard";
import { WarRoomPage } from "../WarRoom/WarRoomPage";
import type {
  DiagnosisSummary,
  DiagnosisDetail,
  SessionSummary,
  SessionDetail,
} from "../../types";
import { cleanDisplayText, cleanSentenceText, displayModuleLabel } from "../../utils/displayText";
import "./HistoryPage.css";

const FOCUS_LABELS: Record<string, string> = {
  market: "市场与客户", sales: "销售与增长", product: "产品与服务",
  ops: "运营与供应链", org: "组织与人才", finance: "财务与资本",
};

function reviewStatusLabel(status?: string) {
  if (status === "pending_review") return "顾问审核中";
  if (status === "approved") return "顾问已审核";
  if (status === "rejected") return "顾问已打回";
  return "待归档";
}

function sessionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    chatting: "问题定位中",
    confirmed: "问题已确认",
    filling: "资料采集中",
    diagnosed: "已生成诊断",
  };
  return labels[status] ?? status;
}

function displaySessionTitle(session: SessionSummary | SessionDetail) {
  return session.title?.trim() || "问题定位记录";
}

function messageText(content: string, role: "user" | "assistant") {
  if (role === "assistant") return cleanSentenceText(content, "暂无可展示回复。");
  return cleanDisplayText(content, "暂无可展示内容。");
}

function projectNameFor(item: DiagnosisSummary | SessionSummary) {
  return ("project_name" in item && item.project_name?.trim()) || "未归档项目";
}

function stageLabel(item: DiagnosisSummary) {
  if (item.review_status === "pending_review") return "顾问审核阶段";
  if (item.review_status === "rejected") return "资料补充阶段";
  if (item.review_status === "approved") return "作战室交付阶段";
  return "诊断归档阶段";
}

function deliverableTitle(item: DiagnosisSummary, index: number) {
  const moduleLabel = item.primary_module_label || displayModuleLabel(item.primary_module) || "综合诊断";
  const stage = item.stage?.trim() ? ` · ${item.stage.trim()}` : "";
  return cleanDisplayText(`${projectNameFor(item)}｜${stageLabel(item)}${stage}｜${moduleLabel}第 ${index + 1} 轮`, "诊断交付记录");
}

function groupHistoryItems(list: DiagnosisSummary[] | null, sessions: SessionSummary[] | null) {
  const groups = new Map<string, { records: DiagnosisSummary[]; sessions: SessionSummary[] }>();
  const ensure = (name: string) => {
    const key = name || "未归档项目";
    if (!groups.has(key)) groups.set(key, { records: [], sessions: [] });
    return groups.get(key)!;
  };
  for (const item of list ?? []) ensure(projectNameFor(item)).records.push(item);
  for (const session of sessions ?? []) ensure(projectNameFor(session)).sessions.push(session);
  return [...groups.entries()].map(([projectName, value]) => ({
    projectName,
    records: value.records,
    sessions: value.sessions,
  }));
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<DiagnosisSummary[] | null>(null);
  const [detail, setDetail] = useState<DiagnosisDetail | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
    listSessions()
      .then(setSessions)
      .catch(() => {});
  }, []);

  const openDetail = async (id: string) => {
    setError(null);
    try {
      setDetail(await fetchRecord(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  const openSession = async (id: string) => {
    setError(null);
    try {
      setSessionDetail(await getSessionDetail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");
  const groupedArchives = groupHistoryItems(list, sessions);

  return (
    <AppShell
      eyebrow="交付档案"
      title="交付档案"
      description="先看已交付、审核中和被打回的内容，再回项目工作台继续推进。"
      actions={
        <Link to="/projects" className="btn-ghost">
          返回项目组合
        </Link>
      }
    >
      {error && <p className="history-error">{error}</p>}

      {/* 会话详情视图 */}
      {sessionDetail ? (
        <>
          <button type="button" onClick={() => setSessionDetail(null)} className="history-back-btn">
            返回交付档案
          </button>
          <section className="history-panel">
            <div className="history-panel__head">
              <span>Problem Positioning</span>
              <h2>{displaySessionTitle(sessionDetail)}</h2>
            </div>
          <div className="history-chat">
            {sessionDetail.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "history-chat__user" : "history-chat__ai"}>
                {messageText(m.content, m.role)}
              </div>
            ))}
          </div>
          {sessionDetail.problem_map && (
            <div className="history-map">
              <h3>问题地图</h3>
              <p><strong>核心问题：</strong>{cleanSentenceText(sessionDetail.problem_map.core_problem, "暂未形成核心问题。")}</p>
              {sessionDetail.problem_map.goal && <p><strong>目的：</strong>{cleanSentenceText(sessionDetail.problem_map.goal, "")}</p>}
              {sessionDetail.problem_map.constraints && <p><strong>约束：</strong>{cleanSentenceText(sessionDetail.problem_map.constraints, "")}</p>}
              {sessionDetail.problem_map.diagnosis_focus && (
                <p><strong>建议优先诊断：</strong>{FOCUS_LABELS[sessionDetail.problem_map.diagnosis_focus] ?? sessionDetail.problem_map.diagnosis_focus}</p>
              )}
            </div>
          )}
          </section>
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate("/projects")}
          >
            回到项目组合
          </button>
        </>
      ) : detail ? (
        <>
          <button type="button" onClick={() => setDetail(null)} className="history-back-btn">
            返回交付档案
          </button>
          <section className="history-panel">
            <div className="history-panel__head">
              <span>Diagnostic Deliverable</span>
              <h2>诊断交付详情</h2>
              <p>交付时间：{fmt(detail.created_at)}</p>
            </div>
            {detail.review_status === "pending_review" && (
              <div className="review-banner review-banner--pending">
                <strong>顾问审核中</strong>
                <span>诊断已生成内部草稿，正由专业顾问复核。审核通过前，老板侧不展示完整作战室或专家原始判断。</span>
              </div>
            )}
            {detail.review_status === "rejected" && (
              <div className="review-banner review-banner--rejected">
                <strong>诊断已打回</strong>
                <span>顾问认为当前证据不足或结论需要修正，请回到项目工作台补充资料后重新诊断。</span>
              </div>
            )}
            {detail.review_status === "approved" && (
              <div className="review-banner review-banner--approved">
                <strong>顾问已审核</strong>
                <span>该交付已通过顾问复核，可作为经营会参考。</span>
              </div>
            )}
            {detail.consultant_notes && detail.consultant_notes.length > 0 && (
              <div className="review-banner review-banner--notes">
                <strong>顾问补充意见</strong>
                <ul>{detail.consultant_notes.map((n, i) => <li key={i}>{cleanSentenceText(n, "")}</li>)}</ul>
              </div>
            )}
            {detail.review_status === "pending_review" || detail.review_status === "rejected" ? null : detail.war_room_plan ? (
              <WarRoomPage plan={detail.war_room_plan} />
            ) : (
              <Dashboard results={detail.results} />
            )}
          </section>
        </>
      ) : (
        <>
          <section className="history-panel">
            <div className="history-panel__head">
              <span>Project Archives</span>
              <h2>按项目归档的交付记录</h2>
              <p>每个项目独立归档问题定位、顾问审核、正式交付和打回补充记录，方便从项目阶段继续推进。</p>
            </div>
            {list === null && !error && <p className="history-empty">加载中…</p>}
            {list && list.length === 0 && (!sessions || sessions.length === 0) && (
              <p className="history-empty">
                还没有诊断交付。<Link to="/projects">去项目组合创建咨询项目</Link>
              </p>
            )}
            <div className="history-projects">
              {groupedArchives.map((group) => {
                const approved = group.records.filter((item) => item.review_status === "approved");
                const pending = group.records.filter((item) => item.review_status === "pending_review");
                const rejected = group.records.filter((item) => item.review_status === "rejected");
                return (
                  <article className="history-project" key={group.projectName}>
                    <div className="history-project__head">
                      <div>
                        <span>项目档案</span>
                        <h3>{group.projectName}</h3>
                      </div>
                      <strong>{group.records.length} 份交付 · {group.sessions.length} 次定位</strong>
                    </div>

                    <HistoryStage
                      title="顾问审核阶段"
                      description="已提交但还不能进入老板侧正式作战室。"
                      items={pending}
                      empty="暂无待审核诊断。"
                      fmt={fmt}
                      openDetail={openDetail}
                    />
                    <HistoryStage
                      title="作战室交付阶段"
                      description="已通过顾问审核，可作为经营会交付查看。"
                      items={approved}
                      empty="暂无已交付作战室。"
                      fmt={fmt}
                      openDetail={openDetail}
                    />
                    <HistoryStage
                      title="资料补充阶段"
                      description="已被顾问打回，需要补充证据后重新诊断。"
                      items={rejected}
                      empty="暂无打回记录。"
                      fmt={fmt}
                      openDetail={openDetail}
                    />

                    {group.sessions.length > 0 && (
                      <section className="history-stage history-stage--sessions">
                        <div className="history-stage__head">
                          <div>
                            <h4>问题定位记录</h4>
                            <p>保留真实产生过内容的项目对话和问题地图。</p>
                          </div>
                          <span>{group.sessions.length} 条</span>
                        </div>
                        <div className="history-list">
                          {group.sessions.map((s) => (
                            <div key={s.id} className="history-item history-item--session">
                              <button type="button" className="history-item__main" onClick={() => openSession(s.id)}>
                                <span className="history-item__date">{displaySessionTitle(s)}</span>
                                <span className="history-item__count">{fmt(s.updated_at)} · {sessionStatusLabel(s.status)}</span>
                              </button>
                              <button type="button" className="history-item__continue" onClick={() => navigate("/projects")}>
                                回到项目工作台
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

function HistoryStage({
  title,
  description,
  items,
  empty,
  fmt,
  openDetail,
}: {
  title: string;
  description: string;
  items: DiagnosisSummary[];
  empty: string;
  fmt: (iso: string) => string;
  openDetail: (id: string) => Promise<void>;
}) {
  return (
    <section className="history-stage">
      <div className="history-stage__head">
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <span>{items.length} 条</span>
      </div>
      {items.length === 0 ? (
        <p className="history-stage__empty">{empty}</p>
      ) : (
        <div className="history-list">
          {items.map((item, index) => (
            <button key={item.id} type="button" className="history-item history-item--deliverable" onClick={() => openDetail(item.id)}>
              <span className="history-item__title">{deliverableTitle(item, index)}</span>
              <span className="history-item__count">
                {fmt(item.created_at)} · {item.module_count} 个数据板块
              </span>
              <span className={`history-item__status history-item__status--${item.review_status ?? "approved"}`}>
                {reviewStatusLabel(item.review_status)}
              </span>
              <span className="history-item__arrow">查看交付</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
