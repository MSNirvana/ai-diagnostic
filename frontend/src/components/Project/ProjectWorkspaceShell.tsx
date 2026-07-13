import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createProject, deleteBrainstormSession, deleteSession, fetchMe, listProjects, patchProject, updateBrainstormSession, updateSession } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { useIsAdmin } from "../../auth/useIsAdmin";
import type { MeResponse, ProjectBrainstormBrief, ProjectDetail, ProjectSessionBrief, ProjectSummary } from "../../types";
import "./ProjectWorkspaceShell.css";

type ProjectWorkspaceSection = "new" | "archive" | "warroom" | "transform";

interface ProjectWorkspaceShellProps {
  project: Pick<ProjectDetail, "id" | "name" | "status"> & { sessions?: ProjectSessionBrief[]; brainstorm_sessions?: ProjectBrainstormBrief[] };
  activeSection: ProjectWorkspaceSection;
  conversationLayout?: "chat" | "form";
  children: ReactNode;
  onNewConversation?: () => void;
  onResumeSession?: (sessionId: string) => void;
  onResumeBrainstorm?: (brainstormId: string) => void;
  onNewBrainstorm?: () => void;
  onOpenArchive?: () => void;
  placeholderProject?: boolean;
  onRequireProject?: () => void;
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

function sessionTitle(title: string) {
  return title.trim() || "问题定位记录";
}

function sortSessions(sessions: ProjectSessionBrief[]) {
  return [...sessions].sort((a, b) => {
    if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function sortBrainstorms(items: ProjectBrainstormBrief[]) {
  return [...items].sort((a, b) => {
    if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

function projectLogoStorageKey(projectId: string) {
  return `ruice:project-logo:${projectId}`;
}

function projectSidebarStorageKey() {
  return "ruice:project-sidebar-collapsed";
}

function readProjectLogo(projectId: string) {
  try {
    if (typeof window.localStorage?.getItem !== "function") return "";
    const stored = window.localStorage.getItem(projectLogoStorageKey(projectId));
    return stored?.startsWith("data:image/") ? stored : "";
  } catch {
    return "";
  }
}

function readSidebarCollapsed() {
  try {
    if (typeof window.localStorage?.getItem !== "function") return false;
    return window.localStorage.getItem(projectSidebarStorageKey()) === "1";
  } catch {
    return false;
  }
}

export function ProjectWorkspaceShell({
  project,
  activeSection,
  conversationLayout = "chat",
  children,
  onNewConversation,
  onResumeSession,
  onResumeBrainstorm,
  onNewBrainstorm,
  onOpenArchive,
  placeholderProject = false,
  onRequireProject,
}: ProjectWorkspaceShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, token } = useAuth();
  const isAdmin = useIsAdmin();
  const [sessions, setSessions] = useState<ProjectSessionBrief[]>(() => sortSessions(project.sessions ?? []));
  const [brainstorms, setBrainstorms] = useState<ProjectBrainstormBrief[]>(() => sortBrainstorms(project.brainstorm_sessions ?? []));
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openBrainstormMenuId, setOpenBrainstormMenuId] = useState<string | null>(null);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameBrainstormId, setRenameBrainstormId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBrainstormConfirmId, setDeleteBrainstormConfirmId] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [pendingBrainstormId, setPendingBrainstormId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [brainstormError, setBrainstormError] = useState("");
  const [historyMode, setHistoryMode] = useState<"conversation" | "brainstorm">("conversation");
  const [projectLogo, setProjectLogo] = useState(() => readProjectLogo(project.id));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerLoading, setProjectPickerLoading] = useState(false);
  const [projectPickerError, setProjectPickerError] = useState("");
  const [projectPickerItems, setProjectPickerItems] = useState<ProjectSummary[]>([]);
  const [projectPickerArchived, setProjectPickerArchived] = useState(false);
  const [projectPickerCreating, setProjectPickerCreating] = useState(false);
  const [projectPickerNewName, setProjectPickerNewName] = useState("");
  const [projectPickerBusyId, setProjectPickerBusyId] = useState<string | null>(null);
  const [projectPickerMenuId, setProjectPickerMenuId] = useState<string | null>(null);
  const [projectPickerRenameId, setProjectPickerRenameId] = useState<string | null>(null);
  const [projectPickerRenameValue, setProjectPickerRenameValue] = useState("");
  const [projectPickerDeleteConfirmId, setProjectPickerDeleteConfirmId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<MeResponse | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const sessionSignature = useMemo(
    () => (project.sessions ?? []).map((s) => `${s.id}:${s.title}:${s.updated_at}:${s.is_pinned ? 1 : 0}`).join("|"),
    [project.sessions]
  );
  const visibleSessions = useMemo(() => sortSessions(sessions), [sessions]);
  const brainstormSignature = useMemo(
    () => (project.brainstorm_sessions ?? []).map((s) => `${s.id}:${s.title}:${s.updated_at}:${s.is_pinned ? 1 : 0}`).join("|"),
    [project.brainstorm_sessions]
  );
  const visibleBrainstorms = useMemo(() => sortBrainstorms(brainstorms), [brainstorms]);
  const projectSnapshot = {
    id: project.id,
    name: project.name,
    status: project.status,
    sessions: visibleSessions,
    brainstorm_sessions: visibleBrainstorms,
  };

  useEffect(() => {
    setSessions(sortSessions(project.sessions ?? []));
  }, [project.id, sessionSignature]);

  useEffect(() => {
    setBrainstorms(sortBrainstorms(project.brainstorm_sessions ?? []));
  }, [project.id, brainstormSignature]);

  useEffect(() => {
    const page = new URLSearchParams(location.search).get("page");
    if (page === "brainstorm") {
      setHistoryMode("brainstorm");
    }
  }, [location.search]);

  useEffect(() => {
    setProjectLogo(readProjectLogo(project.id));
  }, [project.id, project.name]);

  useEffect(() => {
    try {
      if (typeof window.localStorage?.setItem === "function") {
        window.localStorage.setItem(projectSidebarStorageKey(), sidebarCollapsed ? "1" : "0");
      }
    } catch {
      // Sidebar collapse state is optional; ignore storage failures.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!openMenuId && !openBrainstormMenuId) return;

    const closeHistoryMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".project-workspace-history__menu")
        || target.closest(".project-workspace-history__more")
      ) {
        return;
      }
      setOpenMenuId(null);
      setOpenBrainstormMenuId(null);
      setRenameSessionId(null);
      setRenameBrainstormId(null);
      setDeleteConfirmId(null);
      setDeleteBrainstormConfirmId(null);
    };

    document.addEventListener("pointerdown", closeHistoryMenus, true);
    return () => document.removeEventListener("pointerdown", closeHistoryMenus, true);
  }, [openMenuId, openBrainstormMenuId]);

  useEffect(() => {
    if (!projectPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectPickerOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [projectPickerOpen]);

  useEffect(() => {
    if (!token) {
      setCurrentUser(null);
      return;
    }
    let active = true;
    let request: Promise<MeResponse>;
    try {
      request = fetchMe();
    } catch {
      setCurrentUser(null);
      return;
    }
    request
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        if (active) setCurrentUser(null);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const navigateStable = (target: string, state?: Record<string, unknown>) => {
    const current = `${location.pathname}${location.search}`;
    if (current === target) return false;
    navigate(target, {
      preventScrollReset: true,
      state: { projectSnapshot, ...state },
    });
    return true;
  };

  const openProjectLogoPicker = () => {
    logoInputRef.current?.click();
  };

  const loadProjectPicker = () => {
    setProjectPickerLoading(true);
    setProjectPickerError("");
    setProjectPickerMenuId(null);
    setProjectPickerRenameId(null);
    setProjectPickerDeleteConfirmId(null);
    listProjects()
      .then((items) => setProjectPickerItems(items))
      .catch((error) => setProjectPickerError(error instanceof Error ? error.message : "项目列表加载失败"))
      .finally(() => setProjectPickerLoading(false));
  };

  const openProjectPicker = () => {
    if (placeholderProject && !token) {
      onRequireProject?.();
      return;
    }
    setProjectPickerOpen(true);
    loadProjectPicker();
  };

  const toggleSidebarCollapsed = () => {
    setOpenMenuId(null);
    setOpenBrainstormMenuId(null);
    setRenameSessionId(null);
    setRenameBrainstormId(null);
    setDeleteConfirmId(null);
    setDeleteBrainstormConfirmId(null);
    setSidebarCollapsed((current) => !current);
  };

  const changeProjectLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) return;
      setProjectLogo(dataUrl);
      try {
        if (typeof window.localStorage?.setItem === "function") {
          window.localStorage.setItem(projectLogoStorageKey(project.id), dataUrl);
        }
      } catch {
        // Local custom logo is optional; ignore storage failures.
      }
    };
    reader.readAsDataURL(file);
  };

  const openNewConversation = () => {
    if (placeholderProject) {
      onNewConversation?.();
      return;
    }
    navigate(`/projects/${project.id}`, {
      replace: false,
      preventScrollReset: true,
      state: {
        projectSnapshot,
        newConversation: true,
        resumeSessionId: undefined,
      },
    });
    onNewConversation?.();
  };

  const openArchive = () => {
    if (placeholderProject) {
      onRequireProject?.();
      return;
    }
    if (navigateStable(`/projects/${project.id}?page=archive`)) {
      onOpenArchive?.();
    }
  };

  const openWarRoom = () => {
    if (placeholderProject) {
      onRequireProject?.();
      return;
    }
    navigateStable(`/projects/${project.id}/war-room`);
  };

  const resumeSession = (sessionId: string) => {
    setOpenMenuId(null);
    setRenameSessionId(null);
    setDeleteConfirmId(null);
    navigateStable(`/projects/${project.id}`, { resumeSessionId: sessionId });
    onResumeSession?.(sessionId);
  };

  const toggleSessionMenu = (sessionId: string) => {
    setSessionError("");
    setRenameSessionId(null);
    setDeleteConfirmId(null);
    setOpenMenuId((current) => (current === sessionId ? null : sessionId));
  };

  const switchHistoryMode = (mode: "conversation" | "brainstorm") => {
    setHistoryMode(mode);
    setOpenMenuId(null);
    setOpenBrainstormMenuId(null);
    setRenameSessionId(null);
    setRenameBrainstormId(null);
    setDeleteConfirmId(null);
    setDeleteBrainstormConfirmId(null);
  };

  const resumeBrainstorm = (brainstormId: string) => {
    setOpenBrainstormMenuId(null);
    setRenameBrainstormId(null);
    setDeleteBrainstormConfirmId(null);
    navigateStable(`/projects/${project.id}?page=brainstorm&brainstormId=${brainstormId}`);
    onResumeBrainstorm?.(brainstormId);
  };

  const toggleBrainstormMenu = (brainstormId: string) => {
    setBrainstormError("");
    setRenameBrainstormId(null);
    setDeleteBrainstormConfirmId(null);
    setOpenBrainstormMenuId((current) => (current === brainstormId ? null : brainstormId));
  };

  const togglePinSession = async (target: ProjectSessionBrief) => {
    setPendingSessionId(target.id);
    setSessionError("");
    try {
      const updated = await updateSession(target.id, { is_pinned: !target.is_pinned });
      setSessions((items) => sortSessions(items.map((item) => (
        item.id === target.id ? { ...item, ...updated } : item
      ))));
      setOpenMenuId(null);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "更新会话失败");
    } finally {
      setPendingSessionId(null);
    }
  };

  const beginRenameSession = (target: ProjectSessionBrief) => {
    setRenameSessionId(target.id);
    setRenameValue(sessionTitle(target.title));
    setDeleteConfirmId(null);
  };

  const togglePinBrainstorm = async (target: ProjectBrainstormBrief) => {
    setPendingBrainstormId(target.id);
    setBrainstormError("");
    try {
      const updated = await updateBrainstormSession(target.id, { is_pinned: !target.is_pinned });
      setBrainstorms((items) => sortBrainstorms(items.map((item) => (
        item.id === target.id ? { ...item, ...updated } : item
      ))));
      setOpenBrainstormMenuId(null);
    } catch (error) {
      setBrainstormError(error instanceof Error ? error.message : "更新风暴记录失败");
    } finally {
      setPendingBrainstormId(null);
    }
  };

  const beginRenameBrainstorm = (target: ProjectBrainstormBrief) => {
    setRenameBrainstormId(target.id);
    setRenameValue(sessionTitle(target.title));
    setDeleteBrainstormConfirmId(null);
  };

  const submitRenameSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameSessionId) return;
    const title = renameValue.trim();
    if (!title) return;
    setPendingSessionId(renameSessionId);
    setSessionError("");
    try {
      const updated = await updateSession(renameSessionId, { title });
      setSessions((items) => sortSessions(items.map((item) => (
        item.id === renameSessionId ? { ...item, ...updated } : item
      ))));
      setRenameSessionId(null);
      setOpenMenuId(null);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setPendingSessionId(null);
    }
  };

  const submitRenameBrainstorm = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameBrainstormId) return;
    const title = renameValue.trim();
    if (!title) return;
    setPendingBrainstormId(renameBrainstormId);
    setBrainstormError("");
    try {
      const updated = await updateBrainstormSession(renameBrainstormId, { title });
      setBrainstorms((items) => sortBrainstorms(items.map((item) => (
        item.id === renameBrainstormId ? { ...item, ...updated } : item
      ))));
      setRenameBrainstormId(null);
      setOpenBrainstormMenuId(null);
    } catch (error) {
      setBrainstormError(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setPendingBrainstormId(null);
    }
  };

