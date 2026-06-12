import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ProblemMap } from "../../types";
import { startSession, sessionChat } from "../../api/client";
import "./ChatStep.css";

const OPENING =
  "你好，我是你的诊断顾问。先告诉我，当前最让你头疼的一个问题是什么？";

const FOCUS_LABELS: Record<string, string> = {
  market: "市场与客户",
  sales: "营销与销售",
  product: "产品与服务",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
};

const focusLabel = (key: string): string => FOCUS_LABELS[key] ?? key;

type Phase = "intake" | "confirm" | "done";

interface ChatStepProps {
  onComplete: (problemMap: ProblemMap, sessionId: string) => void;
  resumeSessionId?: string;
  resumeMessages?: ChatMessage[];
}

export function ChatStep({
  onComplete,
  resumeSessionId,
  resumeMessages,
}: ChatStepProps) {
  const [sessionId, setSessionId] = useState<string | null>(
    resumeSessionId ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    resumeMessages && resumeMessages.length > 0
      ? resumeMessages
      : [{ role: "assistant", content: OPENING }]
  );
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intake");
  const [problemMap, setProblemMap] = useState<ProblemMap | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // 挂载时：续聊用已有 session，否则创建新 session
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (resumeSessionId) {
      setSessionId(resumeSessionId);
      return;
    }
    startSession()
      .then((id) => setSessionId(id))
      .catch(() => setError("无法开始会话，请刷新重试。"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, phase, problemMap]);

  const send = async () => {
    const text = draft.trim();
    if (!text || loading || !sessionId) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setError(null);
    setLoading(true);
    try {
      const resp = await sessionChat(sessionId, text);
      setMessages([...next, { role: "assistant", content: resp.message }]);
      setPhase(resp.phase);
      if (resp.problem_map) setProblemMap(resp.problem_map);
      if (resp.phase === "done" && resp.problem_map) {
        onComplete(resp.problem_map, sessionId);
      }
    } catch {
      setError("对话出了点问题，请重试。");
      setMessages(messages);
      setDraft(text);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const inputPlaceholder =
    phase === "confirm"
      ? "还有要补充或纠正的吗？直接说…"
      : "描述一下你遇到的问题…（Enter 发送，Shift+Enter 换行）";

  return (
    <div className="chat-step">
      <header className="chat-step__head">
        <h1 className="chat-step__title">先聊聊你的问题</h1>
        <p className="chat-step__subtitle">
          像跟顾问对话一样，我会一次问一个，帮你理清核心问题，再生成诊断方案。
        </p>
      </header>

      <div className="chat-stream" ref={scrollRef}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user" ? "chat-row chat-row--user" : "chat-row chat-row--ai"
            }
          >
            <div
              className={
                m.role === "user" ? "chat-bubble chat-bubble--user" : "chat-bubble chat-bubble--ai"
              }
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-row chat-row--ai">
            <div className="chat-bubble chat-bubble--ai chat-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {phase === "confirm" && problemMap && (
          <div className="summary-card">
            <span className="summary-card__tag">请确认我对你问题的理解</span>
            <h2 className="summary-card__problem">{problemMap.core_problem}</h2>

            {problemMap.sub_problems.length > 0 && (
              <div className="summary-card__item">
                <dt className="summary-card__subhead">相关联的问题</dt>
                <ul className="summary-card__sublist">
                  {problemMap.sub_problems.map((sp, i) => (
                    <li key={i}>{sp}</li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="summary-card__list">
              {problemMap.goal && (
                <div className="summary-card__item">
                  <dt>目的</dt>
                  <dd>{problemMap.goal}</dd>
                </div>
              )}
              {problemMap.constraints && (
                <div className="summary-card__item">
                  <dt>约束</dt>
                  <dd>{problemMap.constraints}</dd>
                </div>
              )}
              {problemMap.success_criteria && (
                <div className="summary-card__item">
                  <dt>成功标准</dt>
                  <dd>{problemMap.success_criteria}</dd>
                </div>
              )}
              {problemMap.diagnosis_focus && (
                <div className="summary-card__item">
                  <dt>建议优先诊断</dt>
                  <dd>{focusLabel(problemMap.diagnosis_focus)}</dd>
                </div>
              )}
            </dl>

            <p className="summary-card__confirm-hint">
              以上理解对吗？不对可以直接在下方继续补充。
            </p>
            <button
              type="button"
              className="btn-primary btn-primary--final summary-card__cta"
              onClick={() => onComplete(problemMap, sessionId!)}
            >
              确认无误，开始诊断
            </button>
          </div>
        )}
      </div>

      {error && <p className="chat-error">{error}</p>}

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          rows={2}
          placeholder={inputPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading || !sessionId}
        />
        <button
          type="button"
          className="btn-primary chat-send"
          onClick={() => void send()}
          disabled={loading || !sessionId || draft.trim() === ""}
        >
          发送
        </button>
      </div>
    </div>
  );
}
