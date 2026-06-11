import type { ModuleAnswer, ModuleResult } from "../types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export async function runDiagnose(answers: ModuleAnswer[]): Promise<ModuleResult[]> {
  const resp = await fetch(`${BASE}/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const resp = await fetch(`${BASE}/diagnose/upload`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`diagnose failed: ${resp.status}`);
  const body = await resp.json();
  return body.results as ModuleResult[];
}
