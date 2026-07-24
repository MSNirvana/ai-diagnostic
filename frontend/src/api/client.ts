import type {
  ModuleAnswer,
  DiagnoseResult,
  DiagnosisSummary,
  DiagnosisDetail,
  BusinessProfile,
  GeneratedModule,
  GeneratedQuestionnaire,
  ChatMessage,
  ChatResponse,
  ChatTurnResponse,
  BrainstormSessionDetail,
  BrainstormSessionSummary,
  FreeChatResponse,
  IdeaCard,
  ProblemMap,
  ProblemSummary,
  SessionSummary,
  SessionDetail,
  ProjectSummary,
  ProjectDetail,
  ProjectArchive,
  WarRoomPlan,
  TransformationPlan,
  WarRoomFeedbackCreate,
  WarRoomFeedbackEvent,
  DataRequest,
  DataSupplementRequest,
  DataSupplementSubmission,
  SkillRegistryItem,
  SkillVersionOut,
  LLMConfigOut,
  UploadedFileOut,
  MeResponse,
  ProjectLedgerPage,
  CaseProductGroups,
  CaseProjectDetail,
  CaseProjectFilters,
  CaseInsights,
  L2Stats,
  L3Stats,
  L4Stats,
  ReviewQueueItem,
  ReviewDetail,
  DiagnosisJobCreated,
  DiagnosisJobStatus,
  ResearchEvidenceOut,
  ArchiveExtractionPreview,
  CreditsBalance,
  ImageAssetOut,
  ImageAssetUsage,
  ImageTaskStatus,
  CreateImageTaskResponse,
  ImageModelCapability,
  EcommerceSkillCatalog,
  CanvasScene,
  CanvasSceneResponse,
  CanvasExecutionResponse,
  ImageTemplateCatalog,
} from "../types";
import { clearToken, getToken, setToken } from "../auth/authStore";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const GGOO_API_BASE = (import.meta.env.VITE_GGOO_API_BASE ?? "https://api.ggoo.ai").replace(/\/$/, "");
let refreshPromise: Promise<string> | null = null;

class TransientAuthRefreshError extends Error {}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshGGOOAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    let response: Response;
    try {
      response = await globalThis.fetch(`${GGOO_API_BASE}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
      });
    } catch {
      throw new TransientAuthRefreshError("GGOO 登录刷新暂时不可用，请稍后重试");
    }
    const payload = await response.json().catch(() => null) as {
      code?: number;
      msg?: string;
      data?: { access_token?: string };
    } | null;
    if (response.status >= 500) {
      throw new TransientAuthRefreshError(payload?.msg || "GGOO 登录刷新暂时不可用，请稍后重试");
    }
    const token = payload?.data?.access_token?.trim();
    if (!response.ok || !token) {
      throw new Error(payload?.msg || "GGOO 登录状态已失效");
    }
    setToken(token);
    return token;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  if (response.status !== 401 || !getToken()) return response;
  try {
    const token = await refreshGGOOAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return await globalThis.fetch(input, { ...init, headers });
  } catch (error) {
    if (error instanceof TransientAuthRefreshError) throw error;
    clearToken();
    return response;
  }
}

// Keep all existing API methods on one retry-aware transport.
const fetch = apiFetch;

async function errorMessage(resp: Response, fallback: string): Promise<string> {
  if (resp.status === 401) {
    clearToken();
  }
  try {
    const body = await resp.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // ignore non-JSON error bodies
  }
  return `${fallback}: ${resp.status}`;
}

export async function runDiagnose(
  answers: ModuleAnswer[],
  sessionId?: string,
  projectId?: string,
  problemMap?: Partial<ProblemMap>
): Promise<DiagnoseResult> {
  const resp = await fetch(`${BASE}/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      answers,
      session_id: sessionId,
      project_id: projectId,
      problem_map: problemMap,
    }),
  });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body as DiagnoseResult;
}

