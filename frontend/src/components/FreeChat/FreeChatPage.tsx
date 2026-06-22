import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppShell } from "../Layout/AppShell";
import type { ChatMessage, IdeaCard } from "../../types";
import { saveIdeaCard, sendBrainstormMessage } from "../../api/client";
import { ideaCardCompleteness, updateIdeaCardFromMessages } from "./ideaCard";
import { renderMessageBlocks } from "./messageFormat";
import "./FreeChatPage.css";

const OPENING = "把一个想法或经营卡点丢给我吧。我会帮你拆核心假设、反证风险和第一步验证动作。";
const WINDOWS_STORAGE_KEY = "ruice:brainstorm:windows:v1";
const ACTIVE_WINDOW_STORAGE_KEY = "ruice:brainstorm:active-window:v1";

interface BrainstormWindow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  draft: string;
}

interface BrainstormWorkspace {
  windows: BrainstormWindow[];
  activeWindowId: string;
}

interface IdeaBriefItem {
  label: string;
  value: string;
  tone?: "strong" | "risk" | "action";
}

function fieldText(card: IdeaCard, key: keyof IdeaCard): string {
  const value = card[key];
  return typeof value === "string" ? value.trim() : "";
}

function ideaBriefItems(card: IdeaCard): IdeaBriefItem[] {
  const items: IdeaBriefItem[] = [
    { label: "服务对象", value: fieldText(card, "target_customer") },
    { label: "要解决的事", value: fieldText(card, "pain_point"), tone: "strong" },
    { label: "成立逻辑", value: fieldText(card, "core_assumption"), tone: "strong" },
    { label: "验证动作", value: fieldText(card, "validation_action"), tone: "action" },
    { label: "需要警惕", value: fieldText(card, "contrary_risk"), tone: "risk" },
    { label: "下一步", value: fieldText(card, "next_step"), tone: "action" },
  ];
  return items.filter((item) => item.value).slice(0, 5);
}

function defaultMessages(): ChatMessage[] {
  return [{ role: "assistant", content: OPENING }];
}

