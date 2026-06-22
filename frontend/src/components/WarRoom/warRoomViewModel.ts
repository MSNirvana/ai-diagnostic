import type { WarRoomUrgency } from "../../types";

export const FIELD_LABELS: Record<string, string> = {
  market: "市场与客户",
  product: "产品与服务",
  sales: "销售与增长",
  ops: "运营与供应链",
  org: "组织与人才",
  finance: "财务与资本",
  overall: "全局经营",
};

export const URGENCY_LABELS: Record<WarRoomUrgency, string> = {
  now: "立即拍板",
  soon: "两周内拍板",
  later: "暂缓观察",
};

export const PRIORITY_LABELS: Record<WarRoomUrgency, string> = {
  now: "立即做",
  soon: "两周内做",
  later: "月内做",
};

export function battlefieldLabel(module: string | undefined) {
  if (!module) return "待判定";
  return FIELD_LABELS[module] ?? module;
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function priorityClass(priority: WarRoomUrgency) {
  return `war-priority war-priority--${priority}`;
}
