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

export interface TextLinkSegment {
  type: "text" | "link";
  text: string;
  href?: string;
}

export interface SourceTitleLink {
  title: string;
  href: string;
}

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
  // 能力卡（与后端 configs/*.json 的 label 对齐）
  acquisition_efficiency: "获客投放效率",
  cash_runway: "现金流与回款",
  channel_expansion: "渠道招商与单元经济",
  pricing_power: "定价与利润",
  private_traffic: "私域复购",
  retention_churn: "留存流失",
  // 历史/演示域：保留行业惯用英文（SaaS / DTC / Facebook），其余中文化
  saas_sales: "SaaS 销售",
  dtc_ads: "DTC 投放",
  fb_franchise: "Facebook 招商",
  kitchen_channel: "厨电渠道",
};

// 大脑现场生成的取数项 key → 中文（与 configs/*.json 的 data_requirements 对齐 + 常见通用项）。
const DATA_REQUIREMENT_LABELS: Record<string, string> = {
  campaign_performance: "投放报表",
  unit_economics: "单位经济模型",
  unit_store_model: "单店盈利模型",
  competitor_price: "竞品价格",
  discount_promo: "折扣与促销",
  price_margin_structure: "价格与毛利结构",
  cash_position: "现金与消耗",
  receivables_terms: "应收与账期",
  payables_inventory: "应付与库存占款",
  channel_entry: "渠道入口与政策",
  expansion_funnel: "招商与存活漏斗",
  churn_reasons: "流失原因与样本",
  cohort_segmentation: "客群/渠道分层",
  retention_curve: "留存/流失曲线",
  retention_funnel: "私域承接与留存漏斗",
  member_economics: "会员经济模型",
  private_entry: "私域入口与运营",
  traffic_entry: "投放账号与流量入口",
  account_structure: "账户结构",
  competitor_or_benchmark: "竞品与对标",
  rep_followup: "销售跟进",
  channel_performance: "渠道表现",
  promotion_account: "推广账户",
  channel_policy: "渠道政策",
  channel_unit_model: "渠道单店模型",
};

export function displayModuleLabel(value?: string | null): string {
  if (!value) return "";
  // adhoc_ 是大脑现场新建角度的前缀，展示时去掉（与后端 skill_label 一致）
  const key = value.startsWith("adhoc_") ? value.slice("adhoc_".length) : value;
  return FIELD_LABELS[key] ?? key;
}

export function dataRequirementLabel(value?: string | null): string {
  if (!value) return "";
  return DATA_REQUIREMENT_LABELS[value] ?? value;
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

export function formatEvidenceSource(value: unknown, fallback = "客户自述（诊断问答）"): string {
  const text = cleanDisplayText(value, "");
  const normalized = text.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "未注明" ||
    normalized === "未注明来源" ||
    normalized === "无" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "null"
  ) {
    return fallback;
  }
  if (
    text.includes("你提供") ||
    text.includes("用户输入") ||
    text.includes("用户自述") ||
    text.includes("客户自述") ||
    text.includes("诊断问答") ||
    text.includes("经营数据")
  ) {
    return "客户自述（诊断问答）";
  }
  if (text.includes("上传") || text.includes("文件") || text.includes("报告")) {
    return text;
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

export function splitTextWithLinks(value: unknown): TextLinkSegment[] {
  const text = cleanDisplayText(value, "");
  if (!text) return [];
  const segments: TextLinkSegment[] = [];
  const urlPattern = /https?:\/\/[^\s，,；;。)）]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s，,；;。)）]*)?/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(text)) !== null) {
    const url = match[0];
    const start = match.index;
    if (!/\./.test(url)) {
      continue;
    }
    if (start > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, start) });
    }
    segments.push({ type: "link", text: url.replace(/^https?:\/\//i, ""), href: normalizeExternalUrl(url) });
    cursor = start + url.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments.filter((segment) => segment.text);
}

export function extractSourceTitleLink(value: unknown): SourceTitleLink | null {
  const text = cleanDisplayText(value, "");
  if (!text) return null;

  const patterns: RegExp[] = [
    /^(.*?)\s*\[[^\]]+\]\((https?:\/\/[^\s)]+)\)\s*$/i,
    /^(.*?)\s*[（(]\s*(https?:\/\/[^\s)]+)\s*[）)]\s*$/i,
    /^(.*?)\s+(https?:\/\/[^\s，,；;。)）]+)\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const title = match?.[1]?.trim();
    const href = match?.[2]?.trim();
    if (title && href) {
      return {
        title,
        href: normalizeExternalUrl(href),
      };
    }
  }

  return null;
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

function normalizeExternalUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