function makeWindow(now = new Date().toISOString()): BrainstormWindow {
  return {
    id: `brainstorm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "新的风暴窗口",
    createdAt: now,
    updatedAt: now,
    messages: defaultMessages(),
    draft: "",
  };
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
}

function normalizeWindow(value: unknown): BrainstormWindow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BrainstormWindow>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  const messages = Array.isArray(candidate.messages) ? candidate.messages.filter(isChatMessage) : defaultMessages();
  const draft = typeof candidate.draft === "string" ? candidate.draft : "";
  const now = new Date().toISOString();
  return {
    id: candidate.id,
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : deriveWindowTitle(messages, draft),
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now,
    messages: messages.length ? messages : defaultMessages(),
    draft,
  };
}

function deriveWindowTitle(messages: ChatMessage[], draft = ""): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  const titleSource = firstUserMessage || draft.trim();
  if (!titleSource) return "新的风暴窗口";
  const compact = titleSource.replace(/\s+/g, " ").replace(/^[我想要有做给把帮请一下，。,.、\s]+/, "");
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
}

function readStoredWorkspace(): BrainstormWorkspace {
  const fallback = makeWindow();
  if (typeof window === "undefined") {
    return { windows: [fallback], activeWindowId: fallback.id };
  }

  try {
    const rawWindows = window.localStorage.getItem(WINDOWS_STORAGE_KEY);
    const windows = rawWindows
      ? (JSON.parse(rawWindows) as unknown[]).map(normalizeWindow).filter((item): item is BrainstormWindow => Boolean(item))
      : [];
    const activeFromQuery = new URLSearchParams(window.location.search).get("window");
    const storedActiveId = window.localStorage.getItem(ACTIVE_WINDOW_STORAGE_KEY);
    const activeWindowId =
      (activeFromQuery && windows.some((item) => item.id === activeFromQuery) && activeFromQuery) ||
      (storedActiveId && windows.some((item) => item.id === storedActiveId) && storedActiveId) ||
      windows[0]?.id ||
      fallback.id;
    return windows.length ? { windows, activeWindowId } : { windows: [fallback], activeWindowId: fallback.id };
  } catch {
    return { windows: [fallback], activeWindowId: fallback.id };
  }
}

function persistWorkspace(workspace: BrainstormWorkspace) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WINDOWS_STORAGE_KEY, JSON.stringify(workspace.windows));
    window.localStorage.setItem(ACTIVE_WINDOW_STORAGE_KEY, workspace.activeWindowId);
  } catch {
    // Storage can be unavailable in private mode; the page should still work in-memory.
  }
}

function updatedWindow(windowItem: BrainstormWindow, patch: Partial<Pick<BrainstormWindow, "messages" | "draft">>): BrainstormWindow {
  const messages = patch.messages ?? windowItem.messages;
  const draft = patch.draft ?? windowItem.draft;
  return {
    ...windowItem,
    ...patch,
    messages,
    draft,
    title: deriveWindowTitle(messages, draft),
    updatedAt: new Date().toISOString(),
  };
}

export function FreeChatPage() {
  const location = useLocation();
  const initialPrompt = ((location.state as { initialPrompt?: string } | null)?.initialPrompt ?? "").trim();
  const [workspace, setWorkspace] = useState<BrainstormWorkspace>(() => readStoredWorkspace());
  const [loadingWindowIds, setLoadingWindowIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingIdea, setSavingIdea] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedIdeaId, setSavedIdeaId] = useState<string | null>(null);
  const composingRef = useRef(false);
  const initialPromptAppliedRef = useRef(false);
  const prevLoadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeWindow = workspace.windows.find((item) => item.id === workspace.activeWindowId) ?? workspace.windows[0] ?? makeWindow();
  const messages = activeWindow.messages;
  const draft = activeWindow.draft;
  const activeWindowLoading = loadingWindowIds.includes(activeWindow.id);

  const ideaCard = useMemo(() => updateIdeaCardFromMessages(messages), [messages]);
  const cardCompleteness = useMemo(() => ideaCardCompleteness(ideaCard), [ideaCard]);
  const briefItems = useMemo(() => ideaBriefItems(ideaCard), [ideaCard]);
  const canSaveIdea = Boolean(ideaCard.title.trim() || ideaCard.one_liner.trim());

  useEffect(() => {
    persistWorkspace(workspace);
  }, [workspace]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeWindow.id, messages, activeWindowLoading]);

  useEffect(() => {
    if (prevLoadingRef.current && !activeWindowLoading) {
      textareaRef.current?.focus();
    }
    prevLoadingRef.current = activeWindowLoading;
  }, [activeWindowLoading]);

  useEffect(() => {
    setSavedIdeaId(null);
    setSaveError(null);
  }, [activeWindow.id, messages.length]);

  const quickPrompts = useMemo(() => [
    "我有一个营销想法，帮我判断逻辑站不站得住。",
    "我想做一个新项目，帮我拆核心假设。",
    "帮我设计一个 7 天低成本验证动作。",
    "如果这个点子失败，最可能死在哪里？",
  ], []);

  const updateActiveWindow = (patch: Partial<Pick<BrainstormWindow, "messages" | "draft">>) => {
    setWorkspace((current) => ({
      ...current,
      windows: current.windows.map((item) =>
        item.id === current.activeWindowId ? updatedWindow(item, patch) : item
      ),
    }));
  };

  useEffect(() => {
    if (!initialPrompt || initialPromptAppliedRef.current) return;
    initialPromptAppliedRef.current = true;
    updateActiveWindow({ draft: initialPrompt });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const switchWindow = (windowId: string) => {
    if (windowId === activeWindow.id) return;
    setError(null);
    setWorkspace((current) => {
      if (!current.windows.some((item) => item.id === windowId)) return current;
      return { ...current, activeWindowId: windowId };
    });
  };

  const createNewWindow = () => {
    const nextWindow = makeWindow();
    setError(null);
    setSavedIdeaId(null);
    setSaveError(null);
    setWorkspace((current) => ({
      activeWindowId: nextWindow.id,
      windows: [nextWindow, ...current.windows],
    }));
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } else {
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || activeWindowLoading) return;
    const sendingWindowId = activeWindow.id;
    const nextMessages = [...messages, { role: "user", content: text } as ChatMessage];
    updateActiveWindow({ messages: nextMessages, draft: "" });
    setError(null);
    setLoadingWindowIds((ids) => (ids.includes(sendingWindowId) ? ids : [...ids, sendingWindowId]));
    try {
      const resp = await sendBrainstormMessage(nextMessages);
      setWorkspace((current) => ({
        ...current,
        windows: current.windows.map((item) =>
          item.id === sendingWindowId
            ? updatedWindow(item, { messages: [...nextMessages, { role: "assistant", content: resp.message }] })
            : item
        ),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "对话失败");
      setWorkspace((current) => ({
        ...current,
        windows: current.windows.map((item) =>
          item.id === sendingWindowId
            ? updatedWindow(item, { messages, draft: item.draft.trim() ? item.draft : text })
            : item
        ),
      }));
    } finally {
      setLoadingWindowIds((ids) => ids.filter((id) => id !== sendingWindowId));
    }
  };

  const saveCurrentIdea = async () => {
    if (!canSaveIdea || savingIdea) return;
    setSavingIdea(true);
    setSaveError(null);
    try {
      const saved = await saveIdeaCard(ideaCard, messages);
      setSavedIdeaId(saved.id ?? "saved");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存点子卡失败");
    } finally {
      setSavingIdea(false);
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      e.preventDefault();
      void send();
    }
  };

  return (
    <AppShell>
      <section className="freechat-shell">
        <div className="freechat-hero">
          <div>
            <span className="freechat-kicker">Idea Lab</span>
            <h1>头脑风暴</h1>
            <p>把想法或经营卡点丢进来，先聊清楚为什么成立、哪里可能不成立、下一步怎么验证。</p>
          </div>
          <div className="freechat-pills">
            <span>头脑风暴</span>
            <span>逻辑自证</span>
            <span>低成本验证</span>
          </div>
        </div>

        <div className="freechat-workbench">
          <div className="freechat-chat surface-card">
            <div className="freechat-windowbar">
              <div className="freechat-windowbar__summary">
                <span>风暴窗口</span>
                <strong>{activeWindow.title}</strong>
              </div>
              <button type="button" className="freechat-window-new" onClick={createNewWindow}>
                新建窗口
              </button>
              <div className="freechat-window-tabs" aria-label="风暴窗口列表">
                {workspace.windows.map((windowItem) => {
                  const isActive = windowItem.id === activeWindow.id;
                  const isLoading = loadingWindowIds.includes(windowItem.id);
                  const messageCount = Math.max(0, windowItem.messages.length - 1);
                  return (
                    <button
                      key={windowItem.id}
                      type="button"
                      className={isActive ? "freechat-window-tab freechat-window-tab--active" : "freechat-window-tab"}
                      aria-label={`切换到风暴窗口：${windowItem.title}`}
                      aria-pressed={isActive}
                      onClick={() => switchWindow(windowItem.id)}
                    >
                      <strong>{windowItem.title}</strong>
                      <span>{isLoading ? "回复中" : messageCount ? `${messageCount} 条记录` : "新点子"}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="freechat-stream" ref={scrollRef} role="log" aria-label="风暴对话记录">
              {messages.map((message, index) => (
                <div key={index} className={message.role === "user" ? "freechat-row freechat-row--user" : "freechat-row"}>
                  <div className={message.role === "user" ? "freechat-bubble freechat-bubble--user" : "freechat-bubble"}>
                    {renderMessageBlocks(message.content, String(index))}
                  </div>
                </div>
              ))}
              {activeWindowLoading && (
                <div className="freechat-row">
                  <div className="freechat-bubble freechat-bubble--assistant freechat-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>

            <div className="freechat-prompts">
              {quickPrompts.map((prompt) => (
                <button key={prompt} type="button" className="freechat-chip" onClick={() => void send(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>

            {error && <p className="freechat-error">{error}</p>}

            <div className="freechat-inputbar">
              <textarea
                ref={textareaRef}
                className="freechat-input"
                rows={3}
                value={draft}
                placeholder="直接输入你想聊的内容，Enter 发送，Shift+Enter 换行"
                onChange={(e) => updateActiveWindow({ draft: e.target.value })}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onKeyDown={onInputKeyDown}
                autoFocus
              />
              <button type="button" className="btn-primary freechat-send" onClick={() => void send()} disabled={activeWindowLoading || !draft.trim()}>
                {activeWindowLoading ? "思考中" : "开始风暴"}
              </button>
            </div>
          </div>

          <aside className="idea-card surface-card" aria-label="点子卡草稿">
            <div className="idea-card__header">
              <div>
                <span className="idea-card__eyebrow">Idea Brief</span>
                <h3>点子梳理</h3>
                <p>这里只保留对话里已经浮现出来的关键判断，不提前塞满固定字段。</p>
              </div>
              <span className="idea-card__status">{ideaCard.confidence}</span>
            </div>

            <div className="idea-card__summary">
              <span>当前点子</span>
              <strong>{ideaCard.title || "等待一个值得推敲的点子"}</strong>
              <p>
                {briefItems.length
                  ? `已从对话里提炼出 ${briefItems.length} 个要点，继续聊会自动更新。`
                  : "先随便说，不用写完整。AI 会随着追问把它整理成更清楚的商业假设。"}
              </p>
            </div>

            {briefItems.length ? (
              <div className="idea-card__brief" aria-label="已识别的点子要点">
                {briefItems.map((item) => (
                  <article key={`${item.label}-${item.value}`} className={item.tone ? `idea-card__brief-item idea-card__brief-item--${item.tone}` : "idea-card__brief-item"}>
                    <span>{item.label}</span>
                    <p>{item.value}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="idea-card__empty">
                <strong>还没有形成结构化要点。</strong>
                <p>先把想法丢进对话框。比如：想卖给谁、解决什么麻烦、为什么现在值得做。</p>
              </div>
            )}

            <div className="idea-card__footer">
              {briefItems.length ? <span className="idea-card__hint">已识别 {briefItems.length} 个要点 · 完整度 {cardCompleteness}%</span> : null}
              <button
                type="button"
                className="btn-primary idea-card__save"
                onClick={() => void saveCurrentIdea()}
                disabled={!canSaveIdea || savingIdea}
              >
                {savingIdea ? "保存中" : "保存点子"}
              </button>
              {savedIdeaId && <p className="idea-card__success">点子已保存。继续对话会更新草稿，可再次保存新版。</p>}
              {saveError && <p className="freechat-error">{saveError}</p>}
            </div>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
