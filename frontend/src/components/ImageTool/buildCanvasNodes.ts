import type { Edge, Node } from "@xyflow/react";
import type { CanvasNodeData, ImageTaskStatus } from "../../types";

const PRESET_NAMES: Record<string, string> = {
  promo: "一键生成宣传图",
  ecommerce: "一键生成电商图",
  template: "从模板开始",
};

const NODE_TYPES = [
  "requirement",
  "asset",
  "reversePrompt",
  "prompt",
  "model",
  "generate",
  "result",
  "export",
] as const;

// Horizontal layout positions (x grows rightward, 320px gap).
const X_STEP = 320;
const Y_CENTER = 120;

export function buildCanvasNodes(
  task: ImageTaskStatus,
  payload: Record<string, unknown> | null,
  assetThumbUrl?: string,
  assetName?: string
): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const p = payload ?? {};
  const presetId = (p.preset_id as string) ?? "";
  const userIntent = (p.user_intent as string) ?? "";
  const reversePrompt = (p.reverse_prompt as string) ?? (p.edited_description as string) ?? "";
  const assembledPrompt = (p.assembled_prompt as string) ?? "";
  const modelName = (p.model_name as string) ?? "image2.0";
  const generationMode = (p.generation_mode as "text2image" | "image2image") ?? "text2image";

  const dataByType: Record<(typeof NODE_TYPES)[number], CanvasNodeData> = {
    requirement: { kind: "requirement", label: "需求/模板", presetName: PRESET_NAMES[presetId] ?? presetId, userIntent },
    asset: { kind: "asset", label: "素材", assetName, assetThumbUrl },
    reversePrompt: { kind: "reversePrompt", label: "反推提示词", reversePrompt },
    prompt: { kind: "prompt", label: "提示词", assembledPrompt },
    model: { kind: "model", label: "模型", modelName },
    generate: {
      kind: "generate",
      label: "图片生成",
      generationMode,
      taskStatus: task.status,
    },
    result: { kind: "result", label: "结果", resultImageUrl: task.result_image_url ?? undefined },
    export: { kind: "export", label: "导出", resultImageUrl: task.result_image_url ?? undefined },
  };

  const nodes: Node<CanvasNodeData>[] = NODE_TYPES.map((type, idx) => ({
    id: type,
    type,
    position: { x: idx * X_STEP, y: Y_CENTER },
    data: dataByType[type],
  }));

  const edges: Edge[] = [];
  for (let i = 0; i < NODE_TYPES.length - 1; i += 1) {
    edges.push({
      id: `e-${NODE_TYPES[i]}-${NODE_TYPES[i + 1]}`,
      source: NODE_TYPES[i],
      target: NODE_TYPES[i + 1],
      type: "smoothstep",
    });
  }

  return { nodes, edges };
}

/** Empty canvas node palette shown when the user opens the top-level "高级" mode. */
export function buildEmptyCanvasNodes(): { nodes: Node<CanvasNodeData>[]; edges: Edge[] } {
  const palette: Node<CanvasNodeData>[] = NODE_TYPES.map((type, idx) => ({
    id: `palette-${type}`,
    type,
    position: { x: 40, y: 40 + idx * 90 },
    data: {
      kind: type,
      label: type,
      modelName: type === "model" ? "image2.0" : undefined,
      generationMode: type === "generate" ? "text2image" : undefined,
      taskStatus: type === "generate" ? "pending" : undefined,
    },
  }));
  return { nodes: palette, edges: [] };
}
