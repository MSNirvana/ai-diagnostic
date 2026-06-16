import { useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { WarRoomPage } from "./components/WarRoom/WarRoomPage";
import { LoginPage } from "./components/Auth/LoginPage";
import { ProtectedRoute } from "./components/Auth/ProtectedRoute";
import { HistoryPage } from "./components/History/HistoryPage";
import { ProjectListPage } from "./components/Project/ProjectListPage";
import { ProjectDetailPage } from "./components/Project/ProjectDetailPage";
import { ProjectWarRoomPage } from "./components/Project/ProjectWarRoomPage";
import { RecordDetailPage } from "./components/Project/RecordDetailPage";
import { AdminPage } from "./components/Admin/AdminPage";
import { AppShell } from "./components/Layout/AppShell";
import { runDiagnose, runDiagnoseWithFiles } from "./api/client";
import type { DiagnoseResult, ModuleAnswer, ProblemMap } from "./types";
import "./App.css";

function ProjectDiagnoseView() {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navState = (location.state as { projectId?: string; resumeSessionId?: string }) ?? {};
  const projectId = routeProjectId ?? navState.projectId;
  const resumeSessionId = navState.resumeSessionId;
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(null);
  const [resultView, setResultView] = useState<"war-room" | "experts">("war-room");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // 有文件走 multipart 上传端点，无文件走更轻的 JSON 端点
      const data = files.length
        ? await runDiagnoseWithFiles(answers, files, sessionId, pid, problemMap)
        : await runDiagnose(answers, sessionId, pid, problemMap);
      const diagnosedProjectId = pid ?? projectId;
      if (data.war_room_plan && diagnosedProjectId) {
        navigate(`/projects/${diagnosedProjectId}/war-room`);
        return;
      }
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
      eyebrow="Diagnostic Engagement"
      title={resumeSessionId ? "继续项目诊断" : "新建诊断工作流"}
      description="围绕当前项目沉淀问题地图、专家会诊、证据包与后续反馈，形成可复诊的企业长期档案。"
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
              <span>诊断已生成，正由专业顾问复核，24 小时内出具最终报告。以下为初步结果，可先行查看。</span>
            </div>
          )}
          <div className="result-actions">
            {diagnoseResult.war_room_plan && (
              <div className="result-view-switch" aria-label="诊断结果视图切换">
                <button
                  type="button"
                  className={resultView === "war-room" ? "result-view-switch__active" : ""}
                  onClick={() => setResultView("war-room")}
                >
                  老板作战室
                </button>
                <button
                  type="button"
                  className={resultView === "experts" ? "result-view-switch__active" : ""}
                  onClick={() => setResultView("experts")}
                >
                  专家原始诊断
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
                回到项目档案
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
            <HistoryPage />
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
