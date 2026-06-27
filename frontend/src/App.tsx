import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { listProjects } from "./api/client";
import { LoginPage } from "./components/Auth/LoginPage";
import { ProtectedRoute } from "./components/Auth/ProtectedRoute";
import { AdminRoute } from "./components/Auth/AdminRoute";
import { ProjectListPage } from "./components/Project/ProjectListPage";
import { ProjectDetailPage } from "./components/Project/ProjectDetailPage";
import { ProjectWarRoomPage } from "./components/Project/ProjectWarRoomPage";
import { RecordDetailPage } from "./components/Project/RecordDetailPage";
import { AdminPage } from "./components/Admin/AdminPage";
import { FreeChatPage } from "./components/FreeChat/FreeChatPage";
import { PublicSupplementPage } from "./components/Supplement/PublicSupplementPage";
import { useAuth } from "./auth/useAuth";
import "./App.css";

function ProjectDiagnoseRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navState = (location.state as Record<string, unknown> | null) ?? {};
  const target = projectId ? `/projects/${projectId}` : "/projects";

  return (
    <Navigate
      to={target}
      replace
      state={{
        ...navState,
        newConversation: true,
      }}
    />
  );
}

function HomeEntryPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProjects()
      .then((projects) => {
        if (!active) return;
        const recentProject = [...projects]
          .filter((project) => project.status !== "archived" && project.status !== "deleted")
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
        navigate(recentProject ? `/projects/${recentProject.id}` : "/projects", { replace: true });
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "项目加载失败");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="home-entry-state">
        <img src="/brand-logo.png" alt="" />
        <h1>构造视界</h1>
        <p>{error}</p>
        <button type="button" onClick={() => navigate("/projects", { replace: true })}>
          打开项目列表
        </button>
      </div>
    );
  }

  return (
    <div className="home-entry-state">
      <img src="/brand-logo.png" alt="" />
      <h1>构造视界</h1>
      <p>正在打开你的最近项目…</p>
    </div>
  );
}

function HomeRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <HomeEntryPage /> : <LoginPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/supplement/:token" element={<PublicSupplementPage />} />
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
            <ProjectDiagnoseRedirect />
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
        element={<HomeRoute />}
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
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />
    </Routes>
  );
}