export async function createDiagnosisJob(
  answers: ModuleAnswer[],
  sessionId?: string,
  projectId?: string,
  problemMap?: Partial<ProblemMap>
): Promise<DiagnosisJobCreated> {
  const resp = await fetch(`${BASE}/diagnosis-jobs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      answers,
      session_id: sessionId,
      project_id: projectId,
      problem_map: problemMap,
    }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "创建深度尽调任务失败"));
  return (await resp.json()) as DiagnosisJobCreated;
}

export async function requestConsultantReview(
  recordId: string
): Promise<{ record_id: string; review_status: string }> {
  const resp = await fetch(`${BASE}/diagnose/${recordId}/request-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "请求顾问复核失败"));
  return (await resp.json()) as { record_id: string; review_status: string };
}

export async function getDiagnosisJob(jobId: string): Promise<DiagnosisJobStatus> {
  const resp = await fetch(`${BASE}/diagnosis-jobs/${jobId}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取深度尽调任务失败"));
  return (await resp.json()) as DiagnosisJobStatus;
}

export async function getLatestDiagnosisJobForSession(sessionId: string): Promise<DiagnosisJobStatus | null> {
  const resp = await fetch(`${BASE}/diagnosis-jobs/session/${sessionId}/latest`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取会话诊断任务失败"));
  return (await resp.json()) as DiagnosisJobStatus | null;
}

export async function getDiagnosisJobEvidence(jobId: string): Promise<ResearchEvidenceOut[]> {
  const resp = await fetch(`${BASE}/diagnosis-jobs/${jobId}/evidence`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取尽调证据失败"));
  return (await resp.json()) as ResearchEvidenceOut[];
}

export async function getProjectEvidence(projectId: string): Promise<ResearchEvidenceOut[]> {
  const resp = await fetch(`${BASE}/project/${projectId}/evidence`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取项目证据失败"));
  return (await resp.json()) as ResearchEvidenceOut[];
}

export async function runDiagnoseWithFiles(
  answers: ModuleAnswer[],
  files: { moduleKey: string; fieldKey: string; file: File }[],
  sessionId?: string,
  projectId?: string,
  problemMap?: Partial<ProblemMap>
): Promise<DiagnoseResult> {
  const form = new FormData();
  form.append(
    "answers_json",
    JSON.stringify({
      answers,
      session_id: sessionId,
      project_id: projectId,
      problem_map: problemMap,
    })
  );
  for (const { moduleKey, fieldKey, file } of files) {
    // 三段命名 {moduleKey}_{fieldKey}_{原名}，后端据此把文件挂到对应字段
    const renamed = new File([file], `${moduleKey}_${fieldKey}_${file.name}`, {
      type: file.type,
    });
    form.append("files", renamed);
  }
  // FormData 请求不要手动设 Content-Type，浏览器会自动带 boundary
  const resp = await fetch(`${BASE}/diagnose/upload`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body as DiagnoseResult;
}

export async function submitFeedback(
  recordId: string,
  module: string,
  skillVersionId: string,
  rating: number,
  isUseful: boolean,
  comment?: string
): Promise<void> {
  await fetch(`${BASE}/diagnose/${recordId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      module,
      skill_version_id: skillVersionId,
      rating,
      is_useful: isUseful,
      comment,
    }),
  });
}

export async function fetchHistory(): Promise<DiagnosisSummary[]> {
  const resp = await fetch(`${BASE}/history/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取历史失败: ${resp.status}`);
  return (await resp.json()) as DiagnosisSummary[];
}

export async function fetchRecord(id: string): Promise<DiagnosisDetail> {
  const resp = await fetch(`${BASE}/history/${id}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取记录失败: ${resp.status}`);
  return (await resp.json()) as DiagnosisDetail;
}

export async function generateQuestionnaire(
  profile: BusinessProfile,
  projectId?: string
): Promise<GeneratedModule[]> {
  const resp = await fetch(`${BASE}/questionnaire/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ profile, project_id: projectId ?? null }),
  });
  if (!resp.ok) throw new Error(`生成失败: ${resp.status}`);
  const body = await resp.json();
  return body.modules as GeneratedModule[];
}

export async function sendChatMessage(
  messages: ChatMessage[]
): Promise<ChatResponse> {
  const resp = await fetch(`${BASE}/conversation/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ messages }),
  });
  if (!resp.ok) throw new Error(`对话失败: ${resp.status}`);
  return (await resp.json()) as ChatResponse;
}

