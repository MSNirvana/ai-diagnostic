import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { WarRoomPage } from "./components/WarRoom/WarRoomPage";
import { LoginPage } from "./components/Auth/LoginPage";
import { ProtectedRoute } from "./components/Auth/ProtectedRoute";
import { ProjectListPage } from "./components/Project/ProjectListPage";
import { ProjectDetailPage } from "./components/Project/ProjectDetailPage";
import { ProjectWarRoomPage } from "./components/Project/ProjectWarRoomPage";
import { RecordDetailPage } from "./components/Project/RecordDetailPage";
import { AdminPage } from "./components/Admin/AdminPage";
import { FreeChatPage } from "./components/FreeChat/FreeChatPage";
import { AppShell } from "./components/Layout/AppShell";
import { createDiagnosisJob, fetchRecord, runDiagnose, runDiagnoseWithFiles } from "./api/client";
import type { DiagnoseResult, DiagnosisDetail, ModuleAnswer, ProblemMap } from "./types";
import "./App.css";

function ProjectDiagnoseView() {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navState = (location.state as { projectId?: string; resumeSessionId?: string; rejectedRecordId?: string; initialPrompt?: string }) ?? {};
  const projectId = routeProjectId ?? navState.projectId;
  const resumeSessionId = navState.resumeSessionId;
  const rejectedRecordId = navState.rejectedRecordId;
  const [supplementRecord, setSupplementRecord] = useState<DiagnosisDetail | null>(null);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(null);
  const [resultView, setResultView] = useState<"war-room" | "experts">("war-room");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rejectedRecordId) return;
    fetchRecord(rejectedRecordId)
      .then(setSupplementRecord)
      .catch((e) => setError(e instanceof Error ? e.message : "打回记录加载失败"));
  }, [rejectedRecordId]);

  const handleSubmit = async (
    answers: ModuleAnswer[],
    files: { moduleKey: string; fieldKey: string; file: File }[],
    sessionId?: string,
    pid?: string,
    problemMap?: ProblemMap
  ) => {
    setLoading(true);
    setError(null);
    try {
      const diagnosedProjectId = pid ?? projectId;
      if (diagnosedProjectId) {
        const job = await createDiagnosisJob(answers, sessionId, diagnosedProjectId, problemMap);
        navigate(`/projects/${diagnosedProjectId}`, {
          state: { deliveryStatus: "researching", jobId: job.job_id },
        });
        return;
      }
      // 有文件走 multipart 上传端点，无文件走更轻的 JSON 端点
      const data = files.length
        ? await runDiagnoseWithFiles(answers, files, sessionId, pid, problemMap)
        : await runDiagnose(answers, sessionId, pid, problemMap);
      setDiagnoseResult(data);
      setResultView(data.war_room_plan ? "war-room" : "experts");
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setDiagnoseResult(null);
    setResultView("war-room");
    setError(null);
  };

  return (
    <AppShell
      eyebrow="Diagnosis"
      title={rejectedRecordId ? "补充资料" : resumeSessionId ? "继续诊断" : "问题定位"}
      description={rejectedRecordId
        ? "按顾问意见补齐关键证据，再进入复审。"
        : "先把经营问题说清楚，再生成取数清单和诊断方案。"}
      actions={
        projectId ? (
          <button type="button" className="btn-ghost" onClick={() => navigate(`/projects/${projectId}`)}>
            返回项目工作台
          </button>
        ) : null
      }
    >
      {loading && <p className="state-note">诊断进行中，正在调取数据与分析…</p>}
      {error && <p className="state-note state-note--error">{error}</p>}

      {diagnoseResult ? (
        <>
          {diagnoseResult.review_status === "pending_review" && (
            <div className="result-review-banner">
              <strong>顾问审核中</strong>
              <span>诊断已生成内部草稿，正由专业顾问复核。审核通过后，会进入正式交付视图。</span>
            </div>
          )}
          <div className="result-actions">
            {diagnoseResult.war_room_plan && (
              <div className="result-view-switch" aria-label="诊断交付视图切换">
                <button
                  type="button"
                  className={resultView === "war-room" ? "result-view-switch__active" : ""}
                  onClick={() => setResultView("war-room")}
                >
                  作战室交付
                </button>
                <button
                  type="button"
                  className={resultView === "experts" ? "result-view-switch__active" : ""}
                  onClick={() => setResultView("experts")}
                >
                  专家诊断底稿
                </button>
              </div>
            )}
            <button type="button" className="btn-ghost" onClick={restart}>
              重新诊断
            </button>
            {projectId && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate(`/projects/${projectId}`)}
              >
                回到项目工作台
              </button>
            )}
          </div>
          {diagnoseResult.war_room_plan && resultView === "war-room" ? (
            <WarRoomPage plan={diagnoseResult.war_room_plan} />
          ) : (
            <Dashboard
              results={diagnoseResult.results}
              recordId={diagnoseResult.record_id}
              skillVersionIds={diagnoseResult.skill_version_ids}
              triage={diagnoseResult.triage}
            />
          )}
        </>
      ) : (
        !loading && (
          <Questionnaire
            onSubmit={handleSubmit}
            projectId={projectId}
            resumeSessionId={resumeSessionId}
            supplementRecord={supplementRecord}
            initialPrompt={navState.initialPrompt}
          />
        )
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/projects"
        element={
          <ProtectedRoute>
            <ProjectListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute>
            <ProjectDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/diagnose"
        element={
          <ProtectedRoute>
            <ProjectDiagnoseView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/war-room"
        element={
          <ProtectedRoute>
            <ProjectWarRoomPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/war-room/view/:section"
        element={
          <ProtectedRoute>
            <ProjectWarRoomPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Navigate to="/projects" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <Navigate to="/projects" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/brainstorm"
        element={
          <ProtectedRoute>
            <FreeChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/free-chat"
        element={
          <ProtectedRoute>
            <FreeChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/records/:id"
        element={
          <ProtectedRoute>
            <RecordDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/war-room/:recordId"
        element={
          <ProtectedRoute>
            <RecordDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
