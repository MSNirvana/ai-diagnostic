import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchRecord } from "../../api/client";
import { Dashboard } from "../Dashboard/Dashboard";
import type { DiagnosisDetail } from "../../types";

export function RecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DiagnosisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchRecord(id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--accent)",
          cursor: "pointer",
          fontSize: "0.9rem",
          padding: 0,
          marginBottom: 16,
        }}
      >
        ← 返回
      </button>

      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}
      {!detail && !error && <p style={{ color: "var(--ink-soft)" }}>加载中…</p>}

      {detail && (
        <>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "1.8rem", margin: "0 0 8px" }}>
            诊断结果
          </h1>
          <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>
            诊断时间：{fmt(detail.created_at)}
          </p>
          <Dashboard results={detail.results} />
        </>
      )}
    </div>
  );
}
