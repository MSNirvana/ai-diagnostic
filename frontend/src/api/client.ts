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
  ProblemSummary,
} from "../types";
import { getToken } from "../auth/authStore";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function runDiagnose(answers: ModuleAnswer[]): Promise<DiagnoseResult> {
  const resp = await fetch(`${BASE}/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ answers }),
  });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body as DiagnoseResult;
}

export async function runDiagnoseWithFiles(
  answers: ModuleAnswer[],
  files: { moduleKey: string; fieldKey: string; file: File }[]
): Promise<DiagnoseResult> {
  const form = new FormData();
  form.append("answers_json", JSON.stringify({ answers }));
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
