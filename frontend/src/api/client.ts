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
