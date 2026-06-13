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
  ProblemSummary,
  SessionSummary,
  SessionDetail,
  ProjectSummary,
  ProjectDetail,
  SkillVersionOut,
  LLMConfigOut,
} from "../types";
import { getToken } from "../auth/authStore";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function runDiagnose(
  answers: ModuleAnswer[],
  sessionId?: string,
  projectId?: string
): Promise<DiagnoseResult> {
  const resp = await fetch(`${BASE}/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ answers, session_id: sessionId, project_id: projectId }),
  });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body as DiagnoseResult;
}

export async function runDiagnoseWithFiles(
  answers: ModuleAnswer[],
  files: { moduleKey: string; fieldKey: string; file: File }[],
  sessionId?: string,
  projectId?: string
): Promise<DiagnoseResult> {
  const form = new FormData();
  form.append(
    "answers_json",
    JSON.stringify({ answers, session_id: sessionId, project_id: projectId })
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
  profile: BusinessProfile
): Promise<GeneratedModule[]> {
  const resp = await fetch(`${BASE}/questionnaire/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ profile }),
  });
  if (!resp.ok) throw new Error(`生成失败: ${resp.status}`);
  const body = await resp.json();
  return body.modules as GeneratedModule[];
}

export async function generateABQuestionnaire(
  profile: BusinessProfile
): Promise<ABQuestionnaire> {
  const resp = await fetch(`${BASE}/questionnaire/generate-ab`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ profile }),
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

export async function generateABFromSummary(
  summary: ProblemSummary
): Promise<ABQuestionnaire> {
  const resp = await fetch(`${BASE}/questionnaire/generate-ab`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ summary }),
  });
  if (!resp.ok) throw new Error(`生成失败: ${resp.status}`);
  return (await resp.json()) as ABQuestionnaire;
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

export async function startSession(projectId?: string): Promise<string> {
  const resp = await fetch(`${BASE}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ project_id: projectId ?? null }),
  });
  if (!resp.ok) throw new Error(`创建会话失败: ${resp.status}`);
  return (await resp.json()).session_id as string;
}

export async function sessionChat(
  sessionId: string,
  message: string
): Promise<ChatTurnResponse> {
  const resp = await fetch(`${BASE}/session/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) throw new Error(`对话失败: ${resp.status}`);
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
  if (!resp.ok) throw new Error(`获取项目列表失败: ${resp.status}`);
  return (await resp.json()) as ProjectSummary[];
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const resp = await fetch(`${BASE}/project/${id}`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取项目失败: ${resp.status}`);
  return (await resp.json()) as ProjectDetail;
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

// ── 后台：Skill 管理 ──────────────────────────────────
export async function listActiveSkills(): Promise<SkillVersionOut[]> {
  const resp = await fetch(`${BASE}/admin/skills/`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取 skill 失败: ${resp.status}`);
  return (await resp.json()) as SkillVersionOut[];
}

export async function listSkillVersions(module: string): Promise<SkillVersionOut[]> {
  const resp = await fetch(`${BASE}/admin/skills/${module}/versions`, { headers: { ...authHeaders() } });
  if (!resp.ok) throw new Error(`获取版本失败: ${resp.status}`);
  return (await resp.json()) as SkillVersionOut[];
}

export async function addSkillVersion(
  module: string,
  systemPrompt: string,
  changeReason: string
): Promise<SkillVersionOut> {
  const resp = await fetch(`${BASE}/admin/skills/${module}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ system_prompt: systemPrompt, change_reason: changeReason, activate: true }),
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
