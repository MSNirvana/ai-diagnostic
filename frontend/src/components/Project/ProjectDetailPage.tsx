import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { addArchiveModule, confirmArchiveFileExtraction, createDiagnosisJob, deleteSessionFile, downloadSessionFile, extractArchiveFile, fetchRecord, getBrainstormSession, getDiagnosisJob, getLatestDiagnosisJobForSession, getProject, getProjectEvidence, getSessionFileBlob, hideArchiveModule, patchProject, sendBrainstormMessage, startSession, uploadSessionFile, viewSessionFile } from "../../api/client";
import { EvidencePackPanel } from "../Evidence/EvidencePackPanel";
import { Questionnaire } from "../Questionnaire/Questionnaire";
import type { ProjectChatMode, UploadedChatFile } from "../Questionnaire/ChatStep";
import { ProjectWorkspaceShell } from "./ProjectWorkspaceShell";
import type { ArchiveExtractionPreview, ArchiveFile, ArchivePreviewBlock, ChatMessage, DiagnosisDetail, DiagnosisJobStatus, ModuleAnswer, ProblemMap, ProfileField, ProjectArchive, ProjectDetail, ResearchEvidenceOut } from "../../types";
import "./ProjectDetailPage.css";

type ProjectPageKey = "start" | "archive" | "brainstorm";
type ArchiveSectionKey = "modules" | "assets" | "iterations";
type ChatAttachment = { id: string; name: string };
type InlineDiagnosisState = {
  jobId: string;
  status: "queued" | "researching" | "completed" | "failed" | string;
  currentStep: string;
  recordId?: string | null;
  error?: string | null;
};

type InlineDiagnosisCache = {
  sessionId?: string;
  jobId?: string;
  problemMapSignature?: string;
};

type InlineDiagnosisStage = {
  key: "collecting_data" | "researching" | "diagnosing" | "composing_war_room" | "pending_review" | "ready";
  label: string;
  detail: string;
  active: boolean;
};

const TERMINAL_DIAGNOSIS_JOB_STATUSES = new Set(["completed", "pending_review", "anonymous_complete", "failed"]);
const SUCCESS_DIAGNOSIS_JOB_STATUSES = new Set(["completed", "anonymous_complete"]);
const REVIEW_DIAGNOSIS_JOB_STATUSES = new Set(["pending_review"]);
const INLINE_DIAGNOSIS_CACHE_PREFIX = "ruice:inline-diagnosis:";

function inlineDiagnosisCacheKey(projectId: string): string {
  return `${INLINE_DIAGNOSIS_CACHE_PREFIX}${projectId}`;
}

function buildInlineDiagnosisStages(status: string, currentStep: string): InlineDiagnosisStage[] {
  const normalized = `${status} ${currentStep}`;
  const isCollecting = /collecting_data|合并上传文件|整理资料|资料采集/.test(normalized);
  const isResearching = /researching|系统预研|补充追搜|外部证据/.test(normalized);
  const isDiagnosing = /diagnosing|多专家|复判|诊断/.test(normalized);
  const isComposing = /composing_war_room|作战室草稿|作战室/.test(normalized);
  const isReview = /pending_review|顾问审核|深度判断/.test(normalized);
  const isReady = /completed|anonymous_complete/.test(normalized);

  const activeStage = isReady
    ? "ready"
    : isReview
      ? "pending_review"
      : isComposing
        ? "composing_war_room"
        : isDiagnosing
          ? "diagnosing"
          : isResearching
            ? "researching"
            : "collecting_data";

  return [
    {
      key: "collecting_data",
      label: "资料采集",
      detail: "整理会话、上传文件和可复用的基础资料。",
      active: activeStage === "collecting_data",
    },
    {
      key: "researching",
      label: "外部核验",
      detail: "抓竞品、行业、政策、新闻和公开页面证据。",
      active: activeStage === "researching",
    },
    {
      key: "diagnosing",
      label: "多专家诊断",
      detail: "并行 skill 交叉比对，形成结论和分歧。",
      active: activeStage === "diagnosing",
    },
    {
      key: "composing_war_room",
      label: "作战室生成",
      detail: "把诊断整理成老板能直接开会的交付。",
      active: activeStage === "composing_war_room",
    },
    {
      key: "pending_review",
      label: "顾问判断",
      detail: "顾问在后台复核证据、结论和动作。",
      active: activeStage === "pending_review",
    },
    {
      key: "ready",
      label: "正式交付",
      detail: "审核通过后，作战室正式可查看。",
      active: activeStage === "ready",
    },
  ];
}

function InfoTip({ content }: { content: ReactNode }) {
  const ariaLabel = typeof content === "string" ? content : "查看来源";
  return (
    <span className="pd-info-tip" tabIndex={0} aria-label={ariaLabel}>
      <span className="pd-info-tip__trigger" aria-hidden="true">?</span>
      <span className="pd-info-tip__bubble" role="tooltip">{content}</span>
    </span>
  );
}

function isArchiveImageFile(file: ArchiveFile): boolean {
  if (file.content_type === "image") return true;
  if (file.media_type?.startsWith("image/")) return true;
  return /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
}

function textPreviewBlock(text: string | ArchivePreviewBlock, index: number): ArchivePreviewBlock | null {
  if (typeof text !== "string" && text.type === "table") return null;
  const rawText = typeof text === "string" ? text : text.text;
  const clean = rawText.trim();
  if (!clean) return null;
  if (index === 0 && clean.length <= 80) return { type: "title", text: clean, level: 1 };
  if (/^[一二三四五六七八九十]+[、.．]\s*/.test(clean)) return { type: "heading", text: clean, level: 2 };
  if (/^\d+(?:\.\d+)+\s+/.test(clean)) return { type: "heading", text: clean, level: 3 };
  return { type: "paragraph", text: clean };
}

function normalizeArchivePreviewBlock(block: ArchivePreviewBlock | string, index: number): ArchivePreviewBlock | null {
  if (typeof block === "string") return textPreviewBlock(block, index);
  if (block.type === "table") {
    const rows = block.rows
      ?.map((row) => row.map((cell) => String(cell || "").trim()))
      .filter((row) => row.some(Boolean)) ?? [];
    return rows.length > 0 ? { type: "table", rows } : null;
  }
  const text = String(block.text || "").trim();
  if (!text) return null;
  return {
    type: block.type || "paragraph",
    text,
    level: block.level,
  };
}

function archivePreviewBlocks(file: ArchiveFile): ArchivePreviewBlock[] {
  const blocks = file.preview_blocks
    ?.map((item, index) => normalizeArchivePreviewBlock(item, index))
    .filter((item): item is ArchivePreviewBlock => Boolean(item)) ?? [];
  if (blocks.length > 0) return blocks;
  const text = (file.preview_text || "当前文件已保存原件，但没有可展示的文本预览。可下载原件查看完整内容。").trim();
  if (!text) return [];
  const byLines = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (byLines.length > 1) {
    return byLines
      .map((item, index) => textPreviewBlock(item, index))
      .filter((item): item is ArchivePreviewBlock => Boolean(item));
  }
  return text
    .replace(/([。！？；])\s*(?=(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|[（(]\d+[）)]))/g, "$1\n")
    .replace(/\s+(?=(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|[（(]\d+[）)]))/g, "\n")
    .split(/\n+/)
    .map((item, index) => textPreviewBlock(item, index))
    .filter((item): item is ArchivePreviewBlock => Boolean(item));
}

