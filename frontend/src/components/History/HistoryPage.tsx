import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHistory, fetchRecord } from "../../api/client";
import { Dashboard } from "../Dashboard/Dashboard";
import type { DiagnosisSummary, DiagnosisDetail } from "../../types";
import "./HistoryPage.css";

export function HistoryPage() {
  const [list, setList] = useState<DiagnosisSummary[] | null>(null);
  const [detail, setDetail] = useState<DiagnosisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory()
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, []);

  const openDetail = async (id: string) => {
    setError(null);
    try {
      setDetail(await fetchRecord(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px" }}>
      <header
        style={{
          marginBottom: 28,
          borderBottom: "1px solid var(--line)",
          paddingBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", margin: 0 }}>
          诊断历史
        </h1>
        <Link to="/" style={{ color: "var(--accent)", textDecoration: "none" }}>
          ← 返回诊断
        </Link>
      </header>

      {error && <p style={{ color: "var(--signal-red)" }}>{error}</p>}

      {detail ? (
        <>
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="history-back-btn"
          >
            ← 返回列表
          </button>
          <p style={{ color: "var(--ink-soft)", margin: "8px 0 20px" }}>
            诊断时间：{fmt(detail.created_at)}
          </p>
          <Dashboard results={detail.results} />
        </>
      ) : (
        <div className="history-list">
          {list === null && !error && (
            <p style={{ color: "var(--ink-soft)" }}>加载中…</p>
          )}
          {list && list.length === 0 && (
            <p style={{ color: "var(--ink-soft)" }}>
              还没有诊断记录。<Link to="/" style={{ color: "var(--accent)" }}>去做一次诊断</Link>
            </p>
          )}
          {list?.map((item) => (
            <button
              key={item.id}
              type="button"
              className="history-item"
              onClick={() => openDetail(item.id)}
            >
              <span className="history-item__date">{fmt(item.created_at)}</span>
              <span className="history-item__count">{item.module_count} 个模块</span>
              <span className="history-item__arrow">查看 →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
