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
      {result.drilldown && (
        <>
          <button type="button" className="more-btn" onClick={() => setOpen(!open)}>
            {open ? "收起" : "查看更多"}
          </button>
          {open && <DrillDown data={result.drilldown} />}
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
