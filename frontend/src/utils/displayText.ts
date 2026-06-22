const INTERNAL_KEYWORDS = [
  "facts.",
  "payload.",
  "evidence_package",
  "audit_trail",
  "_cache",
  "needs_verification",
  "fetched_at",
  "llm_estimate",
  "source_hint",
];

const FIELD_LABELS: Record<string, string> = {
  market: "市场与客户",
  product: "产品与服务",
  sales: "销售与增长",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
  legal_compliance: "法务合规",
  tax: "税务",
  policy: "政策事务",
  ip: "知识产权",
  supply_chain: "供应链",
  channel_franchise: "渠道与加盟",
  data_systems: "数据系统",
  overall: "全局经营",
};

export function displayModuleLabel(value?: string | null): string {
  if (!value) return "";
  return FIELD_LABELS[value] ?? value;
}

export function cleanDisplayText(value: unknown, fallback = "暂无可展示内容。"): string {
  if (value == null) return fallback;
  let text = typeof value === "string" ? value : humanTextFromObject(value) ?? JSON.stringify(value);
  text = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  text = humanTextFromSerializedText(text) ?? humanTextFromKeyValueDump(text) ?? text;

  text = text
    .replace(/[([{]\s*['"]?source['"]?\s*[:=][\s\S]*$/i, "")
    .replace(/\s*[（(]\s*(facts|payload|data|cache)[^)）]+[)）]\s*/gi, "")
    .replace(/\b(?:facts|payload|data|audit_trail|evidence_package)\.[\w.-]+/gi, "")
    .replace(/\b(?:signal|conclusion|evidence|actions|drilldown|source|_cache|needs_verification|fetched_at|estimated|data_points)\s*[:=]\s*[^；;，。,)]*/gi, "")
    .replace(/['"]?(?:source|needs_verification|fetched_at|estimated|_cache)['"]?\s*[:=]\s*[^,;，。)]*/gi, "")
    .replace(/[{}[\]'"]/g, "")
    .replace(/\s*[/｜|]\s*$/g, "")
    .replace(/\s*[；;]\s*[；;，。]/g, "；")
    .replace(/\s+([，。；：、！？])/g, "$1")
    .replace(/^\s*[,，:：]\s*/, "")
    .replace(/([，；：、]){2,}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const internalHit = INTERNAL_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword));
  if (!text || internalHit || looksLikeObjectDump(text)) {
    return fallback;
  }
  return text;
}

function humanTextFromObject(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  for (const key of ["summary", "conclusion", "text", "detail", "reason", "description", "value", "name"]) {
    const item = source[key];
    if (typeof item === "string" && item.trim()) return item;
  }
  return null;
}

function humanTextFromSerializedText(value: string): string | null {
  const compact = value.trim();
  if (!compact || (!compact.startsWith("{") && !compact.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(compact);
    if (Array.isArray(parsed)) {
      const items = parsed
        .map((item) => humanTextFromObject(item) ?? (typeof item === "string" ? item : ""))
        .filter(Boolean);
      return items.length ? items.join("；") : null;
    }
    return humanTextFromObject(parsed);
  } catch {
    return null;
  }
}

function humanTextFromKeyValueDump(value: string): string | null {
  if (!/(?:^|[;；,{]\s*)(summary|conclusion|text|detail|reason|description)\s*[:=]/i.test(value)) {
    return null;
  }
  const match = value.match(
    /(?:^|[;；,{]\s*)(?:summary|conclusion|text|detail|reason|description)\s*[:=]\s*['"]?([^;；{}[\]]+)/i
  );
  const extracted = match?.[1]?.replace(/['"],?\s*$/g, "").trim();
  return extracted || null;
}

export function compactDisplayText(value: unknown, maxLength = 92): string {
  const text = cleanDisplayText(value, "");
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function cleanDisplayList(values: unknown[], fallback = "暂无可展示内容。"): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of values) {
    const item = cleanDisplayText(value, "");
    if (!item || seen.has(item)) continue;
    seen.add(item);
    cleaned.push(item);
  }
  return cleaned.length ? cleaned : [fallback];
}

export function cleanSentenceText(value: unknown, fallback = "暂无可展示内容。"): string {
  const text = cleanDisplayText(value, fallback);
  return ensureChineseSentence(text);
}

export function ensureChineseSentence(value: string): string {
  const text = value.trim();
  if (!text) return text;
  if (/[。！？.!?]$/.test(text)) return text;
  return `${text}。`;
}

function looksLikeObjectDump(value: string): boolean {
  const colonCount = (value.match(/[:：]/g) ?? []).length;
  const commaCount = (value.match(/[,，]/g) ?? []).length;
  return colonCount >= 3 && commaCount >= 2;
}
