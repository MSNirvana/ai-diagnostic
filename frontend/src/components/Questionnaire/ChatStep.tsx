import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ProblemSummary } from "../../types";
import { sendChatMessage } from "../../api/client";
import "./ChatStep.css";

const OPENING =
  "你好，我是你的诊断顾问。先告诉我，当前最让你头疼的一个问题是什么？";

interface ChatStepProps {
  onComplete: (summary: ProblemSummary) => void;
}

export function ChatStep({ onComplete }: ChatStepProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: OPENING },
  ]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProblemSummary | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, summary]);

  const send = async () => {
    const text = draft.trim();
    if (!text || loading || summary) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setError(null);
    setLoading(true);
    try {
      const resp = await sendChatMessage(next);
      setMessages([...next, { role: "assistant", content: resp.message }]);
      if (resp.done && resp.summary) {
        setSummary(resp.summary);
      }
    } catch {
      setError("对话出了点问题，请重试。");
      // 回退用户输入，便于重试
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

        {summary && (
          <div className="summary-card">
            <span className="summary-card__tag">已锁定核心问题</span>
            <h2 className="summary-card__problem">{summary.core_problem}</h2>
            <dl className="summary-card__list">
              {summary.context && (
                <div className="summary-card__item">
                  <dt>背景</dt>
                  <dd>{summary.context}</dd>
                </div>
              )}
              {summary.suspected_cause && (
                <div className="summary-card__item">
                  <dt>你怀疑的原因</dt>
                  <dd>{summary.suspected_cause}</dd>
                </div>
              )}
              {summary.tried && (
                <div className="summary-card__item">
                  <dt>已尝试</dt>
                  <dd>{summary.tried}</dd>
                </div>
              )}
            </dl>
            <button
              type="button"
              className="btn-primary btn-primary--final summary-card__cta"
              onClick={() => onComplete(summary)}
            >
              基于这个问题，生成诊断方案
            </button>
          </div>
        )}
      </div>

      {error && <p className="chat-error">{error}</p>}

      {!summary && (
        <div className="chat-input-bar">
          <textarea
            className="chat-input"
            rows={2}
            placeholder="描述一下你遇到的问题…（Enter 发送，Shift+Enter 换行）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />
          <button
            type="button"
            className="btn-primary chat-send"
            onClick={() => void send()}
            disabled={loading || draft.trim() === ""}
          >
            发送
          </button>
        </div>
      )}
    </div>
  );
}
