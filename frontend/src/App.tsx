import { useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { LoginPage } from "./components/Auth/LoginPage";
import { ProtectedRoute } from "./components/Auth/ProtectedRoute";
import { HistoryPage } from "./components/History/HistoryPage";
import { ProjectListPage } from "./components/Project/ProjectListPage";
import { ProjectDetailPage } from "./components/Project/ProjectDetailPage";
import { RecordDetailPage } from "./components/Project/RecordDetailPage";
import { AdminPage } from "./components/Admin/AdminPage";
import { useAuth } from "./auth/useAuth";
import { runDiagnose, runDiagnoseWithFiles } from "./api/client";
import type { DiagnoseResult, ModuleAnswer, ProblemMap } from "./types";

function DiagnoseView() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as { projectId?: string; resumeSessionId?: string }) ?? {};
  const projectId = navState.projectId;
  const resumeSessionId = navState.resumeSessionId;
  const { logout } = useAuth();
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(null);
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
      setDiagnoseResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setDiagnoseResult(null);
    setError(null);
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ marginBottom: 32, borderBottom: "1px solid var(--line)", paddingBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "2.2rem", margin: 0, letterSpacing: "0.02em" }}>
              AI 企业诊断
            </h1>
            <p style={{ color: "var(--ink-soft)", marginTop: 8, fontSize: "1.02rem" }}>
              结构化提交企业现状，获得结论先行、数据支撑的分模块诊断。
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
            <Link
              to="/history"
              style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.9rem" }}
            >
              历史记录
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--ink-soft)",
                padding: "8px 16px",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      {loading && <p style={{ color: "var(--ink-soft)" }}>诊断进行中，正在调取数据与分析…</p>}
      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}

      {diagnoseResult ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button
              type="button"
              onClick={restart}
              style={{
                background: "transparent",
                border: "1px solid var(--accent)",
                color: "var(--accent)",
                padding: "8px 18px",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              重新诊断
            </button>
          </div>
          <Dashboard
            results={diagnoseResult.results}
            recordId={diagnoseResult.record_id}
            skillVersionIds={diagnoseResult.skill_version_ids}
            triage={diagnoseResult.triage}
          />
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
    </div>
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
        path="/"
        element={
          <ProtectedRoute>
            <DiagnoseView />
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
