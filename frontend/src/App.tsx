import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { createProject, listProjects } from "./api/client";
import { LoginPage } from "./components/Auth/LoginPage";
import { ProtectedRoute } from "./components/Auth/ProtectedRoute";
import { AdminRoute } from "./components/Auth/AdminRoute";
import { ProjectDetailPage } from "./components/Project/ProjectDetailPage";
import { ProjectWarRoomPage } from "./components/Project/ProjectWarRoomPage";
import { RecordDetailPage } from "./components/Project/RecordDetailPage";
import { AdminPage } from "./components/Admin/AdminPage";
import { FreeChatPage } from "./components/FreeChat/FreeChatPage";
import { PublicSupplementPage } from "./components/Supplement/PublicSupplementPage";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { ProjectWorkspaceShell } from "./components/Project/ProjectWorkspaceShell";
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
  const [showNoProjectHome, setShowNoProjectHome] = useState(false);

  useEffect(() => {
    let active = true;
    setShowNoProjectHome(false);
    listProjects()
      .then((projects) => {
        if (!active) return;
        const recentProject = [...projects]
          .filter((project) => project.status !== "archived" && project.status !== "deleted")
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
        if (recentProject) {
          navigate(`/projects/${recentProject.id}`, { replace: true });
          return;
        }
        setShowNoProjectHome(true);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "项目加载失败");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (showNoProjectHome) {
    return <NoProjectHomePage />;
  }

  if (error) {
    return (
      <div className="home-entry-state">
        <img src="/brand-logo.png" alt="" />
        <h1>构造视界</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新打开主页
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

function NoProjectHomePage({ requireAuth = false }: { requireAuth?: boolean }) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const pseudoProject = {
    id: "__home__",
    name: "构造视界",
    status: "active",
    sessions: [],
    brainstorm_sessions: [],
  };

  const openCreateProject = (text: string) => {
    setPendingPrompt(text);
    setCreateError("");
    if (requireAuth) {
      setLoginOpen(true);
      return false;
    }
    setPickerOpen(true);
    return false;
  };

  const requireLogin = () => {
    setPendingPrompt("");
    setCreateError("");
    setLoginOpen(true);
  };

  const createAndContinue = async () => {
    const name = projectName.trim();
    if (!name) {
      setCreateError("请先给这个咨询项目起个名字。");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const project = await createProject(name);
      navigate(`/projects/${project.id}`, {
        replace: true,
        state: {
          projectSnapshot: project,
          newConversation: true,
          initialPrompt: pendingPrompt,
          autoSendInitialPrompt: Boolean(pendingPrompt.trim()),
        },
      });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建项目失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <ProjectWorkspaceShell
      project={pseudoProject}
      activeSection="new"
      conversationLayout="chat"
      placeholderProject
      onRequireProject={requireAuth ? requireLogin : () => {
          setPendingPrompt("");
          setCreateError("");
          setPickerOpen(true);
        }}
      onNewConversation={() => {
        setPendingPrompt("");
        setResetKey((key) => key + 1);
      }}
    >
      <div
        id="project-page-start"
        className="project-page-panel project-page-panel--chat-only"
        role="tabpanel"
        aria-label="新对话"
      >
        <section className="project-chat-console">
          <Questionnaire
            key={`no-project-${resetKey}`}
            onSubmit={() => {}}
            variant="project-inline"
            projectMode="consulting"
            onBeforeSend={openCreateProject}
          />
        </section>
      </div>

      {pickerOpen && (
        <div className="home-project-required-overlay" role="presentation" onMouseDown={() => setPickerOpen(false)}>
          <section
            className="home-project-required-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-project-required-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="home-project-required-panel__head">
              <div>
                <span>项目列表</span>
                <h2 id="home-project-required-title">先创建一个项目</h2>
              </div>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>
            <p className="home-project-required-panel__hint">
              这句话会自动带入新项目继续发送，不会丢失。
            </p>
            {pendingPrompt && (
              <div className="home-project-required-panel__prompt">
                <span>待发送内容</span>
                <strong>{pendingPrompt}</strong>
              </div>
            )}
            <div className="home-project-required-panel__create">
              <input
                value={projectName}
                autoFocus
                placeholder="项目名称，如：奈雪增长诊断"
                onChange={(event) => setProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createAndContinue();
                }}
              />
              <button type="button" disabled={creating} onClick={() => void createAndContinue()}>
                {creating ? "创建中" : "创建并继续"}
              </button>
            </div>
            {createError && <p className="home-project-required-panel__error">{createError}</p>}
          </section>
        </div>
      )}

      {loginOpen && (
        <div className="home-login-overlay" role="presentation" onMouseDown={() => setLoginOpen(false)}>
          <div className="home-login-overlay__panel" onMouseDown={(event) => event.stopPropagation()}>
            <LoginPage modal onClose={() => setLoginOpen(false)} returnTo="/" />
          </div>
        </div>
      )}
    </ProjectWorkspaceShell>
  );
}

function HomeRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <HomeEntryPage /> : <NoProjectHomePage requireAuth />;
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
            <HomeEntryPage />
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