  const confirmDeleteSession = async (target: ProjectSessionBrief) => {
    const previous = sessions;
    setPendingSessionId(target.id);
    setSessionError("");
    setSessions((items) => items.filter((item) => item.id !== target.id));
    try {
      await deleteSession(target.id);
      setDeleteConfirmId(null);
      setOpenMenuId(null);
      if (location.state && (location.state as { resumeSessionId?: string }).resumeSessionId === target.id) {
        navigate(`/projects/${project.id}`, {
          replace: true,
          preventScrollReset: true,
          state: { projectSnapshot: { ...projectSnapshot, sessions: previous.filter((item) => item.id !== target.id) } },
        });
        onNewConversation?.();
      }
    } catch (error) {
      setSessions(previous);
      setSessionError(error instanceof Error ? error.message : "删除会话失败");
    } finally {
      setPendingSessionId(null);
    }
  };

  const confirmDeleteBrainstorm = async (target: ProjectBrainstormBrief) => {
    const previous = brainstorms;
    setPendingBrainstormId(target.id);
    setBrainstormError("");
    setBrainstorms((items) => items.filter((item) => item.id !== target.id));
    try {
      await deleteBrainstormSession(target.id);
      setDeleteBrainstormConfirmId(null);
      setOpenBrainstormMenuId(null);
      if (location.search.includes(`brainstormId=${encodeURIComponent(target.id)}`)) {
        navigate(`/projects/${project.id}?page=brainstorm`, {
          replace: true,
          preventScrollReset: true,
          state: { projectSnapshot: { ...projectSnapshot, brainstorm_sessions: previous.filter((item) => item.id !== target.id) } },
        });
        onNewBrainstorm?.();
      }
    } catch (error) {
      setBrainstorms(previous);
      setBrainstormError(error instanceof Error ? error.message : "删除风暴记录失败");
    } finally {
      setPendingBrainstormId(null);
    }
  };

