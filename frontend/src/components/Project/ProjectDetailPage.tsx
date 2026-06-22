import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { confirmArchiveFileExtraction, createDiagnosisJob, deleteSessionFile, extractArchiveFile, getBrainstormSession, getProject, getProjectEvidence, patchProject, sendBrainstormMessage, startSession, uploadSessionFile } from "../../api/client";
import { EvidencePackPanel } from "../Evidence/EvidencePackPanel";
import { Questionnaire } from "../Questionnaire/Questionnaire";
import type { ProjectChatMode, UploadedChatFile } from "../Questionnaire/ChatStep";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import type { ArchiveExtractionPreview, ChatMessage, ModuleAnswer, ProblemMap, ProjectArchive, ProjectDetail, ResearchEvidenceOut } from "../../types";
import "./ProjectDetailPage.css";

type ProjectPageKey = "start" | "archive" | "brainstorm";
type ArchiveSectionKey = "modules" | "assets" | "iterations";
type ChatAttachment = { id: string; name: string };

function InfoTip({ content }: { content: string }) {
  return (
    <span className="pd-info-tip" tabIndex={0} aria-label={content}>
      <span className="pd-info-tip__trigger" aria-hidden="true">?</span>
      <span className="pd-info-tip__bubble" role="tooltip">{content}</span>
    </span>
  );
}

const MODULE_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "销售与增长",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
};

const ARCHIVE_PROFILE_SEQUENCE = [
  "公司名称",
  "所属行业",
  "主营业务",
  "商业模式",
  "规模",
  "发展阶段",
] as const;

const REQUIRED_ARCHIVE_MODULES = 4;
const REQUIRED_ARCHIVE_EVIDENCE = 6;
const REQUIRED_ARCHIVE_ITERATIONS = 3;

const EMPTY_ARCHIVE: ProjectArchive = {
  profile: [],
  modules: [
    { module: "market", label: "市场与客户", facts: [], has_data: false },
    { module: "product", label: "产品与服务", facts: [], has_data: false },
    { module: "sales", label: "销售与增长", facts: [], has_data: false },
    { module: "ops", label: "运营与供应链", facts: [], has_data: false },
    { module: "org", label: "组织与人才", facts: [], has_data: false },
    { module: "finance", label: "财务与资本", facts: [], has_data: false },
  ],
  files: [],
  last_updated: null,
};

