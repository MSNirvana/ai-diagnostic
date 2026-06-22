import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchRecord } from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import { Dashboard } from "../Dashboard/Dashboard";
import { WarRoomPage } from "../WarRoom/WarRoomPage";
import type { DiagnosisDetail } from "../../types";
import "../../App.css";

export function RecordDetailPage() {
  const { id, recordId, projectId } = useParams<{
    id?: string;
    recordId?: string;
    projectId?: string;
  }>();
  const diagnosisRecordId = recordId ?? id;
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DiagnosisDetail | null>(null);
  const [view, setView] = useState<"war-room" | "experts">("war-room");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!diagnosisRecordId) return;
    fetchRecord(diagnosisRecordId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [diagnosisRecordId]);

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  return (
    <AppShell
      eyebrow="Diagnostic Deliverable"
      title="诊断交付详情"
      description={detail ? `交付时间：${fmt(detail.created_at)}` : "正在载入诊断交付"}
      actions={
        <>
          {projectId && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => navigate(`/projects/${projectId}`)}
            >
              返回项目工作台
            </button>
          )}
          {!projectId && (
            <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
              返回
            </button>
          )}
        </>
      }
    >
      {error && <p className="state-note state-note--error">{error}</p>}
      {!detail && !error && <p className="state-note">加载中…</p>}

      {detail && (
        <>
          {detail.review_status === "pending_review" && (
            <div className="result-review-banner">
              <strong>顾问审核中</strong>
              <span>这份诊断已经生成内部草稿，正在由顾问复核。审核通过前，老板侧不展示完整作战室或专家原始判断。</span>
            </div>
          )}
          {detail.review_status === "rejected" && (
            <div className="result-review-banner result-review-banner--rejected">
              <strong>诊断已打回</strong>
              <span>顾问认为当前证据不足或结论需要修正，请回到项目工作台补充资料后重新诊断。</span>
            </div>
          )}
          {detail.review_status === "approved" && (
            <div className="result-review-banner result-review-banner--approved">
              <strong>顾问已审核</strong>
              <span>该交付已通过顾问复核，可进入作战室交付视图继续查看。</span>
            </div>
          )}
          {detail.war_room_plan && (
            <div className="result-actions">
              <div className="result-view-switch" aria-label="诊断交付视图切换">
                <button
                  type="button"
                  className={view === "war-room" ? "result-view-switch__active" : ""}
                  onClick={() => setView("war-room")}
                >
                  作战室交付
                </button>
                <button
                  type="button"
                  className={view === "experts" ? "result-view-switch__active" : ""}
                  onClick={() => setView("experts")}
                >
                  专家诊断底稿
                </button>
              </div>
            </div>
          )}
          {detail.review_status === "pending_review" || detail.review_status === "rejected" ? null : detail.war_room_plan && view === "war-room" ? (
            <WarRoomPage plan={detail.war_room_plan} />
          ) : (
            <Dashboard results={detail.results} />
          )}
        </>
      )}
    </AppShell>
  );
}