function archivePreviewBlockClass(block: ArchivePreviewBlock, index: number): string {
  if (block.type === "table") return "is-table";
  const text = "text" in block ? block.text : "";
  if (block.type === "title" || (index === 0 && text.length <= 80)) return "is-title";
  if (block.type === "heading") return `is-heading is-heading-level-${block.level || 3}`;
  if (/^(?:[一二三四五六七八九十]+、|\d+(?:\.\d+)*\s|[（(]\d+[）)]|第[一二三四五六七八九十\d]+[章节部分])/.test(text)) {
    return "is-heading";
  }
  return "is-paragraph";
}

function toInlineDiagnosisState(status: DiagnosisJobStatus): InlineDiagnosisState {
  return {
    jobId: status.id,
    status: status.status,
    currentStep: status.current_step,
    recordId: status.record_id,
    error: status.error,
  };
}

function normalizeProblemMapValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? item.trim() : item);
  }
  if (typeof value === "string") return value.trim();
  return value;
}

function problemMapSignature(problemMap?: ProblemMap | null): string {
  if (!problemMap) return "";
  try {
    const normalized = Object.keys(problemMap)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeProblemMapValue((problemMap as unknown as Record<string, unknown>)[key]);
        return acc;
      }, {});
    return JSON.stringify(normalized);
  } catch {
    return "";
  }
}