  const handleLogout = () => {
    if (!token) {
      onRequireProject?.();
      return;
    }
    logout();
    navigate("/login");
  };

  const createProjectFromPicker = async () => {
    const name = projectPickerNewName.trim();
    if (!name) return;
    setProjectPickerCreating(true);
    setProjectPickerError("");
    try {
      const created = await createProject(name);
      setProjectPickerNewName("");
      setProjectPickerOpen(false);
      navigate(`/projects/${created.id}`, { preventScrollReset: true });
    } catch (error) {
      setProjectPickerError(error instanceof Error ? error.message : "创建项目失败");
    } finally {
      setProjectPickerCreating(false);
    }
  };

  const beginRenameProjectFromPicker = (target: ProjectSummary) => {
    setProjectPickerMenuId(null);
    setProjectPickerDeleteConfirmId(null);
    setProjectPickerRenameId(target.id);
    setProjectPickerRenameValue(target.name);
  };

  const renameProjectFromPicker = async (target: ProjectSummary) => {
    const name = projectPickerRenameValue.trim();
    if (!name) return;
    setProjectPickerBusyId(target.id);
    setProjectPickerError("");
    try {
      const updated = await patchProject(target.id, { name });
      setProjectPickerItems((items) => items.map((item) => item.id === target.id ? { ...item, ...updated } : item));
      setProjectPickerRenameId(null);
      setProjectPickerRenameValue("");
      window.dispatchEvent(new CustomEvent("ruice:project-updated", { detail: updated }));
    } catch (error) {
      setProjectPickerError(error instanceof Error ? error.message : "重命名项目失败");
    } finally {
      setProjectPickerBusyId(null);
    }
  };

