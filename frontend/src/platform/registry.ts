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
  /** 跨域独立应用入口；独立应用不通过当前 React Router 接管。 */
  external?: boolean;
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
    name: "构造视界",
    tagline: "AI 咨询、头脑风暴与改造方案",
    entryPath: "/tools/diagnostic",
    status: "active",
  },
  {
    id: "image",
    name: "图片创作",
    tagline: "无限画布，生成并整理视觉素材",
    entryPath: (import.meta.env.VITE_IMAGE_APP_URL ?? "https://image.ggoo.ai").replace(/\/$/, ""),
    external: true,
    status: "active",
  },
];

export function listVisibleTools(): ToolDefinition[] {
  return tools.filter((tool) => tool.status !== "coming_soon");
}

export function getTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
