import type {
  ChatMessage,
  ProblemSummary,
  GeneratedModule,
  ProblemMap,
} from "../types";

const VERSION = 3;
const keyFor = (userId: string, projectId?: string | null) =>
  `ai_diagnostic_draft_${userId}_${projectId || "global"}`;
const legacyKeyFor = (userId: string) => `ai_diagnostic_draft_${userId}`;

export interface DraftState {
  version: number;
  userId: string;
  savedAt: string;
  mode: "chatting" | "ready";
  messages: ChatMessage[];
  chatSummary: ProblemSummary | null;
  problemMap?: ProblemMap | null;
  sessionId?: string | null;
  activeModules: GeneratedModule[];
  current: number;
  facts: Record<string, Record<string, string>>;
  pains: Record<string, string[]>;
  freeText: Record<string, string>;
  // 文件名列表（内容无法持久化），key = `${moduleKey}__${fieldKey}`
  fileNames: Record<string, string[]>;
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
}

export function saveDraft(
  userId: string,
  state: Omit<DraftState, "version" | "userId" | "savedAt">,
  projectId?: string | null
): void {
  if (!hasStorage()) return;
  const payload: DraftState = {
    ...state,
    version: VERSION,
    userId,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(keyFor(userId, projectId), JSON.stringify(payload));
  } catch {
    // 配额超限或隐私模式：静默失败，不影响填写
  }
}

export function loadDraft(userId: string, projectId?: string | null): DraftState | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId, projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    // 版本不匹配 / 结构损坏 → 丢弃旧草稿
    if (parsed.version !== VERSION) {
      clearDraft(userId, projectId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(userId: string, projectId?: string | null): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(keyFor(userId, projectId));
  } catch {
    // 忽略
  }
}

export function clearLegacyDraft(userId: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(legacyKeyFor(userId));
  } catch {
    // 忽略
  }
}