export async function sendFreeChatMessage(
  messages: ChatMessage[],
  options: {
    projectContext?: string;
    projectId?: string;
    useProjectContext?: boolean;
    brainstormSessionId?: string;
    attachmentFileIds?: string[];
  } | string = ""
): Promise<FreeChatResponse> {
  const payload = typeof options === "string"
    ? { messages, project_context: options }
    : {
        messages,
        project_context: options.projectContext ?? "",
        project_id: options.projectId ?? null,
        use_project_context: Boolean(options.useProjectContext),
        brainstorm_session_id: options.brainstormSessionId ?? null,
        attachment_file_ids: options.attachmentFileIds ?? [],
      };
  const resp = await fetch(`${BASE}/conversation/free-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "对话失败"));
  return (await resp.json()) as FreeChatResponse;
}

export const sendBrainstormMessage = sendFreeChatMessage;

export async function listBrainstormSessions(projectId?: string): Promise<BrainstormSessionSummary[]> {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const resp = await fetch(`${BASE}/conversation/brainstorm-sessions${query}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取风暴记录失败"));
  return (await resp.json()) as BrainstormSessionSummary[];
}

export async function getBrainstormSession(id: string): Promise<BrainstormSessionDetail> {
  const resp = await fetch(`${BASE}/conversation/brainstorm-sessions/${id}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取风暴记录失败"));
  return (await resp.json()) as BrainstormSessionDetail;
}

export async function updateBrainstormSession(
  id: string,
  body: { title?: string; is_pinned?: boolean }
): Promise<BrainstormSessionSummary> {
  const resp = await fetch(`${BASE}/conversation/brainstorm-sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "更新风暴记录失败"));
  return (await resp.json()) as BrainstormSessionSummary;
}

export async function deleteBrainstormSession(id: string): Promise<void> {
  const resp = await fetch(`${BASE}/conversation/brainstorm-sessions/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "删除风暴记录失败"));
}

export async function saveIdeaCard(
  card: IdeaCard,
  messages: ChatMessage[],
  projectId?: string | null
): Promise<IdeaCard> {
  const resp = await fetch(`${BASE}/conversation/idea-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ card, messages, project_id: projectId ?? null }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "保存点子卡失败"));
  return (await resp.json()) as IdeaCard;
}

export async function listIdeaCards(): Promise<IdeaCard[]> {
  const resp = await fetch(`${BASE}/conversation/idea-cards`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取点子卡失败"));
  return (await resp.json()) as IdeaCard[];
}

// 单份动态问卷生成（带后端质量把关）。失败抛错，前端报错可重试，不降级固定问卷。
export async function generateFromSummary(
  summary: ProblemSummary,
  projectId?: string,
  problemMap?: ProblemMap,
): Promise<GeneratedQuestionnaire> {
  const resp = await fetch(`${BASE}/questionnaire/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      summary,
      problem_map: problemMap ?? null,
      project_id: projectId ?? null,
    }),
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const body = await resp.json();
      detail = body?.detail ?? "";
    } catch {
      detail = await resp.text().catch(() => "");
    }
    throw new Error(`${resp.status} ${detail}`.trim());
  }
  return (await resp.json()) as GeneratedQuestionnaire;
}


export async function startSession(projectId?: string, memoryEnabled = true): Promise<string> {
  const resp = await fetch(`${BASE}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ project_id: projectId ?? null, memory_enabled: memoryEnabled }),
  });
  if (!resp.ok) throw new Error(`创建会话失败: ${resp.status}`);
  return (await resp.json()).session_id as string;
}

export async function sessionChat(
  sessionId: string,
  message: string,
  memoryEnabled?: boolean
): Promise<ChatTurnResponse> {
  const resp = await fetch(`${BASE}/session/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message, memory_enabled: memoryEnabled ?? null }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "对话失败"));
  return (await resp.json()) as ChatTurnResponse;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const resp = await fetch(`${BASE}/session/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取会话列表失败: ${resp.status}`);
  return (await resp.json()) as SessionSummary[];
}

export async function getSessionDetail(id: string): Promise<SessionDetail> {
  const resp = await fetch(`${BASE}/session/${id}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取会话失败: ${resp.status}`);
  return (await resp.json()) as SessionDetail;
}

export async function updateSession(
  id: string,
  body: { title?: string; is_pinned?: boolean; memory_enabled?: boolean }
): Promise<SessionSummary> {
  const resp = await fetch(`${BASE}/session/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "更新会话失败"));
  return (await resp.json()) as SessionSummary;
}

