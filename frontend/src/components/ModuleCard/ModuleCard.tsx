import { useState } from "react";
import type { ModuleResult } from "../../types";
import { DrillDown } from "../DrillDown/DrillDown";
import { submitFeedback } from "../../api/client";
import "./ModuleCard.css";

const SIGNAL_LABEL: Record<string, string> = { red: "需关注", yellow: "观察", green: "健康" };

type FeedbackState = "idle" | "thumbup" | "thumbdown" | "submitted";

interface ModuleCardProps {
  result: ModuleResult;
  recordId?: string;
  skillVersionId?: string;
}

export function ModuleCard({ result, recordId, skillVersionId }: ModuleCardProps) {
  const [open, setOpen] = useState(false);
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");
  const [comment, setComment] = useState("");

  const showFeedback = Boolean(recordId && skillVersionId);
  const evidencePackage = result.evidence_package;

  const handleSubmitFeedback = async () => {
    if (!recordId || !skillVersionId) return;
    const isUseful = feedbackState === "thumbup";
    const rating = isUseful ? 5 : 2;
    await submitFeedback(recordId, result.module, skillVersionId, rating, isUseful, comment || undefined);
    setFeedbackState("submitted");
  };

  return (
    <div className="module-card">
      <div className={`signal signal--${result.signal}`}>
        <span className="signal__dot" />
        <span className="signal__label">{SIGNAL_LABEL[result.signal]}</span>
        <span className="module-card__name">{result.module}</span>
      </div>
      <p className="module-card__conclusion">{result.conclusion}</p>
      <ul className="module-card__evidence">
        {result.evidence.map((e, i) => <li key={i}>{e.text}</li>)}
      </ul>
      <div className="module-card__actions">
        <span className="module-card__actions-label">建议</span>
        <ul>{result.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </div>
      {(result.drilldown || evidencePackage) && (
        <>
          <button type="button" className="more-btn" onClick={() => setOpen(!open)}>
            {open ? "收起" : "查看更多"}
          </button>
          {open && result.drilldown && <DrillDown data={result.drilldown} />}
          {open && evidencePackage && (
            <div className="evidence-pack">
              <div className="evidence-pack__head">
                <h4>可信证据包</h4>
                <span>置信度：{Math.round(evidencePackage.confidence * 100)}%</span>
              </div>
              <p className="evidence-pack__reason">{evidencePackage.confidence_reason}</p>

              {evidencePackage.citations.length > 0 && (
                <>
                  <h5>引用来源</h5>
                  <ul>
                    {evidencePackage.citations.map((citation, index) => (
                      <li key={`${citation.source}-${index}`}>
                        {citation.text}（{citation.source}）
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {evidencePackage.benchmarks.length > 0 && (
                <>
                  <h5>外部基准</h5>
                  <ul>
                    {evidencePackage.benchmarks.map((benchmark) => (
                      <li key={`${benchmark.name}-${benchmark.source}`}>
                        {benchmark.name}：{benchmark.value}（{benchmark.source}）
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h5>审计轨迹</h5>
              <p className="evidence-pack__audit">
                skill {evidencePackage.audit_trail.skill_version_id}
                {evidencePackage.audit_trail.input_modules.length > 0
                  ? ` · 输入模块：${evidencePackage.audit_trail.input_modules.join("、")}`
                  : ""}
              </p>
              {evidencePackage.audit_trail.checks.length > 0 && (
                <ul>
                  {evidencePackage.audit_trail.checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {showFeedback && (
        <div className="module-card__feedback">
          {feedbackState === "submitted" ? (
            <span className="module-card__feedback-thanks">已收到反馈，谢谢</span>
          ) : (
            <>
              <div className="module-card__feedback-row">
                <span className="module-card__feedback-q">这个诊断对你有帮助吗？</span>
                <button
                  type="button"
                  className={`fb-btn${feedbackState === "thumbup" ? " fb-btn--active" : ""}`}
                  onClick={() => setFeedbackState("thumbup")}
                >
                  👍 有帮助
                </button>
                <button
                  type="button"
                  className={`fb-btn${feedbackState === "thumbdown" ? " fb-btn--active" : ""}`}
                  onClick={() => setFeedbackState("thumbdown")}
                >
                  👎 待改进
                </button>
              </div>
              {(feedbackState === "thumbup" || feedbackState === "thumbdown") && (
                <div className="module-card__feedback-detail">
                  <input
                    type="text"
                    className="module-card__feedback-input"
                    placeholder="补充一句具体意见（可选）"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <button type="button" className="fb-submit" onClick={handleSubmitFeedback}>
                    提交
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
