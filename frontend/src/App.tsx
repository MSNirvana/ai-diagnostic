import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { LoginPage } from "./components/Auth/LoginPage";
import { ProtectedRoute } from "./components/Auth/ProtectedRoute";
import { ProjectListPage } from "./components/Project/ProjectListPage";
import { ProjectDetailPage } from "./components/Project/ProjectDetailPage";
import { ProjectWarRoomPage } from "./components/Project/ProjectWarRoomPage";
import { RecordDetailPage } from "./components/Project/RecordDetailPage";
import { AdminPage } from "./components/Admin/AdminPage";
import { FreeChatPage } from "./components/FreeChat/FreeChatPage";
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
