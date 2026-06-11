import { useState } from "react";
import { Questionnaire } from "./components/Questionnaire/Questionnaire";
import { Dashboard } from "./components/Dashboard/Dashboard";
import { runDiagnose, runDiagnoseWithFiles } from "./api/client";
import type { ModuleResult, ModuleAnswer } from "./types";

export default function App() {
  const [results, setResults] = useState<ModuleResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    answers: ModuleAnswer[],
    files: { moduleKey: string; file: File }[]
  ) => {
    setLoading(true);
    setError(null);
    try {
      // 有文件走 multipart 上传端点，无文件走更轻的 JSON 端点
      const data = files.length
        ? await runDiagnoseWithFiles(answers, files)
        : await runDiagnose(answers);
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setResults(null);
    setError(null);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ marginBottom: 32, borderBottom: "1px solid var(--line)", paddingBottom: 20 }}>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "2.2rem", margin: 0, letterSpacing: "0.02em" }}>
          AI 企业诊断
        </h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 8, fontSize: "1.02rem" }}>
          结构化提交企业现状，获得结论先行、数据支撑的分模块诊断。
        </p>
      </header>

      {loading && <p style={{ color: "var(--ink-soft)" }}>诊断进行中，正在调取数据与分析…</p>}
      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}

      {results ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button
              type="button"
              onClick={restart}
              style={{
                background: "transparent",
                border: "1px solid var(--accent)",
                color: "var(--accent)",
                padding: "8px 18px",
                borderRadius: "var(--radius)",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              重新诊断
            </button>
          </div>
          <Dashboard results={results} />
        </>
      ) : (
        !loading && <Questionnaire onSubmit={handleSubmit} />
      )}
    </div>
  );
}
