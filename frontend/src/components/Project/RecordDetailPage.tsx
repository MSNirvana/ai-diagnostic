import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchRecord } from "../../api/client";
import { AppShell } from "../Layout/AppShell";
import { Dashboard } from "../Dashboard/Dashboard";
import { WarRoomPage } from "../WarRoom/WarRoomPage";
import type { DiagnosisDetail } from "../../types";

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
      eyebrow="Diagnostic Record"
      title="诊断结果"
      description={detail ? `诊断时间：${fmt(detail.created_at)}` : "正在载入诊断记录"}
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
      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}
      {!detail && !error && <p style={{ color: "var(--ink-soft)" }}>加载中…</p>}

      {detail && (
        <>
          {detail.war_room_plan && (
            <div className="result-actions">
              <div className="result-view-switch" aria-label="诊断记录视图切换">
                <button
                  type="button"
                  className={view === "war-room" ? "result-view-switch__active" : ""}
                  onClick={() => setView("war-room")}
                >
                  老板作战室
                </button>
                <button
                  type="button"
                  className={view === "experts" ? "result-view-switch__active" : ""}
                  onClick={() => setView("experts")}
                >
                  专家原始诊断
                </button>
              </div>
            </div>
          )}
          {detail.war_room_plan && view === "war-room" ? (
            <WarRoomPage plan={detail.war_room_plan} />
          ) : (
            <Dashboard results={detail.results} />
          )}
        </>
      )}
    </AppShell>
  );
}
