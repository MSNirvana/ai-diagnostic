import { useState } from "react";
import type { ModuleResult } from "../../types";
import { DrillDown } from "../DrillDown/DrillDown";
import { submitFeedback } from "../../api/client";
import { cleanDisplayText, cleanSentenceText, displayModuleLabel } from "../../utils/displayText";
import "./ModuleCard.css";

const SIGNAL_LABEL: Record<string, string> = { red: "高优先级", yellow: "需跟进", green: "运行稳定" };

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
  const dataRequests = result.data_requests ?? [];
  const evidenceItems = result.evidence ?? [];
  const confidenceValue = evidencePackage?.confidence ?? null;
  const isLowConfidence = typeof confidenceValue === "number" && confidenceValue < 0.5;
  const needsData = dataRequests.length > 0;
  const lacksEvidence = evidenceItems.length === 0 && needsData;
  const confidence = evidencePackage
    ? `${Math.round(evidencePackage.confidence * 100)}%`
    : "待补证据";
  const conclusion = lacksEvidence
    ? "数据不足，需补齐后才能判断。"
    : cleanSentenceText(
        needsData ? `初步判断：${result.conclusion}` : result.conclusion,
        "暂无明确结论。",
      );

  const handleSubmitFeedback = async () => {
    if (!recordId || !skillVersionId) return;
    const isUseful = feedbackState === "thumbup";
    const rating = isUseful ? 5 : 2;
    await submitFeedback(recordId, result.module, skillVersionId, rating, isUseful, comment || undefined);
    setFeedbackState("submitted");
  };

  return (
    <div className="module-card">
      <div className="module-card__header">
        <div>
          <div className={`signal signal--${result.signal}`}>
            <span className="signal__dot" />
            <span className="signal__label">{SIGNAL_LABEL[result.signal]}</span>
          </div>
          <h3 className="module-card__name">{displayModuleLabel(result.module) || result.module}</h3>
        </div>
        <span className={isLowConfidence ? "module-card__confidence module-card__confidence--low" : "module-card__confidence"}>
          证据完整度 {confidence}
          {isLowConfidence && <em>低置信 / 待验证</em>}
        </span>
      </div>
      {lacksEvidence && (
        <div className="module-card__insufficient">
          <strong>数据不足，需补齐后才能判断</strong>
          <span>当前模块还没有可展示依据，以下数据补齐前只应作为待验证假设。</span>
        </div>
      )}
      {!lacksEvidence && needsData && (
        <div className="module-card__preliminary">
          初步判断 · 需补数据后复核
        </div>
      )}
      <p className="module-card__conclusion">{conclusion}</p>
      <div className="module-card__evidence-block">
        <span className="module-card__section-label">关键依据</span>
        {evidenceItems.length > 0 ? (
          <ul className="module-card__evidence">
            {evidenceItems.map((e, i) => (
              <li key={i}>
                {cleanSentenceText(e.text, "暂无可展示依据。")}
                <span className="evidence-source">来源：{cleanDisplayText(e.source, "未注明来源")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="module-card__empty-evidence">暂无可验证依据，需先补齐数据。</p>
        )}
      </div>
      {lacksEvidence && dataRequests.length > 0 && (
        <div className="module-card__missing-data">
          <span className="module-card__section-label">待补数据</span>
          <div className="data-request-list">
            {dataRequests.map((request) => (
              <div className="data-request" key={request.key}>
                <div className="data-request__head">
                  <strong>{request.label}</strong>
                  {request.required && <span>必需</span>}
                </div>
                <p>{cleanSentenceText(request.reason)}</p>
                {request.source_hint && <small>{cleanSentenceText(request.source_hint)}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="module-card__actions">
        <span className="module-card__section-label">建议动作</span>
        <ul>{result.actions.map((a, i) => <li key={i}>{cleanSentenceText(a, "待明确动作。")}</li>)}</ul>
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
                <span>证据完整度：{Math.round(evidencePackage.confidence * 100)}%</span>
              </div>
              <p className="evidence-pack__reason">{cleanSentenceText(evidencePackage.confidence_reason)}</p>

              {evidencePackage.citations.length > 0 && (
                <>
                  <h5>引用来源</h5>
                  <ul>
                    {evidencePackage.citations.map((citation, index) => (
                      <li key={`${citation.source}-${index}`}>
                        {cleanSentenceText(citation.text)}（{cleanDisplayText(citation.source, "未注明来源")}）
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
                        {cleanDisplayText(benchmark.name, "外部基准")}：{cleanDisplayText(benchmark.value)}（{cleanDisplayText(benchmark.source, "未注明来源")}）
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {dataRequests.length > 0 && (
                <>
                  <h5>待补数据</h5>
                  <div className="data-request-list">
                    {dataRequests.map((request) => (
                      <div className="data-request" key={request.key}>
                        <div className="data-request__head">
                          <strong>{request.label}</strong>
                          {request.required && <span>必需</span>}
                        </div>
                        <p>{cleanSentenceText(request.reason)}</p>
                        {request.source_hint && (
                          <small>{cleanSentenceText(request.source_hint)}</small>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h5>审计轨迹</h5>
              <p className="evidence-pack__audit">
                方法版本 {evidencePackage.audit_trail.skill_version_id}
                {evidencePackage.audit_trail.input_modules.length > 0
                  ? ` · 输入模块：${evidencePackage.audit_trail.input_modules.join("、")}`
                  : ""}
              </p>
              {evidencePackage.audit_trail.checks.length > 0 && (
                <ul>
                  {evidencePackage.audit_trail.checks.map((check) => (
                    <li key={check}>{cleanSentenceText(check)}</li>
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
                  有帮助
                </button>
                <button
                  type="button"
                  className={`fb-btn${feedbackState === "thumbdown" ? " fb-btn--active" : ""}`}
                  onClick={() => setFeedbackState("thumbdown")}
                >
                  待改进
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