export async function deleteSession(id: string): Promise<void> {
  const resp = await fetch(`${BASE}/session/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "删除会话失败"));
}

export async function saveSessionDraft(sessionId: string, draftJson: string): Promise<void> {
  await fetch(`${BASE}/session/${sessionId}/draft`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ draft_json: draftJson }),
  });
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const resp = await fetch(`${BASE}/project/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error(`创建项目失败: ${resp.status}`);
  return (await resp.json()) as ProjectSummary;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const resp = await fetch(`${BASE}/project/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取项目列表失败"));
  return (await resp.json()) as ProjectSummary[];
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const resp = await fetch(`${BASE}/project/${id}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取项目失败: ${resp.status}`);
  return (await resp.json()) as ProjectDetail;
}

export async function getProjectWarRoom(id: string): Promise<WarRoomPlan> {
  const resp = await fetch(`${BASE}/project/${id}/war-room`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取项目作战室失败: ${resp.status}`);
  return (await resp.json()) as WarRoomPlan;
}

export async function rediagnoseProjectDomain(projectId: string, domainKey: string): Promise<WarRoomPlan> {
  const resp = await fetch(`${BASE}/project/${projectId}/rediagnose-domain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ domain_key: domainKey }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "重新诊断失败"));
  return (await resp.json()) as WarRoomPlan;
}

export async function getTransformationPlan(projectId: string): Promise<TransformationPlan> {
  const resp = await fetch(`${BASE}/project/${projectId}/transformation-plan`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取 AI 改造方案失败: ${resp.status}`);
  return (await resp.json()) as TransformationPlan;
}

export async function generateTransformationPlan(projectId: string): Promise<TransformationPlan> {
  const resp = await fetch(`${BASE}/project/${projectId}/transformation-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "生成 AI 改造方案失败"));
  return (await resp.json()) as TransformationPlan;
}

export async function generateTransformationDomain(projectId: string, module: string): Promise<TransformationPlan> {
  const resp = await fetch(`${BASE}/project/${projectId}/transformation-plan/domain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ module }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "生成改造方案失败"));
  return (await resp.json()) as TransformationPlan;
}

export async function listWarRoomFeedback(projectId: string): Promise<WarRoomFeedbackEvent[]> {
  const resp = await fetch(`${BASE}/project/${projectId}/war-room/feedback`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取阶段反馈失败"));
  return (await resp.json()) as WarRoomFeedbackEvent[];
}

export async function submitWarRoomFeedback(
  projectId: string,
  body: WarRoomFeedbackCreate,
): Promise<WarRoomFeedbackEvent> {
  const resp = await fetch(`${BASE}/project/${projectId}/war-room/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "提交阶段反馈失败"));
  return (await resp.json()) as WarRoomFeedbackEvent;
}

export async function createDataSupplementRequest(
  projectId: string,
  warRoomPlanId: string,
  dataRequest: DataRequest,
): Promise<DataSupplementRequest> {
  const resp = await fetch(`${BASE}/data-supplement/project/${projectId}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      war_room_plan_id: warRoomPlanId,
      data_request: dataRequest,
    }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "生成补资料链接失败"));
  return (await resp.json()) as DataSupplementRequest;
}

