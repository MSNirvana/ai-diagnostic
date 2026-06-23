import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ChatMessage, ProblemMap } from "../../types";
import { deleteSessionFile, startSession, sessionChat, uploadSessionFile } from "../../api/client";
import { ProblemMapPanel } from "./ProblemMapPanel";
import "./ChatStep.css";

const OPENING =
  "你好，我是你的诊断顾问。先告诉我，当前最让你头疼的一个问题是什么？";

type Phase = "intake" | "confirm" | "done";
type ChatBlockKind = "paragraph" | "question" | "heading" | "list_item" | "quote";
export type ProjectChatMode = "consulting" | "brainstorm";

const PROJECT_CHAT_MODES: Record<ProjectChatMode, {
  label: string;
  headline: string;
  placeholder: string;
  note: string;
  suggestions: string[];
}> = {
  consulting: {
    label: "AI咨询",
    headline: "今天，你想解决什么？",
    placeholder: "输入消息...",
    note: "直接把经营问题说出来，我会追问、沉淀问题地图，并在本项目中推进～",
    suggestions: [],
  },
  brainstorm: {
    label: "头脑风暴",
    headline: "来来，我们碰撞一下！",
    placeholder: "输入消息...",
    note: "把新想法丢进来，我会结合项目上下文做推演、反证和验证路径。",
    suggestions: [
      "帮我推演一个低成本获客动作",
      "这个想法最可能失败在哪里",
      "变成 7 天验证计划",
    ],
  },
};

interface ChatBlock {
  kind: ChatBlockKind;
  text: string;
}

interface ChatAttachmentView {
  id: string;
  name: string;
}

export interface UploadedChatFile extends ChatAttachmentView {
  memoryEnabled: boolean;
}

interface DisplayChatMessage extends ChatMessage {
  attachments?: ChatAttachmentView[];
}

function toDisplayMessage(message: ChatMessage): DisplayChatMessage {
  const rawAttachments = (message as DisplayChatMessage).attachments;
  const attachments: ChatAttachmentView[] | undefined = Array.isArray(rawAttachments)
    ? rawAttachments
        .filter((attachment): attachment is ChatAttachmentView => Boolean(attachment?.id && attachment?.name))
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
        }))
    : undefined;
  return {
    ...message,
    ...(attachments ? { attachments } : {}),
  };
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

  return rawBlocks.map((rawText) => {
    const text = rawText.trim();
    if (role === "assistant") {
      if (/^(#{1,4}\s*)?([一二三四五六七八九十]+|[0-9]+)[、.．]\s*\S{2,28}$/.test(text)) {
        return { kind: "heading", text: text.replace(/^#{1,4}\s*/, "") };
      }
      if (/^[-*•]\s+/.test(text)) {
        return { kind: "list_item", text: text.replace(/^[-*•]\s+/, "") };
      }
      if (/^[>｜|]\s*/.test(text)) {
        return { kind: "quote", text: text.replace(/^[>｜|]\s*/, "") };
      }
      if (/[？?]\s*$/.test(text)) {
        return { kind: "question", text };
      }
    }
    return { kind: "paragraph", text };
  });
}

function DocumentAttachmentCard({ file }: { file: ChatAttachmentView }) {
  return (
    <article className="chat-attachment-card" aria-label={`附件：${file.name}`}>
      <span className="chat-attachment-card__icon" aria-hidden="true">DOC</span>
      <div className="chat-attachment-card__copy">
        <strong>{file.name}</strong>
        <em>文档</em>
      </div>
    </article>
  );
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
        block.kind === "heading" ? (
          <h3 className="chat-bubble__heading" key={`${block.kind}-${index}`}>
            {block.text}
          </h3>
        ) : block.kind === "list_item" ? (
          <p className="chat-bubble__paragraph chat-bubble__list-item" key={`${block.kind}-${index}`}>
            {block.text}
          </p>
        ) : (
          <p
            className={
              block.kind === "question"
                ? "chat-bubble__paragraph chat-bubble__question"
                : block.kind === "quote"
                  ? "chat-bubble__paragraph chat-bubble__quote"
                  : "chat-bubble__paragraph"
            }
            key={`${block.kind}-${index}`}
          >
            {block.text}
          </p>
        )
      ))}
    </div>
  );
}