  const archiveProjectFromPicker = async (target: ProjectSummary) => {
    setProjectPickerBusyId(target.id);
    setProjectPickerError("");
    try {
      const updated = await patchProject(target.id, { status: "archived" });
      setProjectPickerItems((items) => items.map((item) => item.id === target.id ? { ...item, ...updated } : item));
      setProjectPickerMenuId(null);
      window.dispatchEvent(new CustomEvent("ruice:project-updated", { detail: updated }));
      if (target.id === project.id) {
        setProjectPickerOpen(false);
        navigate("/", { replace: true });
      }
    } catch (error) {
      setProjectPickerError(error instanceof Error ? error.message : "归档项目失败");
    } finally {
      setProjectPickerBusyId(null);
    }
  };

  const restoreProjectFromPicker = async (target: ProjectSummary) => {
    setProjectPickerBusyId(target.id);
    setProjectPickerError("");
    try {
      const updated = await patchProject(target.id, { status: "active" });
      setProjectPickerItems((items) => items.map((item) => item.id === target.id ? { ...item, ...updated } : item));
      setProjectPickerArchived(false);
      setProjectPickerMenuId(null);
      window.dispatchEvent(new CustomEvent("ruice:project-updated", { detail: updated }));
    } catch (error) {
      setProjectPickerError(error instanceof Error ? error.message : "恢复项目失败");
    } finally {
      setProjectPickerBusyId(null);
    }
  };

