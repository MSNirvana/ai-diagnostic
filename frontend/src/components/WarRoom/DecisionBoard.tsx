import { useState } from "react";
import type {
  DecisionItem,
  WarRoomFeedbackAdoptionStatus,
  WarRoomFeedbackCreate,
  WarRoomFeedbackEvent,
  WarRoomFeedbackResult,
} from "../../types";
import { cleanDisplayText, cleanSentenceText } from "../../utils/displayText";
import { priorityClass, URGENCY_LABELS } from "./warRoomViewModel";

interface DecisionBoardProps {
  items: DecisionItem[];
  planId?: string;
  recordId?: string | null;
  feedbackEvents?: WarRoomFeedbackEvent[];
  onSubmitFeedback?: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
}

function decisionTitle(title: string): string {
  return cleanDisplayText(title.replace(/^拍板[:：]\s*/, "").trim(), "待确认事项");
}

function decisionPrompt(item: DecisionItem): string {
  const action = decisionTitle(item.title);
  let prompt = item.detail.trim();
  if (action) {
    prompt = prompt.replace(action, "该事项");
  }
  return cleanSentenceText(prompt.replace(/「该事项」/g, "该事项").replace(/\s+/g, " "));
}

function compactDialogTitle(value: string): string {
  return cleanDisplayText(value, "待确认事项").replace(/\s+/g, " ").trim();
}

const ADOPTION_OPTIONS: Array<{ value: WarRoomFeedbackAdoptionStatus; label: string }> = [
  { value: "adopted", label: "已采纳" },
  { value: "deferred", label: "暂缓" },
  { value: "rejected", label: "不采纳" },
];

const RESULT_OPTIONS: Array<{ value: WarRoomFeedbackResult; label: string }> = [
  { value: "effective", label: "有效" },
  { value: "no_change", label: "无明显变化" },
  { value: "new_issue", label: "有新问题" },
  { value: "insufficient_data", label: "数据不足" },
];

const ADOPTION_LABEL: Record<string, string> = {
  pending: "待确认",
  adopted: "已采纳",
  deferred: "暂缓",
  rejected: "不采纳",
};

const RESULT_LABEL: Record<string, string> = {
  none: "暂未反馈效果",
  effective: "有效",
  no_change: "无明显变化",
  new_issue: "有新问题",
  insufficient_data: "数据不足",
};

export function decisionCardId(item: DecisionItem, index: number): string {
  return `decision:${index}:${decisionTitle(item.title)}`;
}

export function DecisionBoard({
  items,
  planId,
  recordId,
  feedbackEvents = [],
  onSubmitFeedback,
}: DecisionBoardProps) {
  const [editing, setEditing] = useState<{
    item: DecisionItem;
    index: number;
    cardId: string;
    title: string;
  } | null>(null);
  const urgentCount = items.filter((item) => item.urgency === "now").length;
  const displayCount = urgentCount || items.length;
  const latestByCard = latestFeedbackByCard(feedbackEvents);

  return (
    <section className="war-panel war-panel--decision">
      <div className="war-panel__heading">
        <div>
          <span>决策板</span>
          <h3>先拍板的事项</h3>
        </div>
        <strong className="war-panel__count">{displayCount} 项</strong>
      </div>
      <div className="decision-list">
        {items.map((item, index) => {
          const cardId = decisionCardId(item, index);
          const title = decisionTitle(item.title);
          const feedback = latestByCard.get(cardId);
          return (
            <article
              className={index === 0 ? "decision-card decision-card--lead" : "decision-card"}
              key={`${item.urgency}-${item.title}`}
            >
              <div className="decision-card__main">
                <div className="decision-card__topline">
                  <span className={priorityClass(item.urgency)}>{URGENCY_LABELS[item.urgency]}</span>
                  <FeedbackBadge event={feedback} />
                </div>
                <h4 title={item.title}>{title}</h4>
                <p className="decision-card__brief">{decisionPrompt(item)}</p>
                {feedback && (
                  <p className="decision-card__feedback-note">
                    最新反馈：{RESULT_LABEL[feedback.feedback_result] ?? feedback.feedback_result}
                    {feedback.note ? `，${cleanSentenceText(feedback.note)}` : ""}
                  </p>
                )}
              </div>
              {planId && onSubmitFeedback && (
                <button
                  type="button"
                  className="decision-card__feedback-action"
                  onClick={() => setEditing({ item, index, cardId, title })}
                >
                  反馈进展
                </button>
              )}
            </article>
          );
        })}
      </div>
      {editing && planId && onSubmitFeedback && (
        <DecisionFeedbackDialog
          cardTitle={editing.title}
          planId={planId}
          recordId={recordId}
          cardId={editing.cardId}
          onClose={() => setEditing(null)}
          onSubmit={onSubmitFeedback}
        />
      )}
    </section>
  );
}