const VALID_PAGES: ProjectPageKey[] = ["start", "archive", "brainstorm"];
const VALID_ARCHIVE_SECTIONS: ArchiveSectionKey[] = ["modules", "assets", "iterations"];

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const pageFromQuery = query.get("page");
  const archiveSectionFromQuery = query.get("section");
  const brainstormIdFromQuery = query.get("brainstormId");
  const navState = (location.state as { resumeSessionId?: string } | null) ?? {};
  const activePage = VALID_PAGES.includes(pageFromQuery as ProjectPageKey)
    ? (pageFromQuery as ProjectPageKey)
    : "start";
  const activeArchiveSection = VALID_ARCHIVE_SECTIONS.includes(archiveSectionFromQuery as ArchiveSectionKey)
    ? (archiveSectionFromQuery as ArchiveSectionKey)
    : "modules";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [evidencePack, setEvidencePack] = useState<ResearchEvidenceOut[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeArchiveDomain, setActiveArchiveDomain] = useState<string>("market");
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [activeInlineSessionId, setActiveInlineSessionId] = useState<string | undefined>();
  const [inlineInitialPrompt, setInlineInitialPrompt] = useState<string | undefined>();
  const [inlineResetKey, setInlineResetKey] = useState(0);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineLoading, setInlineLoading] = useState(false);
  const [projectChatMode, setProjectChatMode] = useState<ProjectChatMode>(
    pageFromQuery === "brainstorm" ? "brainstorm" : "consulting"
  );
  const [brainstormMessages, setBrainstormMessages] = useState<ChatMessage[]>([]);
  const [brainstormDraft, setBrainstormDraft] = useState("");
  const [brainstormLoading, setBrainstormLoading] = useState(false);
  const [brainstormError, setBrainstormError] = useState<string | null>(null);
  const [brainstormUseProjectContext, setBrainstormUseProjectContext] = useState(true);
  const [archiveUploadSessionId, setArchiveUploadSessionId] = useState<string | null>(null);
  const [archiveUploadTarget, setArchiveUploadTarget] = useState<{ moduleKey: string; fieldKey: string }>({
    moduleKey: "misc",
    fieldKey: "archive_upload",
  });
  const [archiveUploading, setArchiveUploading] = useState(false);
  const [archiveUploadError, setArchiveUploadError] = useState<string | null>(null);
  const [archiveExtractingFileId, setArchiveExtractingFileId] = useState<string | null>(null);
  const [archiveDeletingFileId, setArchiveDeletingFileId] = useState<string | null>(null);
  const [archiveExtractionDraft, setArchiveExtractionDraft] = useState<ArchiveExtractionPreview | null>(null);
  const [archiveExtractionSummary, setArchiveExtractionSummary] = useState("");
  const [archiveConfirming, setArchiveConfirming] = useState(false);
  const archiveFileInputRef = useRef<HTMLInputElement | null>(null);
  const justSavedBrainstormIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
    getProjectEvidence(id)
      .then(setEvidencePack)
      .catch((e) => setEvidenceError(e instanceof Error ? e.message : "证据加载失败"));
  }, [id]);

  useEffect(() => {
    setProjectChatMode(pageFromQuery === "brainstorm" ? "brainstorm" : "consulting");
  }, [pageFromQuery]);

  useEffect(() => {
    const handleProjectUpdated = (event: Event) => {
      const updated = (event as CustomEvent<{ id?: string; name?: string; status?: string; updated_at?: string }>).detail;
      if (!updated?.id || updated.id !== id) return;
      setProject((current) => current ? {
        ...current,
        ...(updated.name ? { name: updated.name } : {}),
        ...(updated.status ? { status: updated.status } : {}),
        ...(updated.updated_at ? { updated_at: updated.updated_at } : {}),
      } : current);
    };
    window.addEventListener("ruice:project-updated", handleProjectUpdated);
    return () => window.removeEventListener("ruice:project-updated", handleProjectUpdated);
  }, [id]);

  useEffect(() => {
    if (!navState.resumeSessionId) return;
    setInlineInitialPrompt(undefined);
    setActiveInlineSessionId(navState.resumeSessionId);
    setInlineError(null);
  }, [navState.resumeSessionId]);

  useEffect(() => {
    if (activePage !== "brainstorm" || !brainstormIdFromQuery) return;
    if (justSavedBrainstormIdRef.current === brainstormIdFromQuery) {
      justSavedBrainstormIdRef.current = null;
      return;
    }
    let cancelled = false;
    getBrainstormSession(brainstormIdFromQuery)
      .then((record) => {
        if (cancelled) return;
        setBrainstormMessages(record.messages.length ? record.messages : []);
        setBrainstormUseProjectContext(record.use_project_context ?? true);
        setBrainstormError(null);
      })
      .catch((e) => {
        if (!cancelled) setBrainstormError(e instanceof Error ? e.message : "风暴记录加载失败");
      });
    return () => { cancelled = true; };
  }, [activePage, brainstormIdFromQuery]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("zh-CN");
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  if (error) {
    return <div style={{ padding: 40 }}><p style={{ color: "var(--signal-red)" }}>{error}</p></div>;
  }
  if (!project) {
    return <div style={{ padding: 40, color: "var(--ink-soft)" }}>加载中…</div>;
  }

  const archive = project.archive ?? EMPTY_ARCHIVE;
  const hasWarRoom = Boolean(project.war_room_plan);
  const latestRejectedRecord = project.records.find((r) => r.review_status === "rejected");
  const needsSupplement = Boolean(latestRejectedRecord && !hasWarRoom);
  const filledModules = archive.modules.filter((m) => m.has_data).length;
  const moduleTotal = archive.modules.length || 6;
  const resumeInlineSession = (sessionId: string) => {
    setInlineInitialPrompt(undefined);
    setActiveInlineSessionId(sessionId);
    setInlineError(null);
  };
  const submitInlineDiagnosis = async (
    answers: ModuleAnswer[],
    _files: { moduleKey: string; fieldKey: string; file: File }[],
    sessionId?: string,
    pid?: string,
    problemMap?: ProblemMap
  ) => {
    setInlineLoading(true);
    setInlineError(null);
    try {
      const targetProjectId = pid ?? project.id;
      const job = await createDiagnosisJob(answers, sessionId, targetProjectId, problemMap);
      navigate(`/projects/${targetProjectId}`, {
        replace: true,
        state: { deliveryStatus: "researching", jobId: job.job_id },
      });
      getProject(targetProjectId).then(setProject).catch(() => {});
    } catch (e) {
      setInlineError(e instanceof Error ? e.message : "创建诊断任务失败");
    } finally {
      setInlineLoading(false);
    }
  };
  const isArchived = project.status === "archived";
  const handleArchiveToggle = async () => {
    if (!project) return;
    const nextStatus = isArchived ? "active" : "archived";
    setArchiving(true);
    setError(null);
    try {
      const updated = await patchProject(project.id, { status: nextStatus });
      setProject((current) => current ? { ...current, status: updated.status, updated_at: updated.updated_at } : current);
      if (nextStatus === "archived") {
        navigate("/projects");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新项目状态失败");
    } finally {
      setArchiving(false);
    }
  };
  const resetInlineConversation = () => {
    setActiveInlineSessionId(undefined);
    setInlineInitialPrompt(undefined);
    setInlineError(null);
    setInlineResetKey((key) => key + 1);
  };
  const openArchiveFilePicker = (target?: { moduleKey?: string; fieldKey?: string }) => {
    if (isArchived || archiveUploading) return;
    setArchiveUploadTarget({
      moduleKey: target?.moduleKey ?? "misc",
      fieldKey: target?.fieldKey ?? "archive_upload",
    });
    archiveFileInputRef.current?.click();
  };
  const handleArchiveFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selected.length === 0) return;
    setArchiveUploading(true);
    setArchiveUploadError(null);
    try {
      const sessionId = archiveUploadSessionId ?? await startSession(project.id, true);
      if (!archiveUploadSessionId) setArchiveUploadSessionId(sessionId);
      for (const file of selected) {
        await uploadSessionFile(sessionId, archiveUploadTarget.moduleKey, archiveUploadTarget.fieldKey, file);
      }
      const updated = await getProject(project.id);
      setProject(updated);
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "上传资料失败");
    } finally {
      setArchiveUploading(false);
    }
  };
  const beginArchiveExtraction = async (fileId: string) => {
    setArchiveUploadError(null);
    setArchiveExtractingFileId(fileId);
    try {
      const draft = await extractArchiveFile(project.id, fileId);
      setArchiveExtractionDraft(draft);
      setArchiveExtractionSummary(draft.summary ?? "");
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "生成沉淀草稿失败");
    } finally {
      setArchiveExtractingFileId(null);
    }
  };
  const deleteArchiveFile = async (fileId: string) => {
    if (isArchived || archiveDeletingFileId) return;
    setArchiveUploadError(null);
    setArchiveDeletingFileId(fileId);
    try {
      await deleteSessionFile(fileId);
      if (archiveExtractionDraft?.file_id === fileId) {
        setArchiveExtractionDraft(null);
        setArchiveExtractionSummary("");
      }
      const updated = await getProject(project.id);
      setProject(updated);
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "删除资料失败");
    } finally {
      setArchiveDeletingFileId(null);
    }
  };
  const updateExtractionHighlight = (index: number, key: "label" | "value", value: string) => {
    setArchiveExtractionDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        highlights: current.highlights.map((item, itemIndex) =>
          itemIndex === index ? { ...item, [key]: value } : item
        ),
      };
    });
  };
  const confirmArchiveExtraction = async () => {
    if (!archiveExtractionDraft) return;
    setArchiveConfirming(true);
    setArchiveUploadError(null);
    try {
      const nextArchive = await confirmArchiveFileExtraction(project.id, archiveExtractionDraft.file_id, {
        highlights: archiveExtractionDraft.highlights,
        summary: archiveExtractionSummary,
      });
      setProject((current) => current ? { ...current, archive: nextArchive } : current);
      setArchiveExtractionDraft(null);
      setArchiveExtractionSummary("");
      getProject(project.id).then(setProject).catch(() => {});
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "确认沉淀失败");
    } finally {
      setArchiveConfirming(false);
    }
  };
  const sendBrainstorm = async (attachments: ChatAttachment[] = [], textOverride?: string) => {
    const text = (textOverride ?? brainstormDraft).trim();
    if (!text || brainstormLoading) return;
    const nextMessages = [
      ...brainstormMessages,
      {
        role: "user",
        content: text,
        ...(attachments.length ? { attachments } : {}),
      } as ChatMessage,
    ];
    setBrainstormMessages(nextMessages);
    setBrainstormDraft("");
    setBrainstormError(null);
    setBrainstormLoading(true);
    try {
      const response = await sendBrainstormMessage(
        nextMessages,
        {
          projectId: project.id,
          useProjectContext: brainstormUseProjectContext,
          brainstormSessionId: brainstormIdFromQuery ?? undefined,
          attachmentFileIds: attachments.map((file) => file.id),
        }
      );
      setBrainstormMessages([...nextMessages, { role: "assistant", content: response.message }]);
      const savedBrainstormId = response.brainstorm_session_id;
      if (savedBrainstormId) {
        setProject((current) => {
          if (!current) return current;
          const exists = (current.brainstorm_sessions ?? []).some((item) => item.id === savedBrainstormId);
          const title = nextMessages.find((message) => message.role === "user")?.content.trim().slice(0, 28) || "风暴记录";
          const item = {
            id: savedBrainstormId,
            title,
            updated_at: new Date().toISOString(),
            is_pinned: false,
            use_project_context: brainstormUseProjectContext,
          };
          return {
            ...current,
            brainstorm_sessions: exists
              ? (current.brainstorm_sessions ?? []).map((row) => row.id === item.id ? { ...row, ...item } : row)
              : [item, ...(current.brainstorm_sessions ?? [])],
          };
        });
        if (!brainstormIdFromQuery) {
          justSavedBrainstormIdRef.current = savedBrainstormId;
          navigate(`/projects/${project.id}?page=brainstorm&brainstormId=${savedBrainstormId}`, {
            replace: true,
            preventScrollReset: true,
          });
        }
      }
    } catch (e) {
      setBrainstormError(e instanceof Error ? e.message : "头脑风暴失败");
      setBrainstormDraft(text);
      setBrainstormMessages(brainstormMessages);
    } finally {
      setBrainstormLoading(false);
    }
  };
  const openBrainstormRecord = (brainstormId: string) => {
    setProjectChatMode("brainstorm");
    navigate(`/projects/${project.id}?page=brainstorm&brainstormId=${brainstormId}`, { preventScrollReset: true });
  };
  const newBrainstormRecord = () => {
    setProjectChatMode("brainstorm");
    setBrainstormMessages([]);
    setBrainstormDraft("");
    setBrainstormError(null);
    navigate(`/projects/${project.id}?page=brainstorm`, { preventScrollReset: true });
  };
  const profileMap = Object.fromEntries(archive.profile.map((f) => [f.label, f.value]));
  const companyName = profileMap["公司名称"] || project.name;
  const archiveSummaryLine = [
    profileMap["所属行业"],
    profileMap["主营业务"],
    profileMap["商业模式"],
  ].filter(Boolean).join(" · ");
  const archiveProfileCards = ARCHIVE_PROFILE_SEQUENCE
    .map((label) => ({ label, value: profileMap[label] || "" }))
    .filter((item) => item.value);
  const archiveHeroProfile = archiveProfileCards.slice(0, 6);
  const profileCoverage = archiveProfileCards.length / ARCHIVE_PROFILE_SEQUENCE.length;
  const moduleCoverage = Math.min(filledModules, REQUIRED_ARCHIVE_MODULES) / REQUIRED_ARCHIVE_MODULES;
  const evidenceCoverage = Math.min(evidencePack.length, REQUIRED_ARCHIVE_EVIDENCE) / REQUIRED_ARCHIVE_EVIDENCE;
  const iterationCoverage = Math.min(project.records.length, REQUIRED_ARCHIVE_ITERATIONS) / REQUIRED_ARCHIVE_ITERATIONS;
  const rawArchiveCompleteness =
    profileCoverage * 0.28
    + moduleCoverage * 0.42
    + evidenceCoverage * 0.2
    + iterationCoverage * 0.1;
  const archiveCompleteness = Math.min(96, Math.round(rawArchiveCompleteness * 100));
  const archiveModuleSnapshots = archive.modules.map((module) => ({
    ...module,
    preview: module.facts.slice(0, 3),
    remainder: module.facts.slice(3),
  }));
  const archiveDomainCards = archiveModuleSnapshots.map((module) => {
    const moduleFiles = archive.files.filter((file) => file.module === module.module);
    return {
      ...module,
      files: moduleFiles,
      status: module.has_data || moduleFiles.length > 0 ? "已沉淀" : "待补充",
    };
  });
  const activeArchiveDomainCard = archiveDomainCards.find((module) => module.module === activeArchiveDomain) ?? archiveDomainCards[0];
  const archiveActiveModules = archiveModuleSnapshots.filter((module) => module.has_data).length;
  const archiveSectionCards = [
    {
      key: "modules" as const,
      label: "经营板块",
      value: `${archiveActiveModules}/${moduleTotal}`,
      detail: "已沉淀业务快照",
    },
    {
      key: "assets" as const,
      label: "关联数据",
      value: String(evidencePack.length),
      detail: "条来源可复核",
    },
    {
      key: "iterations" as const,
      label: "诊断迭代",
      value: String(project.records.length),
      detail: "次正式沉淀",
    },
  ];
  const changeArchiveSection = (section: ArchiveSectionKey) => {
    const params = new URLSearchParams(location.search);
    params.set("page", "archive");
    params.set("section", section);
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { preventScrollReset: true }
    );
  };
  const activeWorkspaceSection = activePage === "archive" ? "archive" : "new";
  const changeProjectChatMode = (mode: ProjectChatMode) => {
    setProjectChatMode(mode);
    navigate(
      mode === "brainstorm" ? `/projects/${project.id}?page=brainstorm` : `/projects/${project.id}`,
      { preventScrollReset: true }
    );
  };

  return (
    <ProjectWorkspaceShell
      project={project}
      activeSection={activeWorkspaceSection}
      onNewConversation={resetInlineConversation}
      onResumeSession={resumeInlineSession}
      onResumeBrainstorm={openBrainstormRecord}
      onNewBrainstorm={newBrainstormRecord}
    >
      {isArchived && (
        <section className="archive-banner">
          <div>
            <span>已归档</span>
            <h3>这个项目已从默认列表隐藏。</h3>
            <p>数据、诊断和作战室仍然保留。需要继续推进时，先恢复项目。</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => void handleArchiveToggle()} disabled={archiving}>
            {archiving ? "处理中" : "恢复项目"}
          </button>
        </section>
      )}

      {(activePage === "start" || activePage === "brainstorm") && (
        <div
          id="project-page-start"
          className="project-page-panel project-page-panel--chat-only"
          role="tabpanel"
          aria-label="新对话"
        >
          <section className="project-chat-console">
            {inlineLoading && <p className="project-inline-state">诊断任务创建中，正在进入深度尽调…</p>}
            {inlineError && <p className="project-inline-state project-inline-state--error">{inlineError}</p>}
            {needsSupplement && (
              <button
                type="button"
                className="project-supplement-link"
                onClick={() => navigate(`/projects/${project.id}/diagnose`, {
                  state: { projectId: project.id, rejectedRecordId: latestRejectedRecord?.id },
                })}
                disabled={isArchived}
              >
                顾问已打回，点击补充资料再诊断。
              </button>
            )}
            <Questionnaire
              key={activeInlineSessionId ?? inlineInitialPrompt ?? `project-inline-new-${inlineResetKey}`}
              onSubmit={submitInlineDiagnosis}
              projectId={project.id}
              resumeSessionId={activeInlineSessionId}
              initialPrompt={inlineInitialPrompt}
              variant="project-inline"
              projectMode={projectChatMode}
              onProjectModeChange={changeProjectChatMode}
              brainstormMessages={brainstormMessages}
              brainstormDraft={brainstormDraft}
              brainstormLoading={brainstormLoading}
              brainstormError={brainstormError}
              brainstormUseProjectContext={brainstormUseProjectContext}
              onBrainstormDraftChange={setBrainstormDraft}
              onBrainstormSend={(attachments?: UploadedChatFile[]) => void sendBrainstorm(attachments ?? [])}
              onBrainstormContextChange={setBrainstormUseProjectContext}
            />
          </section>
        </div>
      )}

      {activePage === "archive" && (
        <section
          id="project-page-archive"
          className="project-page-panel pd-section pd-section--memory"
          role="tabpanel"
          aria-label="企业档案"
        >
          <div className="pd-section__head">
            <div>
              <h2 className="pd-section__title">企业档案</h2>
            </div>
            {hasWarRoom && (
              <button
                type="button"
                className="pd-section__link"
                onClick={() => navigate(`/projects/${project.id}/war-room`)}
              >
                查看作战室交付
              </button>
            )}
          </div>

          <section className="project-archive-hero">
            <div className="project-archive-hero__main">
              <h3>{companyName}</h3>
              <p>
                {archiveSummaryLine || "这个项目的企业基础信息还不够完整，建议先补充行业、主营业务和商业模式。"}
              </p>
              <div className="project-archive-hero__tags">
                <span>{profileMap["规模"] || "规模待补充"}</span>
                <span>{profileMap["发展阶段"] || "阶段待补充"}</span>
                <span>{archive.last_updated ? `最近更新 ${fmtDate(archive.last_updated)}` : "尚无归档更新时间"}</span>
              </div>
              <div className="project-archive-hero__completeness">
                <div className="project-archive-hero__progress" aria-label={`档案完整度 ${archiveCompleteness}%`}>
                  <span style={{ width: `${archiveCompleteness}%` }} />
                </div>
                <strong>{archiveCompleteness}%</strong>
                <span>档案完整度</span>
                <InfoTip content="按企业概况、经营板块、关联数据和诊断迭代综合估算。为避免误导，完整度只表示当前可支撑复诊的资料成熟度，永远不会显示 100%。" />
              </div>
              {archiveHeroProfile.length > 0 ? (
                <div className="project-archive-hero__profile" aria-label="企业概况">
                  {archiveHeroProfile.map((field) => (
                    <div key={field.label}>
                      <span>{field.label}</span>
                      <strong>{field.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="project-archive-action project-archive-action--inline"
                  onClick={() => openArchiveFilePicker({ moduleKey: "profile", fieldKey: "company_profile" })}
                  disabled={isArchived || archiveUploading}
                >
                  补充企业基础信息
                </button>
              )}
            </div>
          </section>

          <nav className="project-archive-nav" aria-label="企业档案分页">
            {archiveSectionCards.map((section) => (
              <button
                key={section.key}
                type="button"
                className={activeArchiveSection === section.key ? "project-archive-nav__item is-active" : "project-archive-nav__item"}
                aria-pressed={activeArchiveSection === section.key}
                onClick={() => changeArchiveSection(section.key)}
              >
                <span>{section.label}</span>
                <strong>{section.value}</strong>
                <p>{section.detail}</p>
              </button>
            ))}
          </nav>
          <input
            ref={archiveFileInputRef}
            type="file"
            className="project-archive-file-input"
            multiple
            onChange={(event) => void handleArchiveFilesSelected(event)}
          />

          {activeArchiveSection === "modules" && (
            <section className="project-archive-block">
              <div className="project-archive-block__head">
                <div>
                  <div className="project-archive-block__title">
                    <h3>经营板块</h3>
                    <InfoTip content="每个板块只展示当前最值得复用的经营事实，先帮老板快速抓重点，细节按需展开查看。" />
                  </div>
                </div>
              </div>
              <div className="project-archive-domain-tabs" aria-label="经营领域">
                {archiveDomainCards.map((module) => (
                  <button
                    key={module.module}
                    type="button"
                    className={activeArchiveDomainCard?.module === module.module ? "project-archive-domain-tab is-active" : "project-archive-domain-tab"}
                    onClick={() => {
                      setActiveArchiveDomain(module.module);
                      setOpenModule(null);
                    }}
                  >
                    <span>{module.label}</span>
                    <em>{module.facts.length} 数据 · {module.files.length} 资料</em>
                  </button>
                ))}
              </div>
              {activeArchiveDomainCard && (() => {
                const module = activeArchiveDomainCard;
                const isOpen = openModule === module.module;
                const hasContent = module.has_data || module.files.length > 0;
                return (
                  <div className="project-archive-domain-pane">
                    <article
                      className={hasContent ? "project-archive-domain-card" : "project-archive-domain-card project-archive-domain-card--empty"}
                    >
                      <div className="project-archive-domain-card__head">
                        <div>
                          <strong>{module.label}</strong>
                          <span>{module.facts.length} 条数据 · {module.files.length} 份资料</span>
                        </div>
                        <em>{module.status}</em>
                      </div>
                      {hasContent ? (
                        <>
                          <div className="project-archive-domain-card__section">
                            <div className="project-archive-domain-card__section-head">
                              <span>关键数据</span>
                              {module.facts.length > 3 && <em>{module.facts.length} 项</em>}
                            </div>
                            {module.facts.length > 0 ? (
                              <div className="project-archive-domain-card__facts">
                                {module.preview.map((fact) => (
                                  <div key={fact.label} className="project-archive-domain-card__fact">
                                    <span>{fact.label}</span>
                                    <p>{fact.value}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="project-archive-domain-card__empty-copy">这个领域还缺少可复用的数据事实。</p>
                            )}
                          </div>
                          {module.remainder.length > 0 && (
                            <div className="project-archive-domain-card__more">
                              {isOpen && (
                                <div className="project-archive-domain-card__extra">
                                  {module.remainder.map((fact) => (
                                    <div key={fact.label} className="project-archive-domain-card__fact project-archive-domain-card__fact--extra">
                                      <span>{fact.label}</span>
                                      <p>{fact.value}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button
                                type="button"
                                className="pd-fact-more"
                                onClick={() => setOpenModule(isOpen ? null : module.module)}
                              >
                                {isOpen ? "收起明细" : `展开其余 ${module.remainder.length} 项`}
                              </button>
                            </div>
                          )}
                          <div className="project-archive-domain-card__section">
                            <div className="project-archive-domain-card__section-head">
                              <div className="project-archive-domain-card__section-title">
                                <span>资料文档</span>
                                {module.files.length > 0 && <em>{module.files.length} 份</em>}
                              </div>
                              <button
                                type="button"
                                className="project-archive-action project-archive-action--small"
                                onClick={() => openArchiveFilePicker({
                                  moduleKey: module.module,
                                  fieldKey: module.has_data || module.files.length > 0 ? "archive_upload" : "operating_data",
                                })}
                                disabled={isArchived || archiveUploading}
                              >
                                {archiveUploading ? "上传中..." : module.has_data || module.files.length > 0 ? "上传资料" : "补充经营数据"}
                              </button>
                            </div>
                            {module.files.length > 0 ? (
                              <ul className="project-archive-domain-files">
                                {module.files.slice(0, 3).map((file, index) => (
                                  <li key={`${file.name}-${index}`}>
                                    <div className="project-archive-domain-files__copy">
                                      <strong>{file.name}</strong>
                                      <span>{file.field || "未标注字段"} · {fmtDate(file.uploaded_at)}</span>
                                    </div>
                                    <div className="project-archive-file-actions">
                                      <button
                                        type="button"
                                        className="project-archive-file-action"
                                        onClick={() => void beginArchiveExtraction(file.id)}
                                        disabled={archiveExtractingFileId === file.id || archiveConfirming || archiveDeletingFileId === file.id}
                                      >
                                        {file.extraction_status === "confirmed"
                                          ? "重新沉淀"
                                          : archiveExtractingFileId === file.id
                                            ? "提炼中..."
                                            : "沉淀"}
                                      </button>
                                      <button
                                        type="button"
                                        className="project-archive-file-action project-archive-file-action--danger"
                                        onClick={() => void deleteArchiveFile(file.id)}
                                        disabled={isArchived || archiveDeletingFileId === file.id || archiveExtractingFileId === file.id || archiveConfirming}
                                      >
                                        {archiveDeletingFileId === file.id ? "删除中..." : "删除"}
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="project-archive-domain-card__empty-row">
                                <p className="project-archive-domain-card__empty-copy">暂无归档资料，可随时继续上传并沉淀。</p>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="project-archive-domain-card__empty">
                            <p className="project-archive-domain-card__empty-copy">这个领域还没有形成可复用的项目档案。</p>
                          </div>
                          <div className="project-archive-domain-card__section">
                            <div className="project-archive-domain-card__section-head">
                              <div className="project-archive-domain-card__section-title">
                                <span>资料文档</span>
                              </div>
                              <button
                                type="button"
                                className="project-archive-action project-archive-action--small"
                                onClick={() => openArchiveFilePicker({ moduleKey: module.module, fieldKey: "operating_data" })}
                                disabled={isArchived || archiveUploading}
                              >
                                {archiveUploading ? "上传中..." : "补充经营数据"}
                              </button>
                            </div>
                            <p className="project-archive-domain-card__empty-copy">暂无归档资料，可随时上传并沉淀。</p>
                          </div>
                        </>
                      )}
                    </article>
                  </div>
                );
              })()}
              {archiveUploadError && <p className="project-archive-upload-error">{archiveUploadError}</p>}
            </section>
          )}

          {activeArchiveSection === "assets" && (
            <section className="project-archive-block">
              <div className="project-archive-block__head">
                <div>
                  <div className="project-archive-block__title">
                    <h3>关联数据</h3>
                    <InfoTip content="这里展示系统预研和专家追搜沉淀下来的外部证据，重点看融合后的判断点；原始来源只作为可审计底稿保留。" />
                  </div>
                </div>
              </div>
              <p className="project-archive-support-copy">这里不再展示上传资料清单，只展示已经整理成判断支撑的关联证据。</p>
              <EvidencePackPanel
                evidence={evidencePack}
                title="关联证据内容"
                emptyText="暂无关联数据。完成深度尽调或专家追搜后，这里会沉淀可追溯来源。"
                compact
              />
              {evidenceError && <p className="project-evidence-error">{evidenceError}</p>}
            </section>
          )}

          {activeArchiveSection === "iterations" && (
            <section className="project-archive-block">
              <div className="project-archive-block__head">
                <div>
                  <div className="project-archive-block__title">
                    <h3>诊断迭代</h3>
                    <InfoTip content="这里记录的是这个项目累计做过多少轮正式诊断与资料沉淀，帮助判断当前档案的新鲜度和诊断上下文是否连续。" />
                  </div>
                </div>
              </div>
              {project.records.length === 0 ? (
                <p className="pd-empty">还没有正式归档的诊断记录。</p>
              ) : (
                <details
                  className="pd-accordion"
                  open={historyOpen}
                  onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
                >
                  <summary>
                    <span>
                      <strong>查看归档更新记录</strong>
                      <em>{project.records.length} 次提交</em>
                    </span>
                    <b>展开</b>
                  </summary>
                  <ul className="pd-update-list">
                    {project.records.map((r, index) => (
                      <li key={r.id} className="pd-update-item">
                        <time>{fmtDateTime(r.created_at)}</time>
                        <div className="project-archive-update-copy">
                          <strong>第 {project.records.length - index} 轮资料沉淀</strong>
                          <span>本次补充了 {r.module_count} 个经营板块的信息。</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </section>
      )}

      {archiveExtractionDraft && (
        <section className="project-archive-extract-modal" role="dialog" aria-label="确认资料沉淀">
          <div className="project-archive-extract-modal__card">
            <div className="project-archive-extract-modal__head">
              <div>
                <span>资料沉淀</span>
                <h3>{archiveExtractionDraft.file_name}</h3>
              </div>
              <button
                type="button"
                className="project-archive-extract-modal__close"
                onClick={() => setArchiveExtractionDraft(null)}
                disabled={archiveConfirming}
              >
                关闭
              </button>
            </div>
            <p className="project-archive-extract-modal__summary">
              AI 已按当前模块先提炼出适合沉淀到企业档案的重点。确认后会更新本项目档案。
            </p>
            <label className="project-archive-extract-modal__summary-field">
              <span>沉淀说明</span>
              <textarea
                value={archiveExtractionSummary}
                onChange={(event) => setArchiveExtractionSummary(event.target.value)}
                rows={2}
              />
            </label>
            <div className="project-archive-extract-modal__grid">
              {archiveExtractionDraft.highlights.map((item, index) => (
                <div key={`${item.label}-${index}`} className="project-archive-extract-modal__fact">
                  <input
                    value={item.label}
                    onChange={(event) => updateExtractionHighlight(index, "label", event.target.value)}
                    placeholder="字段名"
                  />
                  <textarea
                    value={item.value}
                    onChange={(event) => updateExtractionHighlight(index, "value", event.target.value)}
                    placeholder="提炼后的重点内容"
                    rows={3}
                  />
                </div>
              ))}
            </div>
            <div className="project-archive-extract-modal__actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setArchiveExtractionDraft(null)}
                disabled={archiveConfirming}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void confirmArchiveExtraction()}
                disabled={archiveConfirming}
              >
                {archiveConfirming ? "沉淀中..." : "确认沉淀"}
              </button>
            </div>
          </div>
        </section>
      )}
    </ProjectWorkspaceShell>
  );
}