  const deleteProjectFromPicker = async (target: ProjectSummary) => {
    setProjectPickerBusyId(target.id);
    setProjectPickerError("");
    try {
      await patchProject(target.id, { status: "deleted" });
      setProjectPickerItems((items) => items.filter((item) => item.id !== target.id));
      setProjectPickerMenuId(null);
      setProjectPickerDeleteConfirmId(null);
      if (target.id === project.id) {
        setProjectPickerOpen(false);
        navigate("/", { replace: true });
      }
    } catch (error) {
      setProjectPickerError(error instanceof Error ? error.message : "删除项目失败");
    } finally {
      setProjectPickerBusyId(null);
    }
  };

  const sortedProjectPickerItems = useMemo(() => [...projectPickerItems].sort((a, b) => {
    const delta = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (delta !== 0) return delta;
    return a.name.localeCompare(b.name, "zh-CN");
  }), [projectPickerItems]);
  const activeProjectPickerItems = sortedProjectPickerItems.filter((item) => item.status !== "archived" && item.status !== "deleted");
  const archivedProjectPickerItems = sortedProjectPickerItems.filter((item) => item.status === "archived");
  const visibleProjectPickerItems = projectPickerArchived ? archivedProjectPickerItems : activeProjectPickerItems;
  const accountName = currentUser?.email?.split("@")[0]?.trim() || "构造视界";
  const accountMeta = currentUser?.email || "项目账号";