export async function listDataSupplementRequests(projectId: string): Promise<DataSupplementRequest[]> {
  const resp = await fetch(`${BASE}/data-supplement/project/${projectId}/requests`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取补资料记录失败"));
  return (await resp.json()) as DataSupplementRequest[];
}

export async function getPublicDataSupplementRequest(token: string): Promise<DataSupplementRequest> {
  const resp = await fetch(`${BASE}/data-supplement/public/${token}`);
  if (!resp.ok) throw new Error(await errorMessage(resp, "补资料链接不存在或已失效"));
  return (await resp.json()) as DataSupplementRequest;
}

export async function submitPublicDataSupplement(
  token: string,
  body: { submitterName?: string; note?: string; files?: File[] },
): Promise<DataSupplementSubmission> {
  const form = new FormData();
  form.append("submitter_name", body.submitterName ?? "");
  form.append("note", body.note ?? "");
  for (const file of body.files ?? []) {
    form.append("files", file);
  }
  const resp = await fetch(`${BASE}/data-supplement/public/${token}/submit`, {
    method: "POST",
    body: form,
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "提交资料失败"));
  return (await resp.json()) as DataSupplementSubmission;
}

export async function deleteDataSupplementFile(
  projectId: string,
  requestId: string,
  submissionId: string,
  fileId: string,
): Promise<DataSupplementRequest> {
  const resp = await fetch(
    `${BASE}/data-supplement/project/${projectId}/requests/${requestId}/submissions/${submissionId}/files/${fileId}`,
    { method: "DELETE", headers: { ...authHeaders() } },
  );
  if (!resp.ok) throw new Error(await errorMessage(resp, "删除补资料文件失败"));
  return (await resp.json()) as DataSupplementRequest;
}

export async function patchProject(
  id: string,
  body: { name?: string; status?: string }
): Promise<ProjectSummary> {
  const resp = await fetch(`${BASE}/project/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`更新项目失败: ${resp.status}`);
  return (await resp.json()) as ProjectSummary;
}

export async function extractArchiveFile(
  projectId: string,
  fileId: string,
): Promise<ArchiveExtractionPreview> {
  const resp = await fetch(`${BASE}/project/${projectId}/archive/files/${fileId}/extract`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "生成沉淀草稿失败"));
  return (await resp.json()) as ArchiveExtractionPreview;
}

export async function confirmArchiveFileExtraction(
  projectId: string,
  fileId: string,
  body: { highlights: { label: string; value: string }[]; summary?: string },
): Promise<ProjectArchive> {
  const resp = await fetch(`${BASE}/project/${projectId}/archive/files/${fileId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "确认沉淀失败"));
  return (await resp.json()) as ProjectArchive;
}

export async function addArchiveModule(
  projectId: string,
  body: { module: string; label?: string },
): Promise<ProjectArchive> {
  const resp = await fetch(`${BASE}/project/${projectId}/archive/modules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "新增经营域失败"));
  return (await resp.json()) as ProjectArchive;
}

export async function hideArchiveModule(
  projectId: string,
  module: string,
): Promise<ProjectArchive> {
  const resp = await fetch(`${BASE}/project/${projectId}/archive/modules/${encodeURIComponent(module)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "隐藏经营域失败"));
  return (await resp.json()) as ProjectArchive;
}

// ── 后台：Skill 管理 ──────────────────────────────────
export async function listActiveSkills(): Promise<SkillVersionOut[]> {
  const resp = await fetch(`${BASE}/admin/skills/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取 skill 失败: ${resp.status}`);
  return (await resp.json()) as SkillVersionOut[];
}

export async function listSkillRegistry(): Promise<SkillRegistryItem[]> {
  const resp = await fetch(`${BASE}/admin/skills/registry`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取 skill 网络失败: ${resp.status}`);
  return (await resp.json()) as SkillRegistryItem[];
}

export async function listSkillVersions(module: string): Promise<SkillVersionOut[]> {
  const resp = await fetch(`${BASE}/admin/skills/${module}/versions`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取版本失败: ${resp.status}`);
  return (await resp.json()) as SkillVersionOut[];
}

export async function addSkillVersion(
  module: string,
  systemPrompt: string,
  changeReason: string,
  options?: { method?: string; skill_type?: string; change_category?: string }
): Promise<SkillVersionOut> {
  const resp = await fetch(`${BASE}/admin/skills/${module}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      system_prompt: systemPrompt,
      change_reason: changeReason,
      method: options?.method,
      skill_type: options?.skill_type,
      change_category: options?.change_category,
      activate: true,
    }),
  });
  if (!resp.ok) throw new Error(`新增版本失败: ${resp.status}`);
  return (await resp.json()) as SkillVersionOut;
}

export async function activateSkillVersion(module: string, versionId: string): Promise<void> {
  const resp = await fetch(`${BASE}/admin/skills/${module}/activate/${versionId}`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(`激活失败: ${resp.status}`);
}

// ── 后台：模型配置 ──────────────────────────────────
export async function listLLMConfigs(): Promise<LLMConfigOut[]> {
  const resp = await fetch(`${BASE}/admin/llm-configs/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取模型配置失败: ${resp.status}`);
  return (await resp.json()) as LLMConfigOut[];
}

export async function createLLMConfig(body: {
  name: string; provider: string; model: string; api_key: string;
  base_url?: string; priority?: number;
}): Promise<LLMConfigOut> {
  const resp = await fetch(`${BASE}/admin/llm-configs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`创建配置失败: ${resp.status}`);
  return (await resp.json()) as LLMConfigOut;
}

export async function patchLLMConfig(
  id: string,
  body: Partial<{ name: string; provider: string; model: string; api_key: string; base_url: string; priority: number; is_active: boolean }>
): Promise<LLMConfigOut> {
  const resp = await fetch(`${BASE}/admin/llm-configs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`更新配置失败: ${resp.status}`);
  return (await resp.json()) as LLMConfigOut;
}

export async function deleteLLMConfig(id: string): Promise<void> {
  const resp = await fetch(`${BASE}/admin/llm-configs/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!resp.ok && resp.status !== 204) throw new Error(`删除失败: ${resp.status}`);
}

export async function probeLLMConfig(id: string): Promise<{ ok: boolean; message: string; config: LLMConfigOut }> {
  const resp = await fetch(`${BASE}/admin/llm-configs/${id}/probe`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    if (body?.detail?.message && body?.detail?.config) {
      return body.detail as { ok: boolean; message: string; config: LLMConfigOut };
    }
    throw new Error(await errorMessage(resp, "测试模型通道失败"));
  }
  return (await resp.json()) as { ok: boolean; message: string; config: LLMConfigOut };
}

// ── 会话文件：选完即时上传，跨设备复用 ──────────────
export async function uploadSessionFile(
  sessionId: string,
  moduleKey: string,
  fieldKey: string,
  file: File
): Promise<UploadedFileOut> {
  const form = new FormData();
  form.append("module_key", moduleKey);
  form.append("field_key", fieldKey);
  form.append("file", file);
  const resp = await fetch(`${BASE}/session/${sessionId}/files`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "上传失败"));
  return (await resp.json()) as UploadedFileOut;
}

