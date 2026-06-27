import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicDataSupplementRequest, submitPublicDataSupplement } from "../../api/client";
import type { DataSupplementRequest } from "../../types";
import "./PublicSupplementPage.css";

export function PublicSupplementPage() {
  const { token } = useParams<{ token: string }>();
  const [request, setRequest] = useState<DataSupplementRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitterName, setSubmitterName] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token) return;
    getPublicDataSupplementRequest(token)
      .then((next) => {
        setRequest(next);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "补资料链接加载失败"))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitPublicDataSupplement(token, { submitterName, note, files });
      const refreshed = await getPublicDataSupplementRequest(token);
      setRequest(refreshed);
      setNote("");
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setNotice("已提交，项目负责人可以在作战室里看到这次补充。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交资料失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="public-supplement"><p className="public-supplement__state">正在打开补资料页面...</p></main>;
  }

  if (!request || error?.includes("不存在")) {
    return (
      <main className="public-supplement">
        <section className="public-supplement__card public-supplement__empty">
          <span className="public-supplement__brand">
            <img src="/brand-logo.png" alt="" />
            构造视界
          </span>
          <h1>补资料链接不可用</h1>
          <p>{error || "这个链接不存在或已经失效，请联系项目负责人重新发送。"}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-supplement">
      <section className="public-supplement__hero">
        <span className="public-supplement__brand">
          <img src="/brand-logo.png" alt="" />
          构造视界 · 资料补充
        </span>
        <h1>{request.label}</h1>
        <p>{request.reason || "请补充与这个事项相关的资料或说明。"}</p>
        <div className="public-supplement__meta">
          {request.typical_owner && <strong>通常由 {request.typical_owner} 提供</strong>}
          {request.source_hint && <strong>建议来源：{request.source_hint}</strong>}
        </div>
      </section>

      <section className="public-supplement__grid">
        <form className="public-supplement__card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="public-supplement__section-title">
            <span>提交资料</span>
            <h2>上传文件或填写说明</h2>
          </div>
          <label>
            你的姓名/角色
            <input value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} placeholder="例如：投放负责人、财务负责人" />
          </label>
          <label>
            补充说明
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={6} placeholder="可以说明数据口径、时间范围、异常情况，或先补一部分资料。" />
          </label>
          <label className="public-supplement__upload">
            <span>选择文件</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <em>{files.length > 0 ? `已选择 ${files.length} 个文件` : "支持多次提交，也可以之后再打开链接继续补。"}</em>
          </label>
          {files.length > 0 && (
            <ul className="public-supplement__file-list">
              {files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
            </ul>
          )}
          {notice && <p className="public-supplement__notice">{notice}</p>}
          {error && !error.includes("不存在") && <p className="public-supplement__error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting || (!note.trim() && files.length === 0)}>
            {submitting ? "提交中..." : "提交资料"}
          </button>
        </form>

        <section className="public-supplement__card">
          <div className="public-supplement__section-title">
            <span>提交记录</span>
            <h2>之前补过什么</h2>
          </div>
          {request.submissions.length === 0 ? (
            <p className="public-supplement__muted">还没有提交记录。提交后，这里会保留历史文件和说明。</p>
          ) : (
            <div className="public-supplement__history">
              {request.submissions.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.submitter_name || "未填写姓名"}</strong>
                    <time>{new Date(item.created_at).toLocaleString("zh-CN")}</time>
                  </div>
                  {item.note && <p>{item.note}</p>}
                  {item.files.length > 0 && (
                    <ul>
                      {item.files.map((file) => (
                        <li className={file.is_deleted ? "is-deleted" : ""} key={file.id}>
                          {file.original_name}{file.is_deleted ? "（已删除）" : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
