import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ProblemMap } from "../../types";
import { startSession, sessionChat } from "../../api/client";
import { ProblemMapPanel } from "./ProblemMapPanel";
import "./ChatStep.css";

const OPENING =
  "你好，我是你的诊断顾问。先告诉我，当前最让你头疼的一个问题是什么？";

type Phase = "intake" | "confirm" | "done";
type ChatBlockKind = "paragraph" | "question";

interface ChatBlock {
  kind: ChatBlockKind;
  text: string;
}

const READABLE_BREAK_PATTERN =
  /([。！？!?])\s*(?=(这里|所以|否则|那|不过|但是|同时|比如|另外|接下来|如果|而|这|30天|首先|其次|最后|我想|你更|我们先))/g;
const LIST_BREAK_PATTERN =
  /([；;])\s*(?=(一条|另一条|第三|首先|其次|另外|最后))/g;

function splitLongSentence(text: string): string[] {
  if (text.length <= 120) return [text];
  const parts = text.match(/[^；;，,]+[；;，,]?/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    if (current && `${current}${next}`.length > 96) {
      chunks.push(current);
      current = next;
    } else {
      current = current ? `${current}${next}` : next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

function splitReadableText(text: string): string[] {
  const prepared = text
    .replace(READABLE_BREAK_PATTERN, "$1\n")
    .replace(LIST_BREAK_PATTERN, "$1\n");
  const chunks: string[] = [];

  for (const section of prepared.split(/\n+/)) {
    const clean = section.trim();
    if (!clean) continue;
    const sentences = clean.match(/[^。！？!?]+[。！？!?]?/g) ?? [clean];
    let current = "";

    for (const sentence of sentences) {
      const item = sentence.trim();
      if (!item) continue;
      if (item.length > 120) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        chunks.push(...splitLongSentence(item));
        continue;
      }
      if (current && `${current}${item}`.length > 132) {
        chunks.push(current);
        current = item;
      } else {
        current = current ? `${current}${item}` : item;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

export function formatChatBlocks(content: string, role: ChatMessage["role"]): ChatBlock[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];
  const rawBlocks =
    role === "assistant"
      ? splitReadableText(normalized)
      : normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean);

  return rawBlocks.map((text) => ({
    kind: role === "assistant" && /[？?]\s*$/.test(text) ? "question" : "paragraph",
    text,
  }));
}

function ChatMessageContent({
  content,
  role,
}: {
  content: string;
  role: ChatMessage["role"];
}) {
  const blocks = formatChatBlocks(content, role);
  return (
    <div className="chat-bubble__content">
      {blocks.map((block, index) => (
        <p
          className={
            block.kind === "question"
              ? "chat-bubble__paragraph chat-bubble__question"
              : "chat-bubble__paragraph"
          }
          key={`${block.kind}-${index}`}
        >
          {block.text}
        </p>
      ))}
    </div>
  );
}

interface ChatStepProps {
  onComplete: (problemMap: ProblemMap, sessionId: string) => void;
  resumeSessionId?: string;
  resumeMessages?: ChatMessage[];
  projectId?: string;
}

export function ChatStep({
  onComplete,
  resumeSessionId,
  resumeMessages,
  projectId,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);   // 输入法合成中（拼音/英文候选未上屏）
  const prevLoadingRef = useRef(false);

  // 续聊用已有 session；新诊断不在挂载时建空会话，避免用户只点进页面就污染历史。
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (resumeSessionId) {
      setSessionId(resumeSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, phase, problemMap]);

  // 发送结束（loading 由 true 变 false）后自动把焦点送回输入框，免去再点一次
  useEffect(() => {
    if (prevLoadingRef.current && !loading && phase !== "done") {
      textareaRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading, phase]);

  const send = async () => {
    const text = draft.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setError(null);
    setLoading(true);
    try {
      const activeSessionId = sessionId ?? await startSession(projectId);
      if (!sessionId) setSessionId(activeSessionId);
      const resp = await sessionChat(activeSessionId, text);
      setMessages([...next, { role: "assistant", content: resp.message }]);
      setPhase(resp.phase);
      if (resp.problem_map) setProblemMap(resp.problem_map);
      if (resp.phase === "done" && resp.problem_map) {
        onComplete(resp.problem_map, activeSessionId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "对话出了点问题，请重试。");
      setMessages(messages);
      setDraft(text);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法合成中（拼音选词、英文候选）回车只用于确认候选，不发送。
    // e.nativeEvent.isComposing 覆盖大部分浏览器；composingRef 兜底（部分输入法不触发 isComposing）。
    if (e.key === "Enter" && !e.shiftKey) {
      if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      void send();
    }
  };

  const inputPlaceholder =
    phase === "confirm"
      ? "还有要补充或纠正的吗？直接说…"
      : "描述一下你遇到的问题…（Enter 发送，Shift+Enter 换行）";

  return (
    <div className="chat-step chat-step--split">
      <ProblemMapPanel problemMap={problemMap} phase={phase} />

      <div className="chat-main">
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
                <ChatMessageContent content={m.content} role={m.role} />
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
            <div className="confirm-banner">
              <p className="confirm-banner__hint">
                左侧是我对你问题的理解。对吗？不对可以在下方继续补充；没问题就开始诊断。
              </p>
              <button
                type="button"
                className="btn-primary btn-primary--final"
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
            ref={textareaRef}
            className="chat-input"
            rows={2}
            placeholder={inputPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            disabled={loading}
            autoFocus
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
      </div>
    </div>
  );
}
