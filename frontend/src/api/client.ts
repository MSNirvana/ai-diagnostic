import type { ModuleAnswer, ModuleResult } from "../types";
import { getToken } from "../auth/authStore";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function runDiagnose(answers: ModuleAnswer[]): Promise<ModuleResult[]> {
  const resp = await fetch(`${BASE}/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ answers }),
  });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body.results as ModuleResult[];
}

export async function runDiagnoseWithFiles(
  answers: ModuleAnswer[],
  files: { moduleKey: string; file: File }[]
): Promise<ModuleResult[]> {
  const form = new FormData();
  form.append("answers_json", JSON.stringify({ answers }));
  for (const { moduleKey, file } of files) {
    const renamed = new File([file], `${moduleKey}_${file.name}`, { type: file.type });
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
  return body.results as ModuleResult[];
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