function readInlineDiagnosisCache(projectId: string): InlineDiagnosisCache | null {
  try {
    const raw = window.localStorage.getItem(inlineDiagnosisCacheKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function writeInlineDiagnosisCache(projectId: string, payload: InlineDiagnosisCache) {
  try {
    const current = readInlineDiagnosisCache(projectId) ?? {};
    window.localStorage.setItem(inlineDiagnosisCacheKey(projectId), JSON.stringify({ ...current, ...payload }));
  } catch {
    // localStorage can be unavailable in private windows; backend session binding still works.
  }
}

function clearInlineDiagnosisCache(projectId: string) {
  try {
    window.localStorage.removeItem(inlineDiagnosisCacheKey(projectId));
  } catch {
    // ignore storage failures
  }
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
const ARCHIVE_FIELD_LABELS: Record<string, string> = {
  company_name: "公司名称",
  industry: "所属行业",
  main_business: "主营业务",
  business_model: "商业模式",
  scale: "规模",
  stage: "发展阶段",
  core_problem: "核心问题",
  goal: "目标",
  constraints: "约束条件",
  success_criteria: "成功标准",
  impact: "业务影响",
  context: "背景情况",
  suspected_cause: "疑似原因",
  tried: "已尝试动作",
  data_readiness: "可用数据",
  diagnosis_focus: "优先诊断方向",
  scenario_label: "业务场景",
  sub_problems: "子问题",
};

const MODULE_LABELS_EXTENDED: Record<string, string> = {
  ...MODULE_LABELS,
  acquisition_efficiency: "获客效率",
  legal_compliance: "法务合规",
  tax: "税务与财务合规",
  policy: "政策与监管",
  ip: "知识产权",
  supply_chain: "供应链",
  channel_franchise: "渠道与加盟",
  data_systems: "数据系统",
  retention_churn: "留存与流失",
  private_traffic: "私域运营",
  pricing_power: "定价能力",
  cash_runway: "现金安全",
};

function archiveFieldLabel(label: string) {
  const trimmed = label.trim();
  if (ARCHIVE_FIELD_LABELS[trimmed]) return ARCHIVE_FIELD_LABELS[trimmed];
  if (MODULE_LABELS_EXTENDED[trimmed]) return MODULE_LABELS_EXTENDED[trimmed];
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed) && /[_-]/.test(trimmed)) {
    return trimmed.replace(/[_-]+/g, " ");
  }
  return trimmed;
}

function splitArchiveValue(value: string): string[] {
  return value
    .split(/[\n；;、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isUrlLike(value: string) {
  return /^https?:\/\//i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value);
}

function normalizeArchiveUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function renderMetricText(value: string) {
  const chunks = value.split(/(\d+(?:\.\d+)?\s*(?:%|％|万|亿|元|USD|Token|条|人|个|秒|ms)?)/g);
  return chunks.map((chunk, index) => {
    if (/^\d/.test(chunk.trim())) {
      return <strong key={`${chunk}-${index}`}>{chunk}</strong>;
    }
    return <span key={`${chunk}-${index}`}>{chunk}</span>;
  });
}

function parseArchiveLinkEntries(value: string) {
  return splitArchiveValue(value)
    .map((item) => {
      const pieces = item.split(/\s+/);
      const urlText = pieces.find(isUrlLike);
      if (!urlText) return null;
      const label = item.replace(urlText, "").trim() || urlText.replace(/^https?:\/\//i, "");
      return {
        label,
        url: normalizeArchiveUrl(urlText),
        secondary: urlText.replace(/^https?:\/\//i, ""),
      };
    })
    .filter((item): item is { label: string; url: string; secondary: string } => Boolean(item));
}

function extractArchiveSourceLink(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const match = clean.match(/https?:\/\/[^\s，,；;]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s，,；;]*)?/i);
  if (!match) return null;
  const rawUrl = match[0];
  const label = clean.replace(rawUrl, "").replace(/^[来源：:\-\s]+/, "").trim() || rawUrl.replace(/^https?:\/\//i, "");
  return {
    label,
    url: normalizeArchiveUrl(rawUrl),
    secondary: rawUrl.replace(/^https?:\/\//i, ""),
  };
}

function renderArchiveSourceTip(fact: ProfileField) {
  const sourceLabels = fact.source_labels?.filter(Boolean) ?? [];
  const explicitLinks = sourceLabels
    .map((item) => extractArchiveSourceLink(item))
    .filter((item): item is { label: string; url: string; secondary: string } => Boolean(item));
  const valueLinks = fact.display?.type === "link_list" ? parseArchiveLinkEntries(fact.value) : [];
  const linksByUrl = new Map<string, { label: string; url: string; secondary: string }>();
  [...explicitLinks, ...valueLinks].forEach((item) => {
    if (!linksByUrl.has(item.url)) linksByUrl.set(item.url, item);
  });
  const links = [...linksByUrl.values()].slice(0, 4);
  const hasFileSource = sourceLabels.some((item) => /上传|资料|文档|附件|报告|表格|文件|截图|pdf|docx|xlsx|ppt/i.test(item));
  const tags = hasFileSource ? ["上传资料"] : [];

  if (links.length === 0 && tags.length === 0) return null;

  return (
    <InfoTip
      content={(
        <span className="archive-source-tip">
          {tags.length > 0 && (
            <span className="archive-source-tip__group">
              {tags.map((tag) => (
                <span key={tag} className="archive-source-tip__tag">{tag}</span>
              ))}
            </span>
          )}
          {links.length > 0 && (
            <span className="archive-source-tip__group archive-source-tip__group--links">
              {links.map((item) => (
                <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
                  <strong>{item.label}</strong>
                  <em>{item.secondary}</em>
                </a>
              ))}
            </span>
          )}
        </span>
      )}
    />
  );
}

function renderArchiveFactValue(fact: ProfileField) {
  const displayType = fact.display?.type ?? "text";
  const parts = splitArchiveValue(fact.value);

  if (displayType === "link_list") {
    const links = parseArchiveLinkEntries(fact.value);
    if (links.length === 0) return <p>{fact.value}</p>;
    return (
      <div className="project-archive-fact-links">
        {links.map((item, index) => {
          return (
            <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer">
              <span>{item.label}</span>
              <em>{item.secondary}</em>
            </a>
          );
        })}
      </div>
    );
  }

  if (displayType === "metric") {
    return (
      <div className="project-archive-fact-metric">
        <p>{renderMetricText(fact.value)}</p>
        {fact.display?.unit && <em>{fact.display.unit}</em>}
      </div>
    );
  }

  if (displayType === "list" && parts.length > 1) {
    return (
      <ul className="project-archive-fact-list">
        {parts.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    );
  }

  if (displayType === "funnel" && parts.length > 1) {
    return (
      <div className="project-archive-fact-flow">
        {parts.map((item, index) => (
          <span key={`${item}-${index}`}>
            <em>{String.fromCharCode(65 + index)}</em>
            {item}
          </span>
        ))}
      </div>
    );
  }

  if ((displayType === "table" || displayType === "trend") && parts.length > 1) {
    return (
      <div className="project-archive-fact-list project-archive-fact-list--compact">
        {parts.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
      </div>
    );
  }

  return (
    <p>
      {fact.value}
    </p>
  );
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === "string" ? item : "")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function compactText(value: unknown, maxLength = 90): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function memoryHighlights(entry: ProjectDetail["memory_entries"][number]): string[] {
  const payload = entry.payload ?? {};
  if (entry.entry_type === "diagnosis") {
    const topModule = typeof payload.top_module === "string" ? MODULE_LABELS_EXTENDED[payload.top_module] ?? payload.top_module : "";
    const conclusion = compactText(payload.conclusion);
    const signal = typeof payload.signal === "string" ? payload.signal : "";
    const signalLabel = signal === "red" ? "需关注" : signal === "yellow" ? "观察" : signal === "green" ? "健康" : "";
    return [
      topModule ? `主战场：${topModule}${signalLabel ? `（${signalLabel}）` : ""}` : "",
      conclusion ? `核心判断：${conclusion}` : "",
    ].filter(Boolean);
  }
  if (entry.entry_type === "problem_map" || entry.entry_type === "conversation") {
    const problemMap = (payload.problem_map ?? payload) as Record<string, unknown>;
    const coreProblem = compactText(problemMap.core_problem);
    const goal = compactText(problemMap.goal);
    return [
      coreProblem ? `问题地图：${coreProblem}` : "",
      goal ? `目标：${goal}` : "",
    ].filter(Boolean);
  }
  if (entry.entry_type === "archive_file_extract") {
    const highlights = Array.isArray(payload.highlights) ? payload.highlights : [];
    return highlights
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { label?: unknown; value?: unknown };
        const label = compactText(row.label, 28);
        const value = compactText(row.value, 80);
        return label && value ? `${label}：${value}` : value;
      })
      .filter(Boolean)
      .slice(0, 3);
  }
  return [compactText(entry.summary, 120)].filter(Boolean);
}

function memoryActions(entry: ProjectDetail["memory_entries"][number]): string[] {
  const payload = entry.payload ?? {};
  if (entry.entry_type === "diagnosis") {
    return asStringList(payload.actions).slice(0, 3);
  }
  if (entry.entry_type === "feedback") {
    const comment = compactText(payload.comment, 100);
    return comment ? [`根据反馈修正：${comment}`] : [];
  }
  return [];
}

function customArchiveModuleKey(label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return `custom_${ascii || Date.now().toString(36)}`;
}

const EMPTY_ARCHIVE: ProjectArchive = {
  profile: [],
  modules: [
    { module: "market", label: "市场与客户", facts: [], has_data: false },
    { module: "product", label: "产品与服务", facts: [], has_data: false },
    { module: "sales", label: "销售与增长", facts: [], has_data: false },
  ],
  recommended_modules: [],
  hidden_modules: [],
  files: [],
  last_updated: null,
};

const VALID_PAGES: ProjectPageKey[] = ["start", "archive", "brainstorm"];
const VALID_ARCHIVE_SECTIONS: ArchiveSectionKey[] = ["modules", "assets", "iterations"];

type ProjectNavigationSnapshot = Partial<ProjectDetail> & Pick<ProjectDetail, "id" | "name" | "status">;

function projectSnapshotToDetail(snapshot: ProjectNavigationSnapshot | null | undefined): ProjectDetail | null {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    name: snapshot.name,
    created_at: snapshot.created_at ?? new Date().toISOString(),
    updated_at: snapshot.updated_at ?? new Date().toISOString(),
    status: snapshot.status,
    memory_summary: snapshot.memory_summary ?? "",
    memory_entries: snapshot.memory_entries ?? [],
    sessions: snapshot.sessions ?? [],
    brainstorm_sessions: snapshot.brainstorm_sessions ?? [],
    records: snapshot.records ?? [],
    archive: snapshot.archive ?? EMPTY_ARCHIVE,
    war_room_plan: snapshot.war_room_plan ?? null,
    delivery_status: snapshot.delivery_status,
  };
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const pageFromQuery = query.get("page");
  const archiveSectionFromQuery = query.get("section");
  const brainstormIdFromQuery = query.get("brainstormId");
  const navState = (location.state as {
    projectSnapshot?: ProjectNavigationSnapshot;
    resumeSessionId?: string;
    newConversation?: boolean;
    rejectedRecordId?: string;
    initialPrompt?: string;
  } | null) ?? {};
  const initialProject = navState.projectSnapshot && navState.projectSnapshot.id === id
    ? projectSnapshotToDetail(navState.projectSnapshot)
    : null;
  const activePage = VALID_PAGES.includes(pageFromQuery as ProjectPageKey)
    ? (pageFromQuery as ProjectPageKey)
    : "start";
  const activeArchiveSection = VALID_ARCHIVE_SECTIONS.includes(archiveSectionFromQuery as ArchiveSectionKey)
    ? (archiveSectionFromQuery as ArchiveSectionKey)
    : "modules";
  const [project, setProject] = useState<ProjectDetail | null>(initialProject);
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
  const [inlineDiagnosis, setInlineDiagnosis] = useState<InlineDiagnosisState | null>(null);
  const [inlineQuestionnaireMode, setInlineQuestionnaireMode] = useState<"chatting" | "generating" | "ready" | "gen_error">("chatting");
  const [openDataCollectionRequestId, setOpenDataCollectionRequestId] = useState(0);
  const [latestProblemMap, setLatestProblemMap] = useState<ProblemMap | null>(null);
  const [lastDiagnosedProblemMapSignature, setLastDiagnosedProblemMapSignature] = useState("");
  const [rediagnoseRequestId, setRediagnoseRequestId] = useState(0);
  const [rediagnoseNotice, setRediagnoseNotice] = useState<string | null>(null);
  const [supplementRecord, setSupplementRecord] = useState<DiagnosisDetail | null>(null);
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
  const [archiveFileNotice, setArchiveFileNotice] = useState<string | null>(null);
  const [archiveExtractingFileId, setArchiveExtractingFileId] = useState<string | null>(null);
  const [archiveDeletingFileId, setArchiveDeletingFileId] = useState<string | null>(null);
  const [archiveFileMenuId, setArchiveFileMenuId] = useState<string | null>(null);
  const [archiveFileBusyId, setArchiveFileBusyId] = useState<string | null>(null);
  const [archiveAddingModule, setArchiveAddingModule] = useState<string | null>(null);
  const [customArchiveModuleOpen, setCustomArchiveModuleOpen] = useState(false);
  const [customArchiveModuleName, setCustomArchiveModuleName] = useState("");
  const [archiveHidingModule, setArchiveHidingModule] = useState<string | null>(null);
  const [archiveExtractionDraft, setArchiveExtractionDraft] = useState<ArchiveExtractionPreview | null>(null);
  const [archiveExtractionSummary, setArchiveExtractionSummary] = useState("");
  const [archiveConfirming, setArchiveConfirming] = useState(false);
  const [archivePreviewFile, setArchivePreviewFile] = useState<ArchiveFile | null>(null);
  const [archivePreviewImageUrl, setArchivePreviewImageUrl] = useState<string | null>(null);
  const [archivePreviewImageLoading, setArchivePreviewImageLoading] = useState(false);
  const [archivePreviewImageError, setArchivePreviewImageError] = useState<string | null>(null);
  const archiveFileInputRef = useRef<HTMLInputElement | null>(null);
  const justSavedBrainstormIdRef = useRef<string | null>(null);

  const closeArchivePreview = () => {
    setArchivePreviewFile(null);
    if (archivePreviewImageUrl) URL.revokeObjectURL(archivePreviewImageUrl);
    setArchivePreviewImageUrl(null);
    setArchivePreviewImageError(null);
  };

  const restoreInlineDiagnosisFromSession = (sessionId: string, projectId: string) => {
    getLatestDiagnosisJobForSession(sessionId)
      .then((status) => {
        if (!status) return;
        setInlineDiagnosis(toInlineDiagnosisState(status));
        writeInlineDiagnosisCache(projectId, { sessionId, jobId: status.id });
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!id) return;
    getProject(id)
      .then((nextProject) => {
        setProject(nextProject);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
    getProjectEvidence(id)
      .then(setEvidencePack)
      .catch((e) => setEvidenceError(e instanceof Error ? e.message : "证据加载失败"));
  }, [id]);

  useEffect(() => {
    if (!id || inlineDiagnosis) return;
    const cached = readInlineDiagnosisCache(id);
    if (!cached?.jobId) return;
    if (cached.problemMapSignature) setLastDiagnosedProblemMapSignature(cached.problemMapSignature);
    if (cached.sessionId) setActiveInlineSessionId(cached.sessionId);
    setInlineDiagnosis({
      jobId: cached.jobId,
      status: "queued",
      currentStep: "正在恢复诊断方案任务",
    });
    getDiagnosisJob(cached.jobId)
      .then((status) => {
        setInlineDiagnosis(toInlineDiagnosisState(status));
        if (cached.sessionId) {
          writeInlineDiagnosisCache(id, { sessionId: cached.sessionId, jobId: status.id });
        }
      })
      .catch(() => {
        if (cached.sessionId) {
          restoreInlineDiagnosisFromSession(cached.sessionId, id);
        } else {
          clearInlineDiagnosisCache(id);
          setInlineDiagnosis(null);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id || !activeInlineSessionId || inlineDiagnosis) return;
    restoreInlineDiagnosisFromSession(activeInlineSessionId, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeInlineSessionId, inlineDiagnosis]);

  useEffect(() => {
    if (!inlineDiagnosis || lastDiagnosedProblemMapSignature || !latestProblemMap) return;
    const signature = problemMapSignature(latestProblemMap);
    if (!signature) return;
    setLastDiagnosedProblemMapSignature(signature);
    if (project?.id) {
      writeInlineDiagnosisCache(project.id, { problemMapSignature: signature });
    }
  }, [inlineDiagnosis, lastDiagnosedProblemMapSignature, latestProblemMap, project?.id]);

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
    const closeArchiveFileMenu = () => setArchiveFileMenuId(null);
    window.addEventListener("click", closeArchiveFileMenu);
    return () => window.removeEventListener("click", closeArchiveFileMenu);
  }, []);

  useEffect(() => {
    return () => {
      if (archivePreviewImageUrl) URL.revokeObjectURL(archivePreviewImageUrl);
    };
  }, [archivePreviewImageUrl]);

  useEffect(() => {
    if (!archivePreviewFile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [archivePreviewFile]);

  useEffect(() => {
    if (!navState.newConversation || !project?.id) return;
    resetInlineConversation();
    if (navState.initialPrompt) {
      setInlineInitialPrompt(navState.initialPrompt);
    }
    if (navState.rejectedRecordId) {
      setInlineError(null);
    }
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
      },
      {
      replace: true,
      preventScrollReset: true,
      state: {
        projectSnapshot: project,
        newConversation: false,
        resumeSessionId: undefined,
        rejectedRecordId: navState.rejectedRecordId,
        initialPrompt: navState.initialPrompt,
      },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navState.newConversation, navState.initialPrompt, navState.rejectedRecordId, project?.id]);

  useEffect(() => {
    if (!navState.rejectedRecordId) {
      setSupplementRecord(null);
      return;
    }
    let cancelled = false;
    fetchRecord(navState.rejectedRecordId)
      .then((record) => {
        if (!cancelled) setSupplementRecord(record);
      })
      .catch(() => {
        if (!cancelled) setSupplementRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [navState.rejectedRecordId]);

  useEffect(() => {
    const modules = project?.archive?.modules ?? [];
    if (modules.length === 0) return;
    if (!modules.some((module) => module.module === activeArchiveDomain)) {
      setActiveArchiveDomain(modules[0].module);
    }
  }, [activeArchiveDomain, project?.archive?.modules]);

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

  useEffect(() => {
    if (!project?.id || !inlineDiagnosis?.jobId || TERMINAL_DIAGNOSIS_JOB_STATUSES.has(inlineDiagnosis.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await getDiagnosisJob(inlineDiagnosis.jobId);
        if (cancelled) return;
        setInlineDiagnosis(toInlineDiagnosisState(status));
        if (TERMINAL_DIAGNOSIS_JOB_STATUSES.has(status.status)) {
          getProject(project.id).then(setProject).catch(() => {});
          return;
        }
        timer = setTimeout(poll, 3500);
      } catch (e) {
        if (!cancelled) {
          setInlineDiagnosis((current) => current ? {
            ...current,
            status: "failed",
            error: e instanceof Error ? e.message : "诊断方案状态获取失败",
          } : current);
        }
      }
    };

    timer = setTimeout(poll, 1800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [inlineDiagnosis?.jobId, inlineDiagnosis?.status, project?.id]);

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
    setInlineResetKey((key) => key + 1);
    setInlineQuestionnaireMode("chatting");
    setInlineError(null);
    setInlineDiagnosis(null);
    restoreInlineDiagnosisFromSession(sessionId, project.id);
  };
  const handleInlineSessionStarted = (sessionId: string, firstMessage?: string) => {
    const cleanTitle = (firstMessage ?? "").replace(/\s+/g, " ").trim();
    const title = cleanTitle ? (cleanTitle.length > 24 ? `${cleanTitle.slice(0, 24)}...` : cleanTitle) : "新的咨询对话";
    const now = new Date().toISOString();
    setProject((current) => {
      if (!current) return current;
      const existing = current.sessions.some((session) => session.id === sessionId);
      const nextSession = {
        id: sessionId,
        title,
        status: "chatting",
        updated_at: now,
        is_pinned: false,
        memory_enabled: true,
      };
      return {
        ...current,
        sessions: existing
          ? current.sessions.map((session) => session.id === sessionId ? { ...session, ...nextSession } : session)
          : [nextSession, ...current.sessions],
      };
    });
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
    setRediagnoseNotice(null);
    try {
      const targetProjectId = pid ?? project.id;
      const job = await createDiagnosisJob(answers, sessionId, targetProjectId, problemMap);
      const signature = problemMapSignature(problemMap ?? latestProblemMap);
      if (problemMap) setLatestProblemMap(problemMap);
      if (signature) setLastDiagnosedProblemMapSignature(signature);
      if (sessionId) {
        setActiveInlineSessionId(sessionId);
        writeInlineDiagnosisCache(targetProjectId, { sessionId, jobId: job.job_id, problemMapSignature: signature || undefined });
      }
      setInlineDiagnosis({
        jobId: job.job_id,
        status: job.status,
        currentStep: "资料已提交，正在启动深度尽调",
      });
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
  const handleQuestionnaireProblemMapChange = (problemMap: ProblemMap | null) => {
    setLatestProblemMap(problemMap);
    if (problemMap) setRediagnoseNotice(null);
  };
  const requestRediagnosis = () => {
    const currentSignature = problemMapSignature(latestProblemMap);
    if (!currentSignature) {
      setRediagnoseNotice("请先继续对话更新问题地图，再重新诊断。");
      return;
    }
    if (lastDiagnosedProblemMapSignature && currentSignature === lastDiagnosedProblemMapSignature) {
      setRediagnoseNotice("问题地图未更新，无需重新诊断。");
      return;
    }
    setRediagnoseNotice(null);
    setRediagnoseRequestId((value) => value + 1);
  };
  const openInlineDataCollection = () => {
    navigate(`/projects/${project.id}`, {
      replace: true,
      preventScrollReset: true,
      state: { projectSnapshot: project },
    });
    setInlineQuestionnaireMode("ready");
    setOpenDataCollectionRequestId((value) => value + 1);
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
    setInlineDiagnosis(null);
    setInlineQuestionnaireMode("chatting");
    clearInlineDiagnosisCache(project.id);
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
    setArchiveFileNotice(null);
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
    setArchiveFileNotice(null);
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
  const openArchivePreview = async (file: ArchiveFile) => {
    setArchiveUploadError(null);
    setArchiveFileNotice(null);
    setArchiveFileMenuId(null);
    setArchivePreviewFile(file);
    setArchivePreviewImageError(null);
    if (archivePreviewImageUrl) URL.revokeObjectURL(archivePreviewImageUrl);
    setArchivePreviewImageUrl(null);
    if (!isArchiveImageFile(file)) {
      setArchivePreviewImageLoading(false);
      return;
    }
    setArchivePreviewImageLoading(true);
    try {
      const blob = await getSessionFileBlob(file.id);
      setArchivePreviewImageUrl(URL.createObjectURL(blob));
    } catch (e) {
      setArchivePreviewImageError(e instanceof Error ? e.message : "图片加载失败，可下载原件查看。");
    } finally {
      setArchivePreviewImageLoading(false);
    }
  };
  const viewArchiveFile = async (fileId: string, fileName: string) => {
    setArchiveUploadError(null);
    setArchiveFileNotice(null);
    setArchiveFileBusyId(`view:${fileId}`);
    setArchiveFileMenuId(null);
    try {
      await viewSessionFile(fileId, fileName);
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "打开资料失败");
    } finally {
      setArchiveFileBusyId(null);
    }
  };
  const downloadArchiveFile = async (fileId: string, fileName: string) => {
    setArchiveUploadError(null);
    setArchiveFileNotice(null);
    setArchiveFileBusyId(`download:${fileId}`);
    setArchiveFileMenuId(null);
    try {
      await downloadSessionFile(fileId, fileName);
      setArchiveFileNotice(`已开始下载：${fileName}`);
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "下载资料失败");
    } finally {
      setArchiveFileBusyId(null);
    }
  };
  const deleteArchiveFile = async (fileId: string) => {
    if (isArchived || archiveDeletingFileId) return;
    setArchiveUploadError(null);
    setArchiveFileNotice(null);
    setArchiveFileMenuId(null);
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
  const enableArchiveModule = async (module: string, label: string) => {
    if (isArchived || archiveAddingModule) return;
    setArchiveUploadError(null);
    setArchiveAddingModule(module);
    try {
      const nextArchive = await addArchiveModule(project.id, { module, label });
      setProject((current) => current ? { ...current, archive: nextArchive } : current);
      setActiveArchiveDomain(module);
      setOpenModule(null);
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "新增数据板块失败");
    } finally {
      setArchiveAddingModule(null);
    }
  };
  const submitCustomArchiveModule = async () => {
    const label = customArchiveModuleName.trim();
    if (!label) {
      setArchiveUploadError("请输入自定义数据板块名称");
      return;
    }
    const exists = archive.modules.some((module) => module.label === label);
    if (exists) {
      setArchiveUploadError("这个数据板块已经存在");
      return;
    }
    const moduleKey = customArchiveModuleKey(label);
    await enableArchiveModule(moduleKey, label);
    setCustomArchiveModuleName("");
    setCustomArchiveModuleOpen(false);
  };
  const hideArchiveDomain = async (module: string) => {
    if (isArchived || archiveHidingModule) return;
    setArchiveUploadError(null);
    setArchiveHidingModule(module);
    try {
      const nextArchive = await hideArchiveModule(project.id, module);
      setProject((current) => current ? { ...current, archive: nextArchive } : current);
      const nextActive = nextArchive.modules.find((item) => item.module !== module)?.module;
      if (activeArchiveDomain === module && nextActive) {
        setActiveArchiveDomain(nextActive);
      }
      setOpenModule(null);
    } catch (e) {
      setArchiveUploadError(e instanceof Error ? e.message : "隐藏数据板块失败");
    } finally {
      setArchiveHidingModule(null);
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
    label: MODULE_LABELS_EXTENDED[module.module] ?? module.label,
    facts: module.facts.map((fact) => ({ ...fact, label: archiveFieldLabel(fact.label) })),
    preview: module.facts.slice(0, 3).map((fact) => ({ ...fact, label: archiveFieldLabel(fact.label) })),
    remainder: module.facts.slice(3).map((fact) => ({ ...fact, label: archiveFieldLabel(fact.label) })),
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
  const recommendedArchiveModules = archive.recommended_modules ?? [];
  const hiddenArchiveModules = archive.hidden_modules ?? [];
  const archiveActiveModules = archiveModuleSnapshots.filter((module) => module.has_data).length;
  const archiveSectionCards = [
    {
      key: "modules" as const,
      label: "数据板块",
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
  const warRoomIterationsByRecordId = new Map(
    (project.war_room_plan?.iterations ?? []).map((iteration) => [iteration.record_id, iteration])
  );
  const memoryEntriesByRecordId = project.memory_entries.reduce((map, entry) => {
    if (!entry.source_id) return map;
    const list = map.get(entry.source_id) ?? [];
    list.push(entry);
    map.set(entry.source_id, list);
    return map;
  }, new Map<string, typeof project.memory_entries>());
  const iterationDetails = project.records.map((record, index) => {
    const memories = memoryEntriesByRecordId.get(record.id) ?? [];
    const warIteration = warRoomIterationsByRecordId.get(record.id);
    const deposited = memories.flatMap(memoryHighlights).filter(Boolean);
    const actions = [
      ...memories.flatMap(memoryActions),
      ...(warIteration ? [
        compactText(warIteration.objective ? `作战目标：${warIteration.objective}` : "", 120),
        ...asStringList(warIteration.changes).slice(0, 3),
      ] : []),
    ].filter(Boolean);
    const primaryBattlefield = warIteration?.primary_battlefield
      ? MODULE_LABELS_EXTENDED[warIteration.primary_battlefield] ?? warIteration.primary_battlefield
      : "";
    return {
      record,
      round: project.records.length - index,
      memories,
      warIteration,
      deposited: deposited.slice(0, 4),
      actions: actions.slice(0, 4),
      primaryBattlefield,
    };
  });
  const changeArchiveSection = (section: ArchiveSectionKey) => {
    const params = new URLSearchParams(location.search);
    params.set("page", "archive");
    params.set("section", section);
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { preventScrollReset: true, state: { projectSnapshot: project } }
    );
  };
  const activeWorkspaceSection = activePage === "archive" ? "archive" : "new";
  const changeProjectChatMode = (mode: ProjectChatMode) => {
    setProjectChatMode(mode);
    navigate(
      mode === "brainstorm" ? `/projects/${project.id}?page=brainstorm` : `/projects/${project.id}`,
      { preventScrollReset: true, state: { projectSnapshot: project } }
    );
  };
  const inlineDiagnosisReady = inlineDiagnosis ? SUCCESS_DIAGNOSIS_JOB_STATUSES.has(inlineDiagnosis.status) : false;
  const inlineDiagnosisInReview = inlineDiagnosis ? REVIEW_DIAGNOSIS_JOB_STATUSES.has(inlineDiagnosis.status) : false;
  // 审核态以记录的 review_status 为准（跨刷新可靠），不只看 job 状态。
  const inlineDiagnosisRecord = inlineDiagnosis?.recordId
    ? project.records.find((r) => r.id === inlineDiagnosis.recordId)
    : undefined;
  const inlineReviewPending = inlineDiagnosisRecord?.review_status === "pending_review";
  const inlineReady = inlineDiagnosisReady && !inlineReviewPending;
  const inlineInReview = inlineDiagnosisInReview || inlineReviewPending;
  const inlineDiagnosisStages = inlineDiagnosis ? buildInlineDiagnosisStages(inlineDiagnosis.status, inlineDiagnosis.currentStep) : [];
  const inlineDiagnosisNotice = inlineDiagnosis ? (
    <div className={inlineReady ? "project-diagnosis-inline-status is-ready" : inlineDiagnosis.status === "failed" ? "project-diagnosis-inline-status is-error" : inlineInReview ? "project-diagnosis-inline-status is-review" : "project-diagnosis-inline-status"}>
      <div className="project-diagnosis-inline-status__copy">
        <span>
          {inlineReady
            ? "正式作战室已生成，可以查看交付。"
            : inlineDiagnosis.status === "failed"
              ? `诊断方案生成失败：${inlineDiagnosis.error || "请稍后重试"}`
              : inlineInReview
                ? "已提交顾问复核，顾问正在深度判断中。"
                : "正在基于你的问题定制诊断方案…（这需要几分钟）"}
        </span>
        <small className={rediagnoseNotice ? "project-diagnosis-inline-status__notice" : undefined}>
          {rediagnoseNotice ?? (inlineReady
            ? "已可直接查看作战室。"
            : inlineInReview
              ? "顾问通过后作战室会自动更新；其间你也可以继续对话补充资料。"
              : "你可以继续输入，系统会先把资料采集和外部核验跑完。")}
        </small>
      </div>
      {(inlineReady || inlineInReview) && (
        <div className="project-diagnosis-inline-status__actions">
          <button
            type="button"
            onClick={() => {
              if (inlineReady) {
                navigate(`/projects/${project.id}/war-room`);
              } else {
                openInlineDataCollection();
              }
            }}
          >
            {inlineReady ? "查看作战室" : "查看进度"}
          </button>
          <button
            type="button"
            className="project-diagnosis-inline-status__redo"
            onClick={requestRediagnosis}
            disabled={inlineLoading}
          >
            {inlineLoading ? "诊断中" : "重新诊断"}
          </button>
        </div>
      )}
      {!inlineReady && !inlineInReview && (
        <div className="project-diagnosis-inline-status__stages" aria-label="诊断流程">
          {inlineDiagnosisStages.map((stage) => (
            <span key={stage.key} className={stage.active ? "is-active" : ""}>
              <strong>{stage.label}</strong>
              <em>{stage.detail}</em>
            </span>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <ProjectWorkspaceShell
      project={project}
      activeSection={activeWorkspaceSection}
      conversationLayout={inlineQuestionnaireMode === "ready" ? "form" : "chat"}
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
            {inlineError && <p className="project-inline-state project-inline-state--error">{inlineError}</p>}
            {needsSupplement && (
              <button
                type="button"
                className="project-supplement-link"
                onClick={() => {
                  resetInlineConversation();
                  setInlineInitialPrompt("顾问已打回，请根据顾问意见补充资料并重新诊断。");
                  navigate(`/projects/${project.id}`, {
                    preventScrollReset: true,
                    state: {
                      projectSnapshot: project,
                      newConversation: true,
                      rejectedRecordId: latestRejectedRecord?.id,
                      initialPrompt: "顾问已打回，请根据顾问意见补充资料并重新诊断。",
                    },
                  });
                }}
                disabled={isArchived}
              >
                顾问已打回，点击补充资料再诊断。
              </button>
            )}
            <Questionnaire
              key={activeInlineSessionId ? `${activeInlineSessionId}-${inlineResetKey}` : inlineInitialPrompt ?? `project-inline-new-${inlineResetKey}`}
              onSubmit={submitInlineDiagnosis}
              projectId={project.id}
              resumeSessionId={activeInlineSessionId}
              supplementRecord={supplementRecord}
              initialPrompt={inlineInitialPrompt}
              variant="project-inline"
              projectMode={projectChatMode}
              onProjectModeChange={changeProjectChatMode}
              inputNotice={inlineDiagnosisNotice}
              diagnosisPlanActive={Boolean(inlineDiagnosis)}
              onProblemMapChange={handleQuestionnaireProblemMapChange}
              onSessionStarted={handleInlineSessionStarted}
              onModeChange={setInlineQuestionnaireMode}
              openDataCollectionRequestId={openDataCollectionRequestId}
              rediagnoseRequestId={rediagnoseRequestId}
              onRediagnoseBlocked={setRediagnoseNotice}
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
          aria-label="项目档案"
        >
          <div className="pd-section__head">
            <div>
              <h2 className="pd-section__title">项目档案</h2>
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
              <div className="project-archive-hero__top">
                <div>
                  <h3>{companyName}</h3>
                  <p>
                    {archiveSummaryLine || "基础信息还不完整，建议先补充行业、主营业务和商业模式。"}
                  </p>
                </div>
                <div className="project-archive-hero__completeness">
                  <strong>{archiveCompleteness}%</strong>
                  <span>档案完整度</span>
                  <InfoTip content="按项目概况、数据板块、关联数据和诊断迭代综合估算。完整度用于判断当前资料是否足够支撑复诊、顾问接手和作战室交付。" />
                  <div className="project-archive-hero__progress" aria-label={`档案完整度 ${archiveCompleteness}%`}>
                    <span style={{ width: `${archiveCompleteness}%` }} />
                  </div>
                </div>
              </div>
              <div className="project-archive-hero__tags" aria-label="项目基础信息">
                <span>{profileMap["所属行业"] || "行业待补充"}</span>
                <span>{profileMap["规模"] || "规模待补充"}</span>
                <span>{profileMap["发展阶段"] || "阶段待补充"}</span>
                <span>{archive.last_updated ? `更新 ${fmtDate(archive.last_updated)}` : "尚无归档更新时间"}</span>
              </div>
              {archiveProfileCards.length === 0 && (
                <button
                  type="button"
                  className="project-archive-action project-archive-action--inline"
                  onClick={() => openArchiveFilePicker({ moduleKey: "profile", fieldKey: "company_profile" })}
                  disabled={isArchived || archiveUploading}
                >
                  补充项目基础信息
                </button>
              )}
            </div>
          </section>

          <nav className="project-archive-nav" aria-label="项目档案分页">
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
                    <h3>数据板块</h3>
                    <InfoTip content="每个板块只展示当前最值得复用的经营事实，先帮老板快速抓重点，细节按需展开查看。" />
                  </div>
                </div>
              </div>
              {(recommendedArchiveModules.length > 0 || !customArchiveModuleOpen) && (
                <div className="project-archive-module-suggestions" aria-label="建议新增数据板块">
                  <span>建议新增</span>
                  <div>
                    {recommendedArchiveModules.map((module) => (
                      <button
                        key={module.module}
                        type="button"
                        onClick={() => void enableArchiveModule(module.module, module.label)}
                        disabled={isArchived || archiveAddingModule === module.module}
                        title={module.reason || undefined}
                      >
                        {archiveAddingModule === module.module ? "加入中..." : module.label}
                      </button>
                    ))}
                    {!customArchiveModuleOpen && (
                      <button
                        type="button"
                        className="project-archive-module-custom-trigger"
                        onClick={() => {
                          setCustomArchiveModuleOpen(true);
                          setArchiveUploadError(null);
                        }}
                        disabled={isArchived || Boolean(archiveAddingModule)}
                      >
                        自定义
                      </button>
                    )}
                  </div>
                </div>
              )}
              {customArchiveModuleOpen && (
                <div className="project-archive-module-custom" aria-label="自定义数据板块">
                  <span>自定义</span>
                  <div>
                    <input
                      type="text"
                      value={customArchiveModuleName}
                      placeholder="例如：区域渠道、售后服务、生产制造"
                      onChange={(event) => setCustomArchiveModuleName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitCustomArchiveModule();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void submitCustomArchiveModule()}
                      disabled={isArchived || Boolean(archiveAddingModule)}
                    >
                      {archiveAddingModule ? "创建中..." : "创建板块"}
                    </button>
                    <button
                      type="button"
                      className="project-archive-module-custom__cancel"
                      onClick={() => {
                        setCustomArchiveModuleOpen(false);
                        setCustomArchiveModuleName("");
                      }}
                      disabled={Boolean(archiveAddingModule)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              <div className="project-archive-domain-tabs" aria-label="经营领域">
                {archiveDomainCards.map((module) => (
                  <div
                    key={module.module}
                    className={activeArchiveDomainCard?.module === module.module ? "project-archive-domain-chip is-active" : "project-archive-domain-chip"}
                  >
                    <button
                      type="button"
                      className="project-archive-domain-tab"
                      onClick={() => {
                        setActiveArchiveDomain(module.module);
                        setOpenModule(null);
                      }}
                    >
                      <span>{module.label}</span>
                      <em>{module.facts.length} 数据 · {module.files.length} 资料</em>
                    </button>
                    <button
                      type="button"
                      className="project-archive-domain-hide"
                      onClick={() => void hideArchiveDomain(module.module)}
                      disabled={isArchived || archiveHidingModule === module.module}
                      aria-label="隐藏此数据板块"
                      title={`隐藏 ${module.label}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {hiddenArchiveModules.length > 0 && (
                <div className="project-archive-hidden-modules" aria-label="已隐藏数据板块">
                  <span>已隐藏</span>
                  <div>
                    {hiddenArchiveModules.map((module) => (
                      <button
                        key={module.module}
                        type="button"
                        onClick={() => void enableArchiveModule(module.module, module.label)}
                        disabled={isArchived || archiveAddingModule === module.module}
                        title={`点击恢复 ${module.label}`}
                      >
                        {archiveAddingModule === module.module ? "处理中..." : module.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
                                    <div className="project-archive-domain-card__fact-label">
                                      <span>{fact.label}</span>
                                      {renderArchiveSourceTip(fact)}
                                    </div>
                                    {renderArchiveFactValue(fact)}
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
                                      <div className="project-archive-domain-card__fact-label">
                                        <span>{fact.label}</span>
                                        {renderArchiveSourceTip(fact)}
                                      </div>
                                      {renderArchiveFactValue(fact)}
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
                                  <li key={`${file.id}-${index}`}>
                                    <div className="project-archive-domain-files__copy">
                                      <button
                                        type="button"
                                        className="project-archive-file-name"
                                        onClick={() => void openArchivePreview(file)}
                                        aria-label={`预览资料：${file.name}`}
                                      >
                                        {file.name}
                                      </button>
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
                                          ? "重新提炼"
                                          : archiveExtractingFileId === file.id
                                            ? "提炼中..."
                                            : "提炼入档"}
                                      </button>
                                      <div className="project-archive-file-more" onClick={(event) => event.stopPropagation()}>
                                        <button
                                          type="button"
                                          className="project-archive-file-more__trigger"
                                          aria-label={`${file.name} 更多选项`}
                                          aria-expanded={archiveFileMenuId === file.id}
                                          onClick={() => setArchiveFileMenuId((current) => current === file.id ? null : file.id)}
                                        >
                                          <span aria-hidden="true">•••</span>
                                        </button>
                                        {archiveFileMenuId === file.id && (
                                          <div className="project-archive-file-more__menu" role="menu">
                                            <button
                                              type="button"
                                              role="menuitem"
                                              onClick={() => void downloadArchiveFile(file.id, file.name)}
                                              disabled={archiveFileBusyId === `download:${file.id}`}
                                            >
                                              {archiveFileBusyId === `download:${file.id}` ? "下载中..." : "下载"}
                                            </button>
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="is-danger"
                                              onClick={() => void deleteArchiveFile(file.id)}
                                              disabled={isArchived || archiveDeletingFileId === file.id || archiveExtractingFileId === file.id || archiveConfirming}
                                            >
                                              {archiveDeletingFileId === file.id ? "删除中..." : "删除"}
                                            </button>
                                          </div>
                                        )}
                                      </div>
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
              {archiveFileNotice && <p className="project-archive-upload-notice">{archiveFileNotice}</p>}
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
                    {iterationDetails.map((item) => (
                      <li key={item.record.id} className="pd-update-item">
                        <time>{fmtDateTime(item.record.created_at)}</time>
                        <div className="project-archive-update-copy">
                          <div className="project-archive-update-copy__head">
                            <strong>第 {item.round} 轮资料沉淀</strong>
                            <span>{item.record.module_count} 个数据板块 · {item.memories.length} 条长期记忆</span>
                          </div>
                          {item.warIteration?.summary && (
                            <p className="project-archive-update-copy__summary">{item.warIteration.summary}</p>
                          )}
                          <div className="project-archive-update-grid">
                            <div>
                              <b>本次沉淀</b>
                              {item.deposited.length > 0 ? (
                                <ul>
                                  {item.deposited.map((line, lineIndex) => (
                                    <li key={`${item.record.id}-deposit-${lineIndex}`}>{line}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p>暂无结构化沉淀明细，建议后续补齐诊断结论或资料重点。</p>
                              )}
                            </div>
                            <div>
                              <b>后续动作</b>
                              {item.actions.length > 0 ? (
                                <ul>
                                  {item.actions.map((line, lineIndex) => (
                                    <li key={`${item.record.id}-action-${lineIndex}`}>{line}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p>暂无明确动作，可在作战室补充责任人与验收标准。</p>
                              )}
                            </div>
                          </div>
                          <div className="project-archive-update-meta">
                            <span>状态：{item.record.review_status === "approved" ? "已审核" : item.record.review_status === "pending_review" ? "审核中" : item.record.review_status === "rejected" ? "已打回" : "已记录"}</span>
                            {item.primaryBattlefield && <span>主战场：{item.primaryBattlefield}</span>}
                            {typeof item.warIteration?.confidence === "number" && (
                              <span>置信度：{Math.round(item.warIteration.confidence * 100)}%</span>
                            )}
                          </div>
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
              AI 已按当前模块先提炼出适合沉淀到项目档案的重点。确认后会更新本项目档案。
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

      {archivePreviewFile && createPortal(
        <section className="project-archive-preview-modal" role="dialog" aria-label="资料在线预览">
          <div className="project-archive-preview-modal__card">
            <div className="project-archive-preview-modal__head">
              <div>
                <span>资料预览</span>
                <h3>{archivePreviewFile.name}</h3>
              </div>
              <button
                type="button"
                className="project-archive-preview-modal__close"
                onClick={closeArchivePreview}
              >
                关闭
              </button>
            </div>
            <div className="project-archive-preview-modal__body">
              {isArchiveImageFile(archivePreviewFile) ? (
                <div className="project-archive-preview-image">
                  {archivePreviewImageLoading && <p>图片加载中...</p>}
                  {archivePreviewImageError && <p className="project-archive-preview-image__error">{archivePreviewImageError}</p>}
                  {archivePreviewImageUrl && (
                    <img src={archivePreviewImageUrl} alt={archivePreviewFile.name} />
                  )}
                </div>
              ) : (
                <article className="project-archive-preview-document">
                  {archivePreviewBlocks(archivePreviewFile).map((block, index) => (
                    block.type === "table" ? (
                      <div
                        key={`${archivePreviewFile.id}-preview-${index}`}
                        className="project-archive-preview-table-wrap"
                      >
                        <table className="project-archive-preview-table">
                          <tbody>
                            {block.rows.map((row, rowIndex) => (
                              <tr key={`${archivePreviewFile.id}-preview-${index}-${rowIndex}`}>
                                {row.map((cell, cellIndex) => (
                                  rowIndex === 0 ? (
                                    <th key={`${archivePreviewFile.id}-preview-${index}-${rowIndex}-${cellIndex}`}>
                                      {cell}
                                    </th>
                                  ) : (
                                    <td key={`${archivePreviewFile.id}-preview-${index}-${rowIndex}-${cellIndex}`}>
                                      {cell}
                                    </td>
                                  )
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p
                        key={`${archivePreviewFile.id}-preview-${index}`}
                        className={archivePreviewBlockClass(block, index)}
                      >
                        {block.text}
                      </p>
                    )
                  ))}
                </article>
              )}
            </div>
            <div className="project-archive-preview-modal__actions">
              <button
                type="button"
                className="project-archive-file-action"
                onClick={() => void viewArchiveFile(archivePreviewFile.id, archivePreviewFile.name)}
                disabled={archiveFileBusyId === `view:${archivePreviewFile.id}`}
              >
                {archiveFileBusyId === `view:${archivePreviewFile.id}` ? "打开中..." : "打开原文件"}
              </button>
              <button
                type="button"
                className="project-archive-file-action"
                onClick={() => void downloadArchiveFile(archivePreviewFile.id, archivePreviewFile.name)}
                disabled={archiveFileBusyId === `download:${archivePreviewFile.id}`}
              >
                {archiveFileBusyId === `download:${archivePreviewFile.id}` ? "下载中..." : "下载原件"}
              </button>
            </div>
          </div>
        </section>,
        document.body
      )}
    </ProjectWorkspaceShell>
  );
}
