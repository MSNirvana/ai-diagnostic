import type { ChatMessage, IdeaCard } from "../../types";

export const EMPTY_IDEA_CARD: IdeaCard = {
  title: "",
  one_liner: "",
  source_context: "",
  target_customer: "",
  pain_point: "",
  value_proposition: "",
  core_assumption: "",
  contrary_risk: "",
  validation_action: "",
  next_step: "",
  confidence: "待验证",
};

const CUSTOMER_PATTERNS = [
  /(?:给|面向|针对|服务)([^，。；;]{2,24})(?:做|提供|卖|推出|解决|的)/,
  /(?:客户|用户|人群|对象)(?:是|为|：|:)\s*([^，。；;]{2,28})/,
];

const PAIN_PATTERNS = [
  /(?:痛点|问题|难点)(?:是|为|：|:)\s*([^，。；;]{2,36})/,
  /(?:解决|缓解|改善)([^，。；;]{2,36})(?:的问题|痛点|难题)?/,
];

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return compact(value)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s*[-*•]\s*/g, " ");
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1];
    if (match) return compact(match);
  }
  return "";
}

function inferTitle(text: string): string {
  const normalized = compact(text)
    .replace(/^我(?:有|想|打算|准备)?(?:一个|个)?/, "")
    .replace(/^(?:营销点子|点子|想法|项目|新项目)[是：:]?/, "")
    .replace(/帮我.*$/, "")
    .trim();
  const candidate = normalized || text;
  return compact(candidate).slice(0, 28);
}

function inferRisk(text: string): string {
  if (/失败|死在哪里|风险|不成立|反证/.test(text)) {
    return compact(text).slice(0, 80);
  }
  return "";
}

function inferValidation(text: string): string {
  if (/验证|测试|试点|7\s*天|低成本|小实验/.test(text)) {
    const match = text.match(/(?:先|可以|计划|准备|打算)?(?:做|进行|开展)?\s*(?:\d+\s*天|[一二三四五六七八九十]+天)?[^，。；;]{0,18}(?:验证|测试|试点|小实验)[^，。；;]*/);
    return compact(match?.[0] ?? text).slice(0, 90);
  }
  return "";
}

function inferNextStep(text: string): string {
  if (!/下一步|建议先|可以先|进入正式项目|转入/.test(text)) return "";
  const match = text.match(/(?:下一步|建议先|可以先)[：:，,\s]*(.+?)(?:。|！|？|$)/);
  return stripMarkdown(match?.[1] ?? text).slice(0, 90);
}

function mergeCard(current: IdeaCard, patch: Partial<IdeaCard>): IdeaCard {
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => typeof value === "string" && value.trim())
    ),
  };
}

export function updateIdeaCardFromMessages(messages: ChatMessage[]): IdeaCard {
  return messages.reduce<IdeaCard>((card, message) => {
    const text = compact(message.content);
    if (!text) return card;
    const isUser = message.role === "user";

    const title = !card.title && isUser ? inferTitle(text) : "";
    const customer = !card.target_customer && isUser ? firstMatch(text, CUSTOMER_PATTERNS) : "";
    const pain = !card.pain_point && isUser ? firstMatch(text, PAIN_PATTERNS) : "";
    const validation = !card.validation_action && isUser ? inferValidation(text) : "";
    const risk = !card.contrary_risk && isUser ? inferRisk(text) : "";
    const oneLiner = !card.one_liner && isUser ? text.slice(0, 90) : "";
    const source = !card.source_context && isUser && /已有项目|当前项目|新项目|全新项目|营销|产品|渠道/.test(text)
      ? text.slice(0, 80)
      : "";
    const nextStep = !card.next_step && !isUser ? inferNextStep(text) : "";

    return mergeCard(card, {
      title,
      one_liner: oneLiner,
      source_context: source,
      target_customer: customer,
      pain_point: pain,
      contrary_risk: risk,
      validation_action: validation,
      next_step: nextStep,
      core_assumption: customer && pain ? `${customer}确实存在「${pain}」，并愿意为更好的解决方案付费。` : "",
      confidence: validation || risk ? "可进入验证" : card.confidence,
    });
  }, EMPTY_IDEA_CARD);
}

export function ideaCardCompleteness(card: IdeaCard): number {
  const fields: Array<keyof IdeaCard> = [
    "title",
    "one_liner",
    "target_customer",
    "pain_point",
    "core_assumption",
    "contrary_risk",
    "validation_action",
  ];
  const filled = fields.filter((key) => String(card[key] ?? "").trim()).length;
  return Math.round((filled / fields.length) * 100);
}
