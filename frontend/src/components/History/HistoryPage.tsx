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
import "./HistoryPage.css";

const FOCUS_LABELS: Record<string, string> = {
  market: "市场与客户", sales: "营销与销售", product: "产品与服务",
  ops: "运营与供应链", org: "组织与人才", finance: "财务与资本",
};

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

  return (
    <AppShell
      eyebrow="Engagement Archive"
      title="历史记录"
      description="回看过往诊断、对话和问题地图；正式项目建议从项目工作台进入对应作战室。"
      actions={
        <Link to="/projects" className="btn-ghost">
          返回项目中心
        </Link>
      }
    >
      {error && <p className="history-error">{error}</p>}

      {/* 会话详情视图 */}
      {sessionDetail ? (
        <>
          <button type="button" onClick={() => setSessionDetail(null)} className="history-back-btn">
            返回列表
          </button>
          <section className="history-panel">
            <div className="history-panel__head">
              <span>Conversation Memory</span>
              <h2>{sessionDetail.title || "诊断对话"}</h2>
            </div>
          <div className="history-chat">
            {sessionDetail.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "history-chat__user" : "history-chat__ai"}>
                {m.content}
              </div>
            ))}
          </div>
          {sessionDetail.problem_map && (
            <div className="history-map">
              <h3>问题地图</h3>
              <p><strong>核心问题：</strong>{sessionDetail.problem_map.core_problem}</p>
              {sessionDetail.problem_map.goal && <p><strong>目的：</strong>{sessionDetail.problem_map.goal}</p>}
              {sessionDetail.problem_map.constraints && <p><strong>约束：</strong>{sessionDetail.problem_map.constraints}</p>}
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
            前往项目工作台继续
          </button>
        </>
      ) : detail ? (
        <>
          <button type="button" onClick={() => setDetail(null)} className="history-back-btn">
            返回列表
          </button>
          <section className="history-panel">
            <div className="history-panel__head">
              <span>Diagnostic Record</span>
              <h2>诊断时间：{fmt(detail.created_at)}</h2>
            </div>
            {detail.war_room_plan ? (
              <WarRoomPage plan={detail.war_room_plan} />
            ) : (
              <Dashboard results={detail.results} />
            )}
          </section>
        </>
      ) : (
        <>
          {/* 诊断对话（记忆）区 */}
          {sessions && sessions.length > 0 && (
            <section className="history-panel">
              <div className="history-panel__head">
                <span>Conversation Threads</span>
                <h2>诊断对话</h2>
              </div>
              <div className="history-list">
                {sessions.map((s) => (
                  <div key={s.id} className="history-item history-item--session">
                    <button type="button" className="history-item__main" onClick={() => openSession(s.id)}>
                      <span className="history-item__date">{s.title || "未命名会话"}</span>
                      <span className="history-item__count">{fmt(s.updated_at)} · {s.status}</span>
                    </button>
                    <button type="button" className="history-item__continue" onClick={() => navigate("/projects")}>
                      到项目继续
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 诊断结果区 */}
          <section className="history-panel">
            <div className="history-panel__head">
              <span>Deliverables</span>
              <h2>诊断结果</h2>
            </div>
            <div className="history-list">
            {list === null && !error && <p className="history-empty">加载中…</p>}
            {list && list.length === 0 && (
              <p className="history-empty">
                还没有诊断记录。<Link to="/projects">去项目中心创建诊断</Link>
              </p>
            )}
            {list?.map((item) => (
              <button key={item.id} type="button" className="history-item" onClick={() => openDetail(item.id)}>
                <span className="history-item__date">{fmt(item.created_at)}</span>
                <span className="history-item__count">{item.module_count} 个模块</span>
                <span className="history-item__arrow">查看</span>
              </button>
            ))}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
