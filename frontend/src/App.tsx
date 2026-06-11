import { useState } from "react";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { runDiagnose } from "./api/client";
import type { ModuleResult, ModuleAnswer } from "./types";

export default function App() {
  const [results, setResults] = useState<ModuleResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (answers: ModuleAnswer[]) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await runDiagnose(answers));
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", margin: 0 }}>AI 企业诊断</h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 6 }}>勾选问题，获得结论先行的分模块诊断。</p>
      </header>
      {loading && <p style={{ color: "var(--ink-soft)" }}>诊断进行中…</p>}
      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}
      {results ? <Dashboard results={results} /> : !loading && <Questionnaire onSubmit={handleSubmit} />}
    </div>
  );
}