interface ChatStepProps {
  onComplete: (problemMap: ProblemMap, sessionId: string) => void;
  resumeSessionId?: string;
  resumeMessages?: ChatMessage[];
  initialMemoryEnabled?: boolean;
  projectId?: string;
  initialPrompt?: string;
  variant?: "default" | "project-inline";
  projectMode?: ProjectChatMode;
  onProjectModeChange?: (mode: ProjectChatMode) => void;
  inputNotice?: ReactNode;
  diagnosisPlanActive?: boolean;
  initialProblemMap?: ProblemMap | null;
  onProblemMapChange?: (problemMap: ProblemMap) => void;
  brainstormMessages?: ChatMessage[];
  brainstormDraft?: string;
  brainstormLoading?: boolean;
  brainstormError?: string | null;
  brainstormUseProjectContext?: boolean;
  onBrainstormDraftChange?: (value: string) => void;
  onBrainstormSend?: (attachments?: UploadedChatFile[]) => void;
  onBrainstormContextChange?: (enabled: boolean) => void;
}

export function ChatStep({
  onComplete,
  resumeSessionId,
  resumeMessages,
  initialMemoryEnabled = true,
  projectId,
  initialPrompt,
  variant = "default",
  projectMode = "consulting",
  onProjectModeChange,
  inputNotice,
  diagnosisPlanActive = false,
  initialProblemMap = null,
  onProblemMapChange,
  brainstormMessages = [],
  brainstormDraft = "",
  brainstormLoading = false,
  brainstormError = null,
  brainstormUseProjectContext = true,
  onBrainstormDraftChange,
  onBrainstormSend,
  onBrainstormContextChange,
}: ChatStepProps) {
  const isProjectInline = variant === "project-inline";
  const isBrainstormMode = isProjectInline && projectMode === "brainstorm";
  const activeModeConfig = PROJECT_CHAT_MODES[projectMode];
  const [sessionId, setSessionId] = useState<string | null>(
    resumeSessionId ?? null
  );
  const [messages, setMessages] = useState<DisplayChatMessage[]>(
    resumeMessages && resumeMessages.length > 0
      ? resumeMessages.map(toDisplayMessage)
      : isProjectInline
        ? []
        : [{ role: "assistant", content: OPENING }]
  );
  const [draft, setDraft] = useState(initialPrompt?.trim() ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intake");
  const [problemMap, setProblemMap] = useState<ProblemMap | null>(initialProblemMap);
  const [mapPopoverOpen, setMapPopoverOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(initialMemoryEnabled);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedChatFile[]>([]);
  const [uploadingFileName, setUploadingFileName] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapToggleRef = useRef<HTMLDivElement>(null);
  const mapPopoverRef = useRef<HTMLDivElement>(null);
  const plusControlsRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);   // 输入法合成中（拼音/英文候选未上屏）
  const prevLoadingRef = useRef(false);
  const displayedMessages: DisplayChatMessage[] = isBrainstormMode
    ? brainstormMessages.map(toDisplayMessage)
    : messages;
  const displayedLoading = isBrainstormMode ? brainstormLoading : loading;
  const displayedError = isBrainstormMode ? brainstormError : error;
  const activeDraft = isBrainstormMode ? brainstormDraft : draft;
  const hasStartedConversation = (isBrainstormMode ? brainstormMessages.length > 0 : messages.length > (isProjectInline ? 0 : 1))
    || Boolean(resumeSessionId)
    || displayedLoading
    || phase !== "intake";
  const hasConversation = hasStartedConversation
    || Boolean(initialPrompt?.trim())
    || Boolean(uploadingFileName)
    || uploadedFiles.length > 0;
  const shouldLockProjectMode = isProjectInline && hasStartedConversation;

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
  }, [hasConversation, isProjectInline, displayedMessages, displayedLoading, phase, problemMap]);

  useEffect(() => {
    if (initialProblemMap) {
      setProblemMap(initialProblemMap);
    }
  }, [initialProblemMap]);

  useEffect(() => {
    if (!problemMap) setMapPopoverOpen(false);
  }, [problemMap]);

  useEffect(() => {
    if (!isProjectInline || (!mapPopoverOpen && !plusMenuOpen)) return;

    const closeFloatingPanels = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const clickedMap =
        (mapToggleRef.current?.contains(target) ?? false)
        || (mapPopoverRef.current?.contains(target) ?? false);
      const clickedPlus = plusControlsRef.current?.contains(target) ?? false;

      if (!clickedMap && !clickedPlus) {
        setMapPopoverOpen(false);
        setPlusMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeFloatingPanels);
    return () => document.removeEventListener("pointerdown", closeFloatingPanels);
  }, [isProjectInline, mapPopoverOpen, plusMenuOpen]);

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
    const filesToSend = uploadedFiles;
    const next: DisplayChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: text,
        ...(filesToSend.length ? { attachments: filesToSend } : {}),
      },
    ];
    setMessages(next);
    setDraft("");
    setUploadedFiles([]);
      setError(null);
      setLoading(true);
      setPlusMenuOpen(false);
      setMapPopoverOpen(false);
    try {
      const activeSessionId = sessionId ?? await startSession(projectId, memoryEnabled);
      if (!sessionId) setSessionId(activeSessionId);
      const resp = await sessionChat(activeSessionId, text, memoryEnabled);
      setMessages([...next, { role: "assistant", content: resp.message }]);
      setPhase(resp.phase);
      if (resp.problem_map) {
        setProblemMap(resp.problem_map);
        onProblemMapChange?.(resp.problem_map);
      }
      if (resp.phase === "done" && resp.problem_map) {
        onComplete(resp.problem_map, activeSessionId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "对话出了点问题，请重试。");
      setMessages(messages);
      setUploadedFiles(filesToSend);
      setDraft(text);
    } finally {
      setLoading(false);
    }
  };

  const sendBrainstorm = () => {
    const filesToSend = uploadedFiles;
    onBrainstormSend?.(filesToSend);
    setUploadedFiles([]);
    setPlusMenuOpen(false);
    setMapPopoverOpen(false);
  };

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const createdSessionId = await startSession(projectId, memoryEnabled);
    setSessionId(createdSessionId);
    return createdSessionId;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || uploadingFileName) return;
    setPlusMenuOpen(false);
    setMapPopoverOpen(false);
    setError(null);
    try {
      const activeSessionId = await ensureSession();
      for (const file of files) {
        setUploadingFileName(file.name);
        const uploaded = await uploadSessionFile(
          activeSessionId,
          "conversation",
          "uploaded_context",
          file
        );
        const fileItem = {
          id: uploaded.id,
          name: uploaded.original_name,
          memoryEnabled,
        };
        setUploadedFiles((items) => [...items, fileItem]);
      }
      textareaRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "资料上传失败，请重试。");
    } finally {
      setUploadingFileName("");
    }
  };

  const removeUploadedFile = async (fileId: string) => {
    setUploadedFiles((items) => items.filter((item) => item.id !== fileId));
    try {
      await deleteSessionFile(fileId);
    } catch {
      // 删除附件失败不阻断对话；刷新后后端仍以实际文件列表为准。
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
      if (isBrainstormMode) {
        sendBrainstorm();
      } else {
        void send();
      }
    }
  };

  const inputPlaceholder =
    phase === "confirm" && !isBrainstormMode
      ? "还有要补充或纠正的吗？直接说…"
      : variant === "project-inline"
        ? activeModeConfig.placeholder
        : "描述一下你遇到的问题…（Enter 发送，Shift+Enter 换行）";
  const mapStatus = problemMap
    ? `${problemMap.information_score ?? 0}/100`
    : hasConversation
      ? "生成中"
      : "";

  return (
    <div className={isProjectInline ? "chat-step chat-step--project-inline" : "chat-step chat-step--split"}>
      {!isProjectInline && <ProblemMapPanel problemMap={problemMap} phase={phase} variant={variant} />}

      <div className={hasConversation ? `chat-main chat-main--active${hasStartedConversation ? " chat-main--anchored" : ""}` : "chat-main chat-main--empty"}>
        {(!isProjectInline || !hasConversation) && <header className="chat-step__head">
          <h1 className="chat-step__title">{isProjectInline ? activeModeConfig.headline : "先聊聊你的问题"}</h1>
          {!isProjectInline && (
            <p className="chat-step__subtitle">
              像跟顾问对话一样，我会一次问一个，帮你理清核心问题，再生成诊断方案。
            </p>
          )}
        </header>}

        {hasConversation && (
          <div className="chat-stream" ref={scrollRef}>
            {displayedMessages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user" ? "chat-row chat-row--user" : "chat-row chat-row--ai"
                }
              >
                <div className={m.role === "user" ? "chat-message-stack chat-message-stack--user" : "chat-message-stack"}>
                  {m.role === "user" && m.attachments && m.attachments.length > 0 && (
                    <div className="chat-attachment-list" aria-label="本条消息附件">
                      {m.attachments.map((file: ChatAttachmentView) => (
                        <DocumentAttachmentCard file={file} key={file.id} />
                      ))}
                    </div>
                  )}
                  <div
                    className={
                      m.role === "user" ? "chat-bubble chat-bubble--user" : "chat-bubble chat-bubble--ai"
                    }
                  >
                    <ChatMessageContent content={m.content} role={m.role} />
                  </div>
                </div>
              </div>
            ))}

            {displayedLoading && (
              <div className="chat-row chat-row--ai">
                <div className="chat-bubble chat-bubble--ai chat-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            {!isBrainstormMode && !diagnosisPlanActive && phase === "confirm" && problemMap && (
              <div className="confirm-banner">
                <p className="confirm-banner__hint">
                  我已经整理出问题地图。对吗？不对可以在下方继续补充；没问题就开始诊断。
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
        )}

        {isProjectInline && (uploadedFiles.length > 0 || uploadingFileName) && (
          <div className="chat-file-strip" aria-label="已上传资料">
            {uploadedFiles.map((file) => (
              <article className="chat-file-chip" key={file.id}>
                <span>资料</span>
                <strong>{file.name}</strong>
                <em>{file.memoryEnabled ? "发送后沉淀" : "仅本次对话"}</em>
                <button
                  type="button"
                  aria-label={`移除资料：${file.name}`}
                  onClick={() => void removeUploadedFile(file.id)}
                >
                  ×
                </button>
              </article>
            ))}
            {uploadingFileName && (
              <article className="chat-file-chip chat-file-chip--loading">
                <span>上传中</span>
                <strong>{uploadingFileName}</strong>
                <em>正在解析资料</em>
              </article>
            )}
          </div>
        )}

        {displayedError && <p className="chat-error">{displayedError}</p>}

        <div className={isProjectInline && hasStartedConversation ? "chat-input-stack chat-input-stack--anchored" : isProjectInline ? "chat-input-stack" : "chat-input-stack chat-input-stack--default"}>
          {isProjectInline && inputNotice && (
            <div className="chat-input-notice">
              {inputNotice}
            </div>
          )}
          {isProjectInline && (
            <div className="chat-mode-tabs" aria-label="对话模式">
              {shouldLockProjectMode ? (
                <span className="chat-mode-tab chat-mode-tab--locked is-active">
                  <span>{activeModeConfig.label}</span>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className={projectMode === "consulting" ? "chat-mode-tab is-active" : "chat-mode-tab"}
                    onClick={() => onProjectModeChange?.("consulting")}
                  >
                    <span>{PROJECT_CHAT_MODES.consulting.label}</span>
                  </button>
                  <button
                    type="button"
                    className={projectMode === "brainstorm" ? "chat-mode-tab is-active" : "chat-mode-tab"}
                    onClick={() => onProjectModeChange?.("brainstorm")}
                  >
                    <span>{PROJECT_CHAT_MODES.brainstorm.label}</span>
                  </button>
                </>
              )}
            </div>
          )}
          {isProjectInline && mapPopoverOpen && (
            <div className="chat-map-popover" role="dialog" aria-label="问题地图" ref={mapPopoverRef}>
              <div className="chat-map-popover__head">
                <span>问题地图</span>
                <button type="button" onClick={() => setMapPopoverOpen(false)}>
                  关闭
                </button>
              </div>
              <ProblemMapPanel problemMap={problemMap} phase={phase} variant={variant} />
            </div>
          )}

          <div className="chat-input-bar">
            {isProjectInline && (
              <div className="chat-plus-wrap" ref={plusControlsRef}>
                <button
                  type="button"
                  className={plusMenuOpen ? "chat-plus-button is-open" : "chat-plus-button"}
                  aria-label="更多输入选项"
                  aria-expanded={plusMenuOpen}
                  onClick={() => {
                    setMapPopoverOpen(false);
                    setPlusMenuOpen((open) => !open);
                  }}
                >
                  +
                </button>
                {plusMenuOpen && (
                  <div className="chat-plus-menu" role="menu" aria-label="输入选项">
                    <button
                      type="button"
                      className="chat-plus-menu__item"
                      role="menuitem"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="chat-plus-menu__file-icon" aria-hidden="true">+</span>
                      <span className="chat-plus-menu__copy">
                        <strong>上传资料</strong>
                        <em>Excel、Word、PDF、图片等，AI 会先整理摘要再参考</em>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-plus-menu__item"
                      role="menuitemcheckbox"
                      aria-checked={memoryEnabled}
                      onClick={() => {
                        if (isBrainstormMode) {
                          onBrainstormContextChange?.(!brainstormUseProjectContext);
                        } else {
                          setMemoryEnabled((enabled) => !enabled);
                        }
                      }}
                    >
                      <span className={(isBrainstormMode ? brainstormUseProjectContext : memoryEnabled) ? "chat-plus-menu__switch is-on" : "chat-plus-menu__switch"} />
                      <span className="chat-plus-menu__copy">
                        <strong>{isBrainstormMode ? "带入项目信息" : "沉淀到企业档案"}</strong>
                        <em>
                          {isBrainstormMode
                            ? (brainstormUseProjectContext ? "会参考企业档案和作战室" : "只围绕本轮想法推演")
                            : (memoryEnabled ? "默认开启，会提取有用信息进入本项目档案" : "本次不沉淀")}
                        </em>
                      </span>
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="chat-file-input"
                  multiple
                  accept=".csv,.xls,.xlsx,.doc,.docx,.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,image/*,application/pdf"
                  onChange={handleFileUpload}
                />
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="chat-input"
              rows={2}
              placeholder={inputPlaceholder}
              value={activeDraft}
              onChange={(e) => {
                if (isBrainstormMode) {
                  onBrainstormDraftChange?.(e.target.value);
                } else {
                  setDraft(e.target.value);
                }
              }}
              onKeyDown={onKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              disabled={Boolean(uploadingFileName)}
              autoFocus
            />
            <button
              type="button"
              className="btn-primary chat-send"
              onClick={() => {
                if (isBrainstormMode) {
                  sendBrainstorm();
                } else {
                  void send();
                }
              }}
              disabled={displayedLoading || Boolean(uploadingFileName) || activeDraft.trim() === ""}
              aria-label="发送消息"
            >
              {isProjectInline ? "↑" : "发送"}
            </button>
          </div>
          {isProjectInline && (
            <div className="chat-input-tools" ref={mapToggleRef}>
              {!isBrainstormMode && (
                <button
                  type="button"
                  className={mapPopoverOpen ? "chat-map-toggle is-open" : "chat-map-toggle"}
                  aria-expanded={mapPopoverOpen}
                  onClick={() => {
                    setPlusMenuOpen(false);
                    setMapPopoverOpen((open) => !open);
                  }}
                >
                  <span>问题地图</span>
                  {mapStatus && <em>{mapStatus}</em>}
                </button>
              )}
              {activeModeConfig.suggestions.map((prompt) => (
                <button
                  type="button"
                  className="chat-suggestion-pill"
                  key={prompt}
                  onClick={() => onBrainstormDraftChange?.(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          {isProjectInline && <p className="chat-step__disclaimer">{activeModeConfig.note}</p>}
        </div>
      </div>
    </div>
  );
}
