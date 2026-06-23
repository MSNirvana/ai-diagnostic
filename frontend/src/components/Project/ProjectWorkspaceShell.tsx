import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deleteBrainstormSession, deleteSession, updateBrainstormSession, updateSession } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import type { ProjectBrainstormBrief, ProjectDetail, ProjectSessionBrief } from "../../types";
import "./ProjectWorkspaceShell.css";

type ProjectWorkspaceSection = "new" | "archive" | "warroom";

interface ProjectWorkspaceShellProps {
  project: Pick<ProjectDetail, "id" | "name" | "status"> & { sessions?: ProjectSessionBrief[]; brainstorm_sessions?: ProjectBrainstormBrief[] };
  activeSection: ProjectWorkspaceSection;
  children: ReactNode;
  onNewConversation?: () => void;
  onResumeSession?: (sessionId: string) => void;
  onResumeBrainstorm?: (brainstormId: string) => void;
  onNewBrainstorm?: () => void;
  onOpenArchive?: () => void;
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

function defaultProjectLogo(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "睿";
  const latin = trimmed.match(/[A-Za-z]/);
  if (latin) return latin[0].toUpperCase();
  return Array.from(trimmed)[0] ?? "睿";
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

export function ProjectWorkspaceShell({
  project,
  activeSection,
  children,
  onNewConversation,
  onResumeSession,
  onResumeBrainstorm,
  onNewBrainstorm,
  onOpenArchive,
}: ProjectWorkspaceShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
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
  const defaultLogo = defaultProjectLogo(project.name);
  const [projectLogo, setProjectLogo] = useState(() => readProjectLogo(project.id));
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
    setProjectLogo(readProjectLogo(project.id));
  }, [project.id, project.name]);

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

  const clearProjectLogo = () => {
    setProjectLogo("");
    try {
      if (typeof window.localStorage?.removeItem === "function") {
        window.localStorage.removeItem(projectLogoStorageKey(project.id));
      }
    } catch {
      // Local custom logo is optional; ignore storage failures.
    }
  };

  const openNewConversation = () => {
    navigateStable(`/projects/${project.id}`);
    onNewConversation?.();
  };

  const openArchive = () => {
    if (navigateStable(`/projects/${project.id}?page=archive`)) {
      onOpenArchive?.();
    }
  };

  const openWarRoom = () => {
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
    logout();
    navigate("/login");
  };

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
    <div className="project-workspace-shell">
      <aside className="project-workspace-sidebar" aria-label={`${project.name} 项目导航`}>
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
              className={projectLogo ? "project-workspace-logo has-image" : "project-workspace-logo"}
              onClick={openProjectLogoPicker}
              title="点击更换项目 Logo 图片"
              aria-label="更换项目 Logo"
            >
              {projectLogo ? <img src={projectLogo} alt="" /> : defaultLogo}
            </button>
            <div className="project-workspace-project-copy">
              <span>AI咨询项目</span>
              <strong>{project.name}</strong>
            </div>
          </div>
          <div className="project-workspace-brand__meta">
            {projectLogo && (
              <button type="button" onClick={clearProjectLogo}>
                恢复默认 Logo
              </button>
            )}
            {project.status === "archived" && <em>已归档</em>}
          </div>
        </div>

        <nav className="project-workspace-menu" aria-label="项目功能">
          <div className="project-workspace-menu__group">
            <button
              type="button"
              className={activeSection === "new" ? "project-workspace-menu__item is-active" : "project-workspace-menu__item"}
              onClick={openNewConversation}
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">+</span>
              <span>新对话</span>
            </button>
            <button
              type="button"
              className={activeSection === "archive" ? "project-workspace-menu__item is-active" : "project-workspace-menu__item"}
              onClick={openArchive}
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">□</span>
              <span>企业档案</span>
            </button>
            <button
              type="button"
              className={activeSection === "warroom" ? "project-workspace-menu__item is-active" : "project-workspace-menu__item"}
              onClick={openWarRoom}
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">⚑</span>
              <span>作战室</span>
            </button>
          </div>

          <div className="project-workspace-menu__group project-workspace-menu__group--separated">
            <button
              type="button"
              className="project-workspace-menu__item"
              onClick={() => navigate("/admin")}
            >
              <span className="project-workspace-menu__icon" aria-hidden="true">◇</span>
              <span>后台管理</span>
            </button>
          </div>
        </nav>

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

        <div className="project-workspace-footer">
          <button type="button" onClick={() => navigate("/projects")}>
            返回项目列表
          </button>
          <button type="button" onClick={handleLogout}>
            退出
          </button>
        </div>
      </aside>

      <main className={activeSection === "new" ? "project-workspace-main project-workspace-main--conversation" : "project-workspace-main"}>
        {children}
      </main>
    </div>
  );
}
