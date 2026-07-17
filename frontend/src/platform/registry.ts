export type ToolStatus = "active" | "beta" | "experimental" | "coming_soon";

export interface ToolDefinition {
  /** 稳定标识，用于路由与消费来源归因（tool 字段） */
  id: string;
  /** 平台内显示名 */
  name: string;
  /** 一句话说明 */
  tagline: string;
  /** 工具入口路由 */
  entryPath: string;
  /** 工具状态；coming_soon 不在界面展示（首版不虚构不可用入口） */
  status: ToolStatus;
}

/**
 * 平台工具注册表。
 *
 * 后续工具（如图片创作 /tools/image）在实现可用后再注册，
 * 避免首页堆放不可用入口。
 */
export const tools: ToolDefinition[] = [
  {
    id: "diagnostic",
    name: "经营增长诊断",
    tagline: "AI 咨询、头脑风暴、项目档案与作战室，定位经营问题并生成行动方案",
    entryPath: "/tools/diagnostic",
    status: "active",
  },
  {
    id: "image",
    name: "图片创作",
    tagline: "一键生成宣传图、电商图，或从模板开始",
    entryPath: "/tools/image",
    status: "active",
  },
];

export function listVisibleTools(): ToolDefinition[] {
  return tools.filter((tool) => tool.status !== "coming_soon");
}

export function getTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