export async function listSessionFiles(sessionId: string): Promise<UploadedFileOut[]> {
  const resp = await fetch(`${BASE}/session/${sessionId}/files`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取文件失败: ${resp.status}`);
  return (await resp.json()) as UploadedFileOut[];
}

export async function deleteSessionFile(fileId: string): Promise<void> {
  const resp = await fetch(`${BASE}/files/${fileId}`, { method: "DELETE", headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "删除文件失败"));
}

async function fetchSessionFileBlob(fileId: string, download = false): Promise<Blob> {
  const suffix = download ? "?download=true" : "";
  const resp = await fetch(`${BASE}/files/${fileId}/content${suffix}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, download ? "下载文件失败" : "打开文件失败"));
  return await resp.blob();
}

export async function getSessionFileBlob(fileId: string): Promise<Blob> {
  return await fetchSessionFileBlob(fileId, false);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function viewSessionFile(fileId: string, fileName: string): Promise<void> {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    throw new Error("浏览器阻止了新窗口，请允许弹窗后重试，或先下载原件查看。");
  }
  previewWindow.document.write(`<title>${fileName}</title><p style="font-family: sans-serif; padding: 24px;">正在打开资料...</p>`);
  previewWindow.opener = null;
  const blob = await fetchSessionFileBlob(fileId, false);
  const url = URL.createObjectURL(blob);
  previewWindow.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadSessionFile(fileId: string, fileName: string): Promise<void> {
  const blob = await fetchSessionFileBlob(fileId, true);
  downloadBlob(blob, fileName);
}

// ── 系统健康 API ──────────────────────────────────────────────────────────────
// 后端 /admin/loops/* 采集管线保持运行；前端只读用其中三路（路由/案例/交付）。
// l1（旧 Skill 生产线评测）已从后台界面下线，不再有前端引用。

export async function fetchL2Stats(): Promise<L2Stats> {
  const resp = await fetch(`${BASE}/admin/loops/l2`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`L2 stats failed: ${resp.status}`);
  return resp.json();
}

export async function fetchL3Stats(): Promise<L3Stats> {
  const resp = await fetch(`${BASE}/admin/loops/l3`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`L3 stats failed: ${resp.status}`);
  return resp.json();
}

export async function fetchL4Stats(): Promise<L4Stats> {
  const resp = await fetch(`${BASE}/admin/loops/l4`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`L4 stats failed: ${resp.status}`);
  return resp.json();
}

// ── 当前用户 / 案例库 API ─────────────────────────────────────────────────────

export async function fetchMe(): Promise<MeResponse> {
  const resp = await fetch(`${BASE}/auth/me`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取当前用户失败"));
  return (await resp.json()) as MeResponse;
}

export async function fetchCreditsBalance(): Promise<CreditsBalance> {
  const resp = await fetch(`${BASE}/billing/balance`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取积分余额失败"));
  return (await resp.json()) as CreditsBalance;
}

// ── 图片工具 API ──────────────────────────────────────────────────────────────

export async function uploadImageAsset(file: File): Promise<ImageAssetOut> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${BASE}/image-assets/`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "上传图片素材失败"));
  return (await resp.json()) as ImageAssetOut;
}

export async function listImageAssets(): Promise<ImageAssetOut[]> {
  const resp = await fetch(`${BASE}/image-assets/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取图片素材列表失败"));
  return (await resp.json()) as ImageAssetOut[];
}

export async function deleteImageAsset(assetId: string): Promise<void> {
  const resp = await fetch(`${BASE}/image-assets/${assetId}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "删除图片素材失败"));
}

export async function createImageTask(req: {
  preset_id: string;
  template_id?: string;
  user_intent: string;
  reference_asset_id?: string;
  reference_asset_ids?: string[];
  reference_assets?: Array<{ asset_id: string; role: string }>;
  workspace_mode?: "basic" | "canvas";
  style?: string;
  size?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  background?: string;
  generation_count?: number;
  model_version?: string;
  generation_mode?: "text2image" | "image2image";
  edited_description?: string;
  scene_id?: string;
  conversion_driver?: string;
  product_category?: string;
  market_scope?: string;
  style_variant?: string;
  idempotency_key?: string;
}): Promise<CreateImageTaskResponse> {
  const resp = await fetch(`${BASE}/image-tool/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "创建图片生成任务失败"));
  return (await resp.json()) as CreateImageTaskResponse;
}

export async function getImageAssetUsage(): Promise<ImageAssetUsage> {
  const resp = await fetch(`${BASE}/image-assets/usage`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取素材库用量失败"));
  return (await resp.json()) as ImageAssetUsage;
}

export async function getImageAssetPreviewUrl(assetId: string): Promise<string> {
  const resp = await fetch(`${BASE}/image-assets/${encodeURIComponent(assetId)}/file`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "加载图片缩略图失败"));
  return URL.createObjectURL(await resp.blob());
}

export async function getEcommerceSkillCatalog(): Promise<EcommerceSkillCatalog> {
  const resp = await fetch(BASE + "/image-tool/skill-catalog", {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取电商视觉模板失败"));
  return (await resp.json()) as EcommerceSkillCatalog;
}

export async function getImageTemplateCatalog(): Promise<ImageTemplateCatalog> {
  const resp = await fetch(BASE + "/image-tool/template-catalog", {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取图片模板失败"));
  return (await resp.json()) as ImageTemplateCatalog;
}

export async function getImageModelCapabilities(): Promise<ImageModelCapability[]> {
  const resp = await fetch(`${BASE}/image-tool/capabilities`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取图片模型能力失败"));
  return (await resp.json()) as ImageModelCapability[];
}

export async function confirmImageTask(taskId: string): Promise<ImageTaskStatus> {
  const resp = await fetch(`${BASE}/image-tool/tasks/${taskId}/confirm`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "确认图片生成任务失败"));
  return (await resp.json()) as ImageTaskStatus;
}

export async function getImageTask(taskId: string): Promise<ImageTaskStatus> {
  const resp = await fetch(`${BASE}/image-tool/tasks/${taskId}`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取图片生成任务失败"));
  return (await resp.json()) as ImageTaskStatus;
}

export async function listImageTasks(limit = 50): Promise<ImageTaskStatus[]> {
  const resp = await fetch(`${BASE}/image-tool/tasks?limit=${limit}`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取图片任务列表失败"));
  return (await resp.json()) as ImageTaskStatus[];
}

export async function saveCanvasScene(req: {
  task_id?: string | null;
  name?: string;
  scene: CanvasScene;
}): Promise<CanvasSceneResponse> {
  const resp = await fetch(`${BASE}/image-tool/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "保存画布失败"));
  return (await resp.json()) as CanvasSceneResponse;
}

export async function getLatestCanvasScene(taskId: string): Promise<CanvasSceneResponse> {
  const resp = await fetch(
    `${BASE}/image-tool/scenes/latest?task_id=${encodeURIComponent(taskId)}`,
    { headers: { ...authHeaders() } },
  );
  if (!resp.ok) throw new Error(await errorMessage(resp, "加载最近画布版本失败"));
  return (await resp.json()) as CanvasSceneResponse;
}

export async function exportCanvasProject(sceneId: string): Promise<{
  schema_version: string;
  exported_at: string;
  name: string;
  task_id: string | null;
  scene: CanvasScene;
}> {
  const resp = await fetch(`${BASE}/image-tool/projects/${encodeURIComponent(sceneId)}`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "导出画布项目失败"));
  return (await resp.json()) as {
    schema_version: string;
    exported_at: string;
    name: string;
    task_id: string | null;
    scene: CanvasScene;
  };
}

export async function importCanvasProject(req: {
  schema_version?: string;
  name?: string;
  task_id?: string | null;
  scene: CanvasScene;
}): Promise<CanvasSceneResponse> {
  const resp = await fetch(`${BASE}/image-tool/projects/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ schema_version: "image-workbench.project.v1", ...req }),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "导入画布项目失败"));
  return (await resp.json()) as CanvasSceneResponse;
}

export async function executeCanvasNode(req: {
  node_id: string;
  operation: "reverse_prompt" | "generate" | "edit" | "copy";
  scene: CanvasScene;
  scene_id?: string | null;
  task_id?: string | null;
  input_asset_ids?: string[];
  input?: Record<string, unknown>;
}): Promise<CanvasExecutionResponse> {
  const resp = await fetch(`${BASE}/image-tool/executions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "执行画布节点失败"));
  return (await resp.json()) as CanvasExecutionResponse;
}

export async function fetchCaseProjects(
  filters: CaseProjectFilters = {}
): Promise<ProjectLedgerPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const resp = await fetch(`${BASE}/admin/cases/projects${qs ? `?${qs}` : ""}`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "案例库加载失败"));
  return (await resp.json()) as ProjectLedgerPage;
}

export async function fetchCaseProductGroups(
  filters: CaseProjectFilters = {}
): Promise<CaseProductGroups> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const resp = await fetch(`${BASE}/admin/cases/product-groups${qs ? `?${qs}` : ""}`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "案例库加载失败"));
  return (await resp.json()) as CaseProductGroups;
}

export async function fetchCaseProjectDetail(projectId: string): Promise<CaseProjectDetail> {
  const resp = await fetch(`${BASE}/admin/cases/projects/${projectId}`, {
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(await errorMessage(resp, "案例详情加载失败"));
  return (await resp.json()) as CaseProjectDetail;
}

export async function fetchCaseInsights(): Promise<CaseInsights> {
  const resp = await fetch(`${BASE}/admin/cases/insights`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "案例洞察加载失败"));
  return (await resp.json()) as CaseInsights;
}

// ── 顾问审核 API ──────────────────────────────────────────────────────────────

export async function fetchReviewQueue(): Promise<ReviewQueueItem[]> {
  const resp = await fetch(`${BASE}/admin/review/queue`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`审核队列加载失败: ${resp.status}`);
  return resp.json();
}

export async function fetchReviewDetail(recordId: string): Promise<ReviewDetail> {
  const resp = await fetch(`${BASE}/admin/review/${recordId}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`审核详情加载失败: ${resp.status}`);
  return resp.json();
}

export async function submitReview(
  recordId: string,
  body: { action: "approve" | "reject" | "annotate"; notes?: string[]; reviewer?: string },
): Promise<ReviewDetail> {
  const resp = await fetch(`${BASE}/admin/review/${recordId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`提交审核失败: ${resp.status}`);
  return resp.json();
}
