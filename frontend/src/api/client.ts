import type {
  ModuleAnswer,
  DiagnoseResult,
  DiagnosisSummary,
  DiagnosisDetail,
  BusinessProfile,
  GeneratedModule,
  GeneratedQuestionnaire,
  ABQuestionnaire,
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
  SkillRegistryItem,
  SkillVersionOut,
  LLMConfigOut,
  UploadedFileOut,
  L1Stats,
  L2Stats,
  L3Stats,
  L4Stats,
  ReviewQueueItem,
  ReviewDetail,
  DiagnosisJobCreated,
  DiagnosisJobStatus,
  ResearchEvidenceOut,
  ArchiveExtractionPreview,
} from "../types";
import { clearToken, getToken } from "../auth/authStore";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

export async function getDiagnosisJob(jobId: string): Promise<DiagnosisJobStatus> {
  const resp = await fetch(`${BASE}/diagnosis-jobs/${jobId}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(await errorMessage(resp, "获取深度尽调任务失败"));
  return (await resp.json()) as DiagnosisJobStatus;
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

export async function register(email: string, password: string): Promise<string> {
  const resp = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error(detail.detail || `注册失败: ${resp.status}`);
  }
  return (await resp.json()).access_token as string;
}

export async function login(email: string, password: string): Promise<string> {
  const resp = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({}));
    throw new Error(detail.detail || `登录失败: ${resp.status}`);
  }
  return (await resp.json()).access_token as string;
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

export async function generateABQuestionnaire(
  profile: BusinessProfile,
  projectId?: string
): Promise<ABQuestionnaire> {
  const resp = await fetch(`${BASE}/questionnaire/generate-ab`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ profile, project_id: projectId ?? null }),
  });
  if (!resp.ok) throw new Error(`生成失败: ${resp.status}`);
  return (await resp.json()) as ABQuestionnaire;
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

export async function generateABFromSummary(
  summary: ProblemSummary,
  projectId?: string,
  problemMap?: ProblemMap,
): Promise<ABQuestionnaire> {
  const resp = await fetch(`${BASE}/questionnaire/generate-ab`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      summary,
      problem_map: problemMap ?? null,
      project_id: projectId ?? null,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`生成失败: ${resp.status} ${detail}`.trim());
  }
  return (await resp.json()) as ABQuestionnaire;
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

export async function recordPreference(
  profile: BusinessProfile,
  optionA: GeneratedQuestionnaire,
  optionB: GeneratedQuestionnaire,
  chosen: "a" | "b"
): Promise<void> {
  await fetch(`${BASE}/questionnaire/preference`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      profile,
      option_a: optionA,
      option_b: optionB,
      chosen,
    }),
  });
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

// ── Loop 治理 API ─────────────────────────────────────────────────────────────

export async function fetchL1Stats(): Promise<L1Stats> {
  const resp = await fetch(`${BASE}/admin/loops/l1`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`L1 stats failed: ${resp.status}`);
  return resp.json();
}

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