function latestFeedbackByCard(events: WarRoomFeedbackEvent[]): Map<string, WarRoomFeedbackEvent> {
  const map = new Map<string, WarRoomFeedbackEvent>();
  [...events]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .forEach((event) => {
      if (!map.has(event.card_id)) {
        map.set(event.card_id, event);
      }
    });
  return map;
}

function FeedbackBadge({ event }: { event?: WarRoomFeedbackEvent }) {
  if (!event) {
    return <span className="decision-feedback-badge decision-feedback-badge--pending">待确认</span>;
  }
  const label = ADOPTION_LABEL[event.adoption_status] ?? "有反馈";
  return (
    <span className={`decision-feedback-badge decision-feedback-badge--${event.adoption_status}`}>
      {label}
    </span>
  );
}

function DecisionFeedbackDialog({
  cardTitle,
  planId,
  recordId,
  cardId,
  onClose,
  onSubmit,
}: {
  cardTitle: string;
  planId: string;
  recordId?: string | null;
  cardId: string;
  onClose: () => void;
  onSubmit: (body: WarRoomFeedbackCreate) => Promise<WarRoomFeedbackEvent>;
}) {
  const [adoption, setAdoption] = useState<WarRoomFeedbackAdoptionStatus>("adopted");
  const [result, setResult] = useState<WarRoomFeedbackResult>("effective");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        war_room_plan_id: planId,
        record_id: recordId,
        card_type: "decision",
        card_id: cardId,
        card_title: cardTitle,
        adoption_status: adoption,
        feedback_result: result,
        owner,
        note,
        attachments: [],
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "阶段反馈提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="decision-feedback-dialog" role="dialog" aria-modal="true" aria-label="阶段反馈">
      <div className="decision-feedback-dialog__card">
        <div className="decision-feedback-dialog__head">
          <div>
            <span>阶段反馈</span>
            <h4>记录推进后的真实变化</h4>
            <p>用于更新项目档案和下一轮复诊，不是任务考核。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭阶段反馈">x</button>
        </div>
        <section className="decision-feedback-dialog__target" title={cardTitle}>
          <span>拍板事项</span>
          <p>{compactDialogTitle(cardTitle)}</p>
        </section>
        <div className="decision-feedback-dialog__body">
          <div className="decision-feedback-dialog__choice-grid">
            <fieldset className="decision-feedback-dialog__section">
              <legend>采纳情况</legend>
              <div className="decision-feedback-dialog__options">
                {ADOPTION_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={adoption === option.value ? "is-active" : ""}
                    onClick={() => setAdoption(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="decision-feedback-dialog__section">
              <legend>阶段结果</legend>
              <div className="decision-feedback-dialog__options">
                {RESULT_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={result === option.value ? "is-active" : ""}
                    onClick={() => setResult(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="decision-feedback-dialog__section decision-feedback-dialog__section--form">
            <label>
              反馈人/负责人
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="例如：销售负责人、老板本人" />
            </label>
            <label>
              现场说明
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="写清楚实际推进后的变化、新问题或需要系统下次重判的点。"
                rows={4}
              />
            </label>
          </div>
          {error && <p className="decision-feedback-dialog__error">{error}</p>}
        </div>
        <div className="decision-feedback-dialog__actions">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "提交中…" : "沉淀到项目档案"}
          </button>
        </div>
      </div>
    </div>
  );
}