  const conversationHistoryList = visibleSessions.length === 0 ? (
    <p className="project-workspace-history__empty">真实开始对话后，记录会沉淀在这里。</p>
  ) : (
    <div className="project-workspace-history__list">
      {visibleSessions.map((session) => (
        <div
          key={session.id}
          className={session.is_pinned ? "project-workspace-history__row is-pinned" : "project-workspace-history__row"}
        >
          <button
            type="button"
            className="project-workspace-history__item"
            onClick={() => resumeSession(session.id)}
          >
            <span className="project-workspace-history__titleline">
              <strong>{sessionTitle(session.title)}</strong>
              {session.is_pinned && <em>置顶</em>}
            </span>
            <span>{formatDate(session.updated_at)} · {sessionStatusLabel(session.status)}</span>
          </button>
          <button
            type="button"
            className="project-workspace-history__more"
            aria-label={`管理对话：${sessionTitle(session.title)}`}
            aria-expanded={openMenuId === session.id}
            onClick={() => toggleSessionMenu(session.id)}
          >
            ···
          </button>

          {openMenuId === session.id && (
            <div className="project-workspace-history__menu" role="menu">
              {renameSessionId === session.id ? (
                <form className="project-workspace-history__rename" onSubmit={submitRenameSession}>
                  <label htmlFor={`rename-session-${session.id}`}>重命名对话</label>
                  <input
                    id={`rename-session-${session.id}`}
                    value={renameValue}
                    autoFocus
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenameSessionId(null);
                    }}
                  />
                  <div>
                    <button type="button" onClick={() => setRenameSessionId(null)}>
                      取消
                    </button>
                    <button type="submit" disabled={pendingSessionId === session.id || !renameValue.trim()}>
                      保存
                    </button>
                  </div>
                </form>
              ) : deleteConfirmId === session.id ? (
                <div className="project-workspace-history__confirm">
                  <strong>删除这条对话？</strong>
                  <p>删除后会从本项目侧栏隐藏，关联诊断和文件不会被删除。</p>
                  <div>
                    <button type="button" onClick={() => setDeleteConfirmId(null)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={pendingSessionId === session.id}
                      onClick={() => confirmDeleteSession(session)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pendingSessionId === session.id}
                    onClick={() => togglePinSession(session)}
                  >
                    {session.is_pinned ? "取消置顶" : "置顶对话"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => beginRenameSession(session)}>
                    重命名
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => setDeleteConfirmId(session.id)}
                  >
                    删除
                  </button>
                </>
              )}
              {sessionError && openMenuId === session.id && (
                <p className="project-workspace-history__error">{sessionError}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const brainstormHistoryList = visibleBrainstorms.length === 0 ? (
    <p className="project-workspace-history__empty">开始一次头脑风暴后，记录会保存在这里。</p>
  ) : (
    <div className="project-workspace-history__list">
      {visibleBrainstorms.map((record) => (
        <div
          key={record.id}
          className={record.is_pinned ? "project-workspace-history__row is-pinned" : "project-workspace-history__row"}
        >
          <button
            type="button"
            className="project-workspace-history__item"
            onClick={() => resumeBrainstorm(record.id)}
          >
            <span className="project-workspace-history__titleline">
              <strong>{sessionTitle(record.title)}</strong>
              {record.is_pinned && <em>置顶</em>}
            </span>
            <span>{formatDate(record.updated_at)} · 头脑风暴</span>
          </button>
          <button
            type="button"
            className="project-workspace-history__more"
            aria-label={`管理风暴：${sessionTitle(record.title)}`}
            aria-expanded={openBrainstormMenuId === record.id}
            onClick={() => toggleBrainstormMenu(record.id)}
          >
            ···
          </button>

          {openBrainstormMenuId === record.id && (
            <div className="project-workspace-history__menu" role="menu">
              {renameBrainstormId === record.id ? (
                <form className="project-workspace-history__rename" onSubmit={submitRenameBrainstorm}>
                  <label htmlFor={`rename-brainstorm-${record.id}`}>重命名风暴</label>
                  <input
                    id={`rename-brainstorm-${record.id}`}
                    value={renameValue}
                    autoFocus
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenameBrainstormId(null);
                    }}
                  />
                  <div>
                    <button type="button" onClick={() => setRenameBrainstormId(null)}>
                      取消
                    </button>
                    <button type="submit" disabled={pendingBrainstormId === record.id || !renameValue.trim()}>
                      保存
                    </button>
                  </div>
                </form>
              ) : deleteBrainstormConfirmId === record.id ? (
                <div className="project-workspace-history__confirm">
                  <strong>删除这条风暴记录？</strong>
                  <p>删除后会从本项目侧栏隐藏，不影响正式诊断。</p>
                  <div>
                    <button type="button" onClick={() => setDeleteBrainstormConfirmId(null)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={pendingBrainstormId === record.id}
                      onClick={() => confirmDeleteBrainstorm(record)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pendingBrainstormId === record.id}
                    onClick={() => togglePinBrainstorm(record)}
                  >
                    {record.is_pinned ? "取消置顶" : "置顶风暴"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => beginRenameBrainstorm(record)}>
                    重命名
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => setDeleteBrainstormConfirmId(record.id)}
                  >
                    删除
                  </button>
                </>
              )}
              {brainstormError && openBrainstormMenuId === record.id && (
                <p className="project-workspace-history__error">{brainstormError}</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className={sidebarCollapsed ? "project-workspace-shell is-sidebar-collapsed" : "project-workspace-shell"}>
      <aside className={sidebarCollapsed ? "project-workspace-sidebar is-collapsed" : "project-workspace-sidebar"} aria-label={`${project.name} 项目导航`}>
        <div className="project-workspace-brand">
          <div className="project-workspace-project-card">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="project-workspace-logo-input"
              onChange={changeProjectLogo}
            />
            <button
              type="button"
              className="project-workspace-logo has-image"
              onClick={openProjectLogoPicker}
              title="点击更换项目 Logo 图片"
              aria-label="更换项目 Logo"
            >
              <img src={projectLogo || "/brand-logo.png"} alt="" />
            </button>
            <div className="project-workspace-project-copy">
              <span>构造视界项目</span>
              <strong>{project.name}</strong>
            </div>
            <button
              type="button"
              className="project-workspace-sidebar__toggle"
              onClick={toggleSidebarCollapsed}
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
            >
              <span className="project-workspace-sidebar__toggle-icon" aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
            </button>
          </div>
          {project.status === "archived" && (
            <div className="project-workspace-brand__meta">
              <em>已归档</em>
            </div>
          )}
        </div>

        <nav className="project-workspace-menu" aria-label="项目功能">
          <div className="project-workspace-menu__group">
            <button
              type="button"
              className={activeSection === "new" ? "project-workspace-menu__item is-active" : "project-workspace-menu__item"}
              onClick={openNewConversation}
              aria-label="新对话"
              title="新对话"
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">+</span>
              {!sidebarCollapsed ? <span>新对话</span> : null}
            </button>
            <button
              type="button"
              className={activeSection === "archive" ? "project-workspace-menu__item is-active" : "project-workspace-menu__item"}
              onClick={openArchive}
              aria-label="项目档案"
              title="项目档案"
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">□</span>
              {!sidebarCollapsed ? <span>项目档案</span> : null}
            </button>
            <button
              type="button"
              className={activeSection === "warroom" ? "project-workspace-menu__item is-active" : "project-workspace-menu__item"}
              onClick={openWarRoom}
              aria-label="作战室"
              title="作战室"
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">⚑</span>
              {!sidebarCollapsed ? <span>作战室</span> : null}
            </button>
          </div>

          {isAdmin && (
            <div className="project-workspace-menu__group project-workspace-menu__group--separated">
              <button
                type="button"
                className="project-workspace-menu__item"
                onClick={() => navigate("/admin")}
                aria-label="后台管理"
                title="后台管理"
              >
                <span className="project-workspace-menu__icon" aria-hidden="true">◇</span>
                {!sidebarCollapsed ? <span>后台管理</span> : null}
              </button>
            </div>
          )}

          <div className="project-workspace-menu__group project-workspace-menu__group--separated">
            <a
              className="project-workspace-menu__promo"
              href="https://ggoo.ai"
              target="_blank"
              rel="noreferrer"
              aria-label="打开 GGOO 官网"
              title="打开 GGOO 官网"
            >
              <div className="project-workspace-menu__promo-head">
                <span className="project-workspace-menu__icon" aria-hidden="true">G</span>
                {!sidebarCollapsed ? (
                  <div className="project-workspace-menu__promo-copy">
                    <strong>GGOO</strong>
                    <small>限时3倍积分，畅用海外模型</small>
                  </div>
                ) : null}
              </div>
            </a>
          </div>
        </nav>

        {!sidebarCollapsed && (
          <section className="project-workspace-history" aria-label="项目记录">
            <div className="project-workspace-history-tabs" role="tablist" aria-label="项目记录类型">
              <button
                type="button"
                role="tab"
                aria-selected={historyMode === "conversation"}
                className={historyMode === "conversation" ? "project-workspace-history-tabs__item is-active" : "project-workspace-history-tabs__item"}
                onClick={() => switchHistoryMode("conversation")}
              >
                <span>对话记录</span>
                <strong>{visibleSessions.length}</strong>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={historyMode === "brainstorm"}
                className={historyMode === "brainstorm" ? "project-workspace-history-tabs__item is-active" : "project-workspace-history-tabs__item"}
                onClick={() => switchHistoryMode("brainstorm")}
              >
                <span>风暴记录</span>
                <strong>{visibleBrainstorms.length}</strong>
              </button>
            </div>
            {historyMode === "conversation" ? conversationHistoryList : brainstormHistoryList}
          </section>
        )}

        <div className="project-workspace-footer">
          <button type="button" className="project-workspace-project-list-btn" onClick={openProjectPicker} aria-label="项目列表" title="项目列表">
            <span className="project-workspace-project-list-btn__icon" aria-hidden="true">▦</span>
            {!sidebarCollapsed ? (
              <span className="project-workspace-project-list-btn__copy">
                <strong>项目列表</strong>
                <small>新建 / 切换项目</small>
              </span>
            ) : null}
          </button>
          {!sidebarCollapsed ? (
            <div className="project-workspace-account-card">
              <span className="project-workspace-account-card__avatar" aria-hidden="true">
                {accountName.slice(0, 1).toUpperCase()}
              </span>
              <span className="project-workspace-account-card__copy">
                <strong>{accountName}</strong>
                <small>{accountMeta}</small>
              </span>
              <button type="button" onClick={handleLogout} aria-label="退出登录" title="退出登录">
                ⎋
              </button>
            </div>
          ) : (
            <button type="button" className="project-workspace-account-icon-btn" onClick={handleLogout} aria-label="退出" title="退出">
              <span className="project-workspace-footer__icon" aria-hidden="true">⎋</span>
            </button>
          )}
        </div>
      </aside>

      <main
        className={
          activeSection === "new"
            ? `project-workspace-main project-workspace-main--conversation project-workspace-main--conversation-${conversationLayout}`
            : "project-workspace-main"
        }
      >
        {children}
      </main>

      {projectPickerOpen && (
        <div className="project-picker-overlay" role="presentation" onMouseDown={() => setProjectPickerOpen(false)}>
          <section
            className="project-picker-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-picker-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="project-picker-panel__head">
              <div>
                <span>项目工作台</span>
                <h2 id="project-picker-title">项目列表</h2>
              </div>
              <button type="button" onClick={() => setProjectPickerOpen(false)} aria-label="关闭项目列表">
                ×
              </button>
            </header>

            <div className="project-picker-create">
              <input
                value={projectPickerNewName}
                placeholder="新建项目名称"
                onChange={(event) => setProjectPickerNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createProjectFromPicker();
                }}
              />
              <button
                type="button"
                onClick={() => void createProjectFromPicker()}
                disabled={projectPickerCreating || !projectPickerNewName.trim()}
              >
                {projectPickerCreating ? "创建中" : "新建项目"}
              </button>
            </div>

            <div className="project-picker-tabs" role="tablist" aria-label="项目状态">
              <button
                type="button"
                role="tab"
                aria-selected={!projectPickerArchived}
                className={!projectPickerArchived ? "is-active" : ""}
                onClick={() => setProjectPickerArchived(false)}
              >
                进行中 <strong>{activeProjectPickerItems.length}</strong>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={projectPickerArchived}
                className={projectPickerArchived ? "is-active" : ""}
                onClick={() => setProjectPickerArchived(true)}
              >
                归档箱 <strong>{archivedProjectPickerItems.length}</strong>
              </button>
            </div>

            {projectPickerError && <p className="project-picker-panel__error">{projectPickerError}</p>}

            <div className="project-picker-list">
              {projectPickerLoading && <p className="project-picker-empty">正在加载项目…</p>}
              {!projectPickerLoading && visibleProjectPickerItems.length === 0 && (
                <p className="project-picker-empty">
                  {projectPickerArchived ? "暂无归档项目。" : "暂无进行中的项目，可以先新建一个。"}
                </p>
              )}
              {!projectPickerLoading && visibleProjectPickerItems.map((item) => (
                <article key={item.id} className={item.id === project.id ? "project-picker-card is-current" : "project-picker-card"}>
                  {projectPickerRenameId === item.id ? (
                    <form
                      className="project-picker-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameProjectFromPicker(item);
                      }}
                    >
                      <input
                        value={projectPickerRenameValue}
                        autoFocus
                        onChange={(event) => setProjectPickerRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setProjectPickerRenameId(null);
                            setProjectPickerRenameValue("");
                          }
                        }}
                      />
                      <button type="button" onClick={() => setProjectPickerRenameId(null)}>
                        取消
                      </button>
                      <button type="submit" disabled={projectPickerBusyId === item.id || !projectPickerRenameValue.trim()}>
                        保存
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="project-picker-card__main"
                        onClick={() => {
                          setProjectPickerOpen(false);
                          if (item.id !== project.id) navigate(`/projects/${item.id}`, { preventScrollReset: true });
                        }}
                      >
                        <span>{item.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.id === project.id ? "当前项目" : item.status === "archived" ? `已归档 · ${formatDate(item.updated_at)}` : `更新于 ${formatDate(item.updated_at)}`}</small>
                        </div>
                      </button>
                      <div className="project-picker-card__actions">
                        <button
                          type="button"
                          className="project-picker-card__more"
                          aria-label={`管理项目：${item.name}`}
                          aria-expanded={projectPickerMenuId === item.id}
                          onClick={() => {
                            setProjectPickerRenameId(null);
                            setProjectPickerDeleteConfirmId(null);
                            setProjectPickerMenuId((current) => current === item.id ? null : item.id);
                          }}
                        >
                          ···
                        </button>
                      </div>
                      {projectPickerMenuId === item.id && (
                        <div className="project-picker-card__menu" role="menu">
                          {projectPickerDeleteConfirmId === item.id ? (
                            <div className="project-picker-card__confirm">
                              <strong>删除这个项目？</strong>
                              <p>只从当前账号列表隐藏，数据库资料仍保留。</p>
                              <div>
                                <button type="button" onClick={() => setProjectPickerDeleteConfirmId(null)}>
                                  取消
                                </button>
                                <button
                                  type="button"
                                  className="is-danger"
                                  disabled={projectPickerBusyId === item.id}
                                  onClick={() => void deleteProjectFromPicker(item)}
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button type="button" role="menuitem" onClick={() => beginRenameProjectFromPicker(item)}>
                                重命名
                              </button>
                              {item.status === "archived" ? (
                                <>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={projectPickerBusyId === item.id}
                                    onClick={() => void restoreProjectFromPicker(item)}
                                  >
                                    恢复项目
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="is-danger"
                                    onClick={() => setProjectPickerDeleteConfirmId(item.id)}
                                  >
                                    删除
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={projectPickerBusyId === item.id}
                                  onClick={() => void archiveProjectFromPicker(item)}
                                >
                                  归档
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
