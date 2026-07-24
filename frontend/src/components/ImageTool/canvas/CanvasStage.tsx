import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PlatformNav } from "../../../platform/PlatformNav";
import {
  createImageTask,
  executeCanvasNode,
  exportCanvasProject,
  getImageModelCapabilities,
  getImageTask,
  getImageAssetPreviewUrl,
  getLatestCanvasScene,
  importCanvasProject,
  saveCanvasScene,
  uploadImageAsset,
} from "../../../api/client";
import type {
  CanvasEdge,
  CanvasGroup,
  CanvasItem,
  CanvasItemMetadata,
  CanvasScene,
  CanvasViewport,
  ImageTaskStatus,
  PlannerFrame,
  PlannerPlan,
} from "../../../types";
import { CanvasBoard } from "./CanvasBoard";
import { CanvasNodeInspector } from "./CanvasNodeInspector";
import { Minimap } from "./Minimap";
import { validateCanvasConnection } from "./canvasNodeRegistry";
import "./CanvasStage.css";

interface CanvasStageProps {
  taskId?: string | null;
  onBack?: () => void;
}

const PRESET_NAMES: Record<string, string> = {
  promo: "生成宣传海报",
  ecommerce: "生成电商套图",
  content: "生成内容配图",
  template: "从模板开始",
};

const CARD_TYPE_SEQUENCE = ["hero", "detail", "feature", "parameter", "lifestyle", "comparison"] as const;

const CARD_W = 220;
const CARD_H = 160;
const GAP = 24;
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

function buildSceneFromTask(task: ImageTaskStatus): CanvasScene {
  const items: CanvasItem[] = [];
  const edges: CanvasEdge[] = [];
  let x = ORIGIN_X;
  const y = ORIGIN_Y;
  let zIndex = 1;

  const push = (
    id: string,
    kind: CanvasItem["kind"],
    label: string,
    extra: Partial<CanvasItem> = {}
  ) => {
    items.push({
      id,
      kind,
      label,
      x,
      y,
      width: CARD_W,
      height: CARD_H,
      zIndex: zIndex++,
      ...extra,
    });
    x += CARD_W + GAP;
  };

  push("requirement", "requirement", "需求/模板", {
    metadata: {
      presetName: PRESET_NAMES[task.preset_id ?? ""] ?? task.preset_id ?? undefined,
      templateId: task.template_id ?? undefined,
      userIntent: task.user_intent ?? undefined,
    },
  });

  const referenceEntries = task.reference_assets?.length
    ? task.reference_assets
    : (task.reference_asset_ids ?? (task.reference_asset_id ? [task.reference_asset_id] : [])).map((assetId, index) => ({
      asset_id: assetId,
      role: index === 0 ? "product" : "detail",
    }));
  if (referenceEntries.length === 0) {
    push("asset", "asset", "素材", { metadata: { userIntent: "未上传参考图" } });
  } else {
    referenceEntries.forEach((reference, index) => {
      const role = reference.role || (index === 0 ? "product" : "detail");
      push(`asset-${index + 1}`, "asset", `素材 · ${role}`, {
        assetId: reference.asset_id,
        metadata: { referenceRole: role as CanvasItemMetadata["referenceRole"] },
      });
    });
  }

  if (task.reverse_prompt) {
    push("reversePrompt", "reversePrompt", "反推提示词", {
      metadata: { reversePrompt: task.reverse_prompt ?? undefined },
    });
  }

  push("prompt", "prompt", "图片提示词", {
    metadata: { assembledPrompt: task.assembled_prompt ?? undefined },
  });

  push("model", "model", "图片模型", {
    metadata: {
      modelName: task.model ?? "gpt-image-2",
      modelVersion: task.model_version ?? task.model ?? "gpt-image-2",
      aspectRatio: task.aspect_ratio ?? "1:1",
      size: task.size ?? "1024x1024",
      quality: task.quality ?? "auto",
    },
  });

  push("generate", "generate", "图片生成", {
    metadata: {
      generationMode: task.generation_mode ?? undefined,
      taskStatus: task.status,
      taskError: task.error ?? undefined,
    },
  });

  push("result", "result", "结果", {
    imageUrl: task.result_image_url ?? undefined,
    assetId: task.result_asset_ids?.[0] ?? undefined,
    metadata: { taskStatus: task.status, resultAssetIds: task.result_asset_ids ?? [] },
  });

  push("export", "export", "导出", {
    imageUrl: task.result_image_url ?? undefined,
    assetId: task.result_asset_ids?.[0] ?? undefined,
    metadata: { resultAssetIds: task.result_asset_ids ?? [] },
  });

  // 自动连线：表达数据流向（素材 → 生成，生成 → 结果）
  referenceEntries.forEach((reference, index) => {
    edges.push({
      id: `edge-asset-${index + 1}-generate`,
      fromId: `asset-${index + 1}`,
      toId: "generate",
      fromPort: "image",
      toPort: "image",
      dataType: "image",
      label: reference.role || "参考",
    });
  });
  edges.push({ fromId: "prompt", toId: "generate", fromPort: "prompt", toPort: "prompt", dataType: "prompt", id: "edge-prompt-generate", label: "提示词" });
  edges.push({ fromId: "model", toId: "generate", fromPort: "config", toPort: "config", dataType: "model-config", id: "edge-model-generate", label: "规格" });
  edges.push({
    id: "edge-generate-result",
    fromId: "generate",
    toId: "result",
    fromPort: "image",
    toPort: "image",
    dataType: "image",
    label: "输出",
  });
  edges.push({
    id: "edge-result-export",
    fromId: "result",
    toId: "export",
    fromPort: "image",
    toPort: "image",
    dataType: "image",
    label: "导出",
  });

  return {
    items,
    edges,
    groups: [],
    viewport: { x: 0, y: 0, scale: 1 },
    version: 1,
    planner_plan: null,
  };
}

function buildEmptyScene(): CanvasScene {
  return {
    items: [
      {
        id: "starter-requirement",
        kind: "requirement",
        label: "需求/模板",
        x: ORIGIN_X,
        y: ORIGIN_Y,
        width: CARD_W,
        height: CARD_H,
        zIndex: 1,
        metadata: {
          presetId: "ecommerce",
          presetName: "生成电商套图",
          demandType: "ecommerce_bundle",
          userIntent: "填写这套图要完成的商品展示目标",
          productFacts: "填写已确认的产品事实和卖点",
          channel: "",
          audience: "",
        },
      },
      {
        id: "starter-reference",
        kind: "reference",
        label: "参考素材",
        x: ORIGIN_X + CARD_W + GAP,
        y: ORIGIN_Y,
        width: CARD_W,
        height: CARD_H,
        zIndex: 2,
        metadata: { referenceRole: "style", assetName: "等待上传参考图" },
      },
      {
        id: "starter-reverse",
        kind: "reversePrompt",
        label: "反推提示词",
        x: ORIGIN_X + (CARD_W + GAP) * 2,
        y: ORIGIN_Y,
        width: CARD_W,
        height: CARD_H,
        zIndex: 3,
        metadata: {
          reversePromptEnabled: false,
          reversePromptModel: "auto",
          reversePromptFocus: "all",
          reversePromptStatus: "idle",
        },
      },
      {
        id: "starter-prompt",
        kind: "prompt",
        label: "图片提示词",
        x: ORIGIN_X,
        y: ORIGIN_Y + CARD_H + GAP,
        width: CARD_W,
        height: CARD_H,
        zIndex: 4,
        metadata: { prompt: "连接需求、参考素材和反推节点后，在这里确认最终提示词。" },
      },
      {
        id: "starter-model",
        kind: "model",
        label: "图片模型",
        x: ORIGIN_X + CARD_W + GAP,
        y: ORIGIN_Y + CARD_H + GAP,
        width: CARD_W,
        height: CARD_H,
        zIndex: 5,
        metadata: { modelName: "gpt-image-2", modelVersion: "gpt-image-2", aspectRatio: "1:1", size: "1024x1024", quality: "auto" },
      },
      {
        id: "starter-bundle",
        kind: "bundle",
        label: "套图容器",
        x: ORIGIN_X + (CARD_W + GAP) * 2,
        y: ORIGIN_Y + CARD_H + GAP,
        width: CARD_W,
        height: CARD_H,
        zIndex: 6,
        metadata: { generationCount: 6, aspectRatio: "1:1", size: "1024x1024", quality: "auto", cardPurpose: "主图、细节图、卖点图、参数图" },
      },
      {
        id: "starter-generate",
        kind: "generate",
        label: "图片生成",
        x: ORIGIN_X + (CARD_W + GAP) * 3,
        y: ORIGIN_Y + CARD_H + GAP,
        width: CARD_W,
        height: CARD_H,
        zIndex: 7,
        metadata: { modelName: "gpt-image-2", taskStatus: "等待输入" },
      },
    ],
    edges: [
      { id: "starter-edge-requirement-prompt", fromId: "starter-requirement", toId: "starter-prompt", label: "需求" },
      { id: "starter-edge-reference-reverse", fromId: "starter-reference", toId: "starter-reverse", label: "参考" },
      { id: "starter-edge-reverse-prompt", fromId: "starter-reverse", toId: "starter-prompt", label: "反推结果" },
      { id: "starter-edge-prompt-generate", fromId: "starter-prompt", toId: "starter-generate", fromPort: "prompt", toPort: "prompt", dataType: "prompt", label: "提示词" },
      { id: "starter-edge-model-generate", fromId: "starter-model", toId: "starter-generate", fromPort: "config", toPort: "config", dataType: "model-config", label: "规格" },
    ],
    groups: [],
    viewport: { x: 0, y: 0, scale: 1 },
    version: 1,
    planner_plan: null,
  };
}

const PLAN_TEMPLATES = [
  ["主视觉", "产品主图", "主体居中，信息层级清晰", "突出产品本体与核心卖点"],
  ["卖点说明", "功能/材质细节", "局部特写与卖点标注", "展示产品细节、材质和关键功能"],
  ["场景使用", "生活方式场景", "真实使用场景，人物或环境辅助", "体现目标用户的使用情境与价值"],
  ["对比证明", "效果/前后对比", "左右对比或步骤展示", "用视觉对比说明产品带来的变化"],
  ["信任背书", "品质与服务", "克制留白，突出可信信息", "呈现品质、服务、认证或保障信息"],
  ["规格信息", "尺寸/参数", "信息图式排版", "清晰呈现规格、尺寸和购买要点"],
  ["使用步骤", "操作流程", "三到四步横向流程", "让用户快速理解产品如何使用"],
  ["人群适配", "目标人群场景", "面向目标人群的生活化画面", "让目标用户看到自己使用产品的样子"],
  ["情绪氛围", "品牌情绪图", "有识别度的光线与构图", "强化品牌气质和记忆点"],
  ["节日渠道", "渠道主题图", "适配活动或渠道的版式", "根据投放渠道调整视觉重点"],
  ["细节补充", "产品细节", "近距离材质与工艺展示", "补充前面画面没有讲清的细节"],
  ["痛点回应", "用户痛点", "问题到解决方案的叙事", "直接回应用户购买前的顾虑"],
  ["方案组合", "组合展示", "多个产品或配件的关系展示", "说明产品组合与搭配方式"],
  ["购买引导", "行动信息", "重点信息与行动区域清楚", "突出购买、咨询或下一步行动"],
  ["品牌收束", "品牌收尾", "统一品牌视觉的收束画面", "让整套图片在品牌印象中结束"],
  ["备用候选", "备用视觉方向", "保持品牌一致的替代构图", "为审核和渠道适配保留一个可替换方向"],
] as const;

function buildPlannerPlan(slotCount: number, sourceContext: string): PlannerPlan {
  const context = sourceContext.trim() || "待补充产品资料";
  const frames: PlannerFrame[] = Array.from({ length: slotCount }, (_, index) => {
    const template = PLAN_TEMPLATES[index % PLAN_TEMPLATES.length];
    return {
      id: `frame-${index + 1}`,
      index: index + 1,
      purpose: template[1],
      layout: template[2],
      copy_suggestion: template[0],
      prompt: `${context}；${template[3]}；${template[2]}；画面适合电商套图，产品事实准确，避免虚构参数和品牌信息。`,
      card_type: CARD_TYPE_SEQUENCE[index % CARD_TYPE_SEQUENCE.length],
      status: "draft",
      task_id: null,
    };
  });
  return {
    id: `plan-${Date.now()}`,
    version: 1,
    status: "draft",
    slot_count: slotCount,
    planner_model: null,
    source_context: context,
    frames,
  };
}

const PALETTE: { kind: CanvasItem["kind"]; label: string; desc: string }[] = [
  { kind: "requirement", label: "需求/模板", desc: "用途、产品事实、渠道" },
  { kind: "asset", label: "素材", desc: "产品图、参考图、品牌资产" },
  { kind: "reference", label: "参考节点", desc: "风格、参数、版式来源" },
  { kind: "reversePrompt", label: "反推提示词", desc: "从参考图推断" },
  { kind: "prompt", label: "图片提示词", desc: "组装/编辑/版本" },
  { kind: "model", label: "图片模型", desc: "gpt-image-2 模型与规格" },
  { kind: "generate", label: "图片生成", desc: "创建异步生成任务" },
  { kind: "result", label: "结果", desc: "候选图、版本" },
  { kind: "edit", label: "修改/重绘", desc: "基于结果补充修改要求" },
  { kind: "bundle", label: "分组/版式", desc: "数量、比例、清晰度" },
  { kind: "export", label: "导出", desc: "下载或输出素材包" },
];

const KIND_DEFAULT_LABEL: Record<CanvasItem["kind"], string> = {
  requirement: "需求/模板",
  asset: "素材",
  reference: "参考节点",
  reversePrompt: "反推提示词",
  prompt: "图片提示词",
  model: "图片模型",
  generate: "图片生成",
  result: "结果",
  edit: "修改/重绘",
  upscale: "超分辨率",
  bundle: "分组/版式",
  bundleCard: "套图卡片",
  export: "导出",
};

function findNextPosition(items: CanvasItem[]): { x: number; y: number } {
  if (items.length === 0) return { x: ORIGIN_X, y: ORIGIN_Y };
  const last = items[items.length - 1];
  const nextX = last.x + CARD_W + GAP;
  if (nextX + CARD_W > 1200) {
    return { x: ORIGIN_X, y: last.y + CARD_H + GAP };
  }
  return { x: nextX, y: last.y };
}

function cloneScene(scene: CanvasScene): CanvasScene {
  return JSON.parse(JSON.stringify(scene)) as CanvasScene;
}

function sceneWithoutTransientPreviews(scene: CanvasScene): CanvasScene {
  const next = cloneScene(scene);
  next.items = next.items.map((item) => {
    if (item.imageUrl?.startsWith("blob:")) {
      const { imageUrl: _imageUrl, ...withoutPreview } = item;
      return withoutPreview;
    }
    return item;
  });
  return next;
}

function autoLayoutScene(scene: CanvasScene): CanvasScene {
  const visibleItems = scene.items.filter((item) => !item.hidden);
  const itemIds = new Set(visibleItems.map((item) => item.id));
  const incoming = new Map<string, number>(visibleItems.map((item) => [item.id, 0]));
  const outgoing = new Map<string, string[]>(visibleItems.map((item) => [item.id, []]));
  scene.edges.forEach((edge) => {
    if (!itemIds.has(edge.fromId) || !itemIds.has(edge.toId)) return;
    incoming.set(edge.toId, (incoming.get(edge.toId) ?? 0) + 1);
    outgoing.get(edge.fromId)?.push(edge.toId);
  });

  const layers = new Map<string, number>();
  const queue = visibleItems.filter((item) => (incoming.get(item.id) ?? 0) === 0).map((item) => item.id);
  queue.forEach((id) => layers.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const nextLayer = (layers.get(id) ?? 0) + 1;
    (outgoing.get(id) ?? []).forEach((targetId) => {
      layers.set(targetId, Math.max(layers.get(targetId) ?? 0, nextLayer));
      const nextIncoming = (incoming.get(targetId) ?? 1) - 1;
      incoming.set(targetId, nextIncoming);
      if (nextIncoming === 0) queue.push(targetId);
    });
  }

  const maxLayer = Math.max(-1, ...Array.from(layers.values()));
  visibleItems.forEach((item, index) => {
    if (!layers.has(item.id)) layers.set(item.id, maxLayer + 1 + Math.floor(index / 4));
  });
  const layerItems = new Map<number, CanvasItem[]>();
  visibleItems.forEach((item) => {
    const layer = layers.get(item.id) ?? 0;
    const list = layerItems.get(layer) ?? [];
    list.push(item);
    layerItems.set(layer, list);
  });
  layerItems.forEach((items) => items.sort((a, b) => a.y - b.y || a.x - b.x));

  const positions = new Map<string, { x: number; y: number }>();
  layerItems.forEach((items, layer) => {
    items.forEach((item, index) => {
      positions.set(item.id, { x: ORIGIN_X + layer * (CARD_W + 80), y: ORIGIN_Y + index * (CARD_H + GAP) });
    });
  });
  return {
    ...scene,
    items: scene.items.map((item) => {
      const position = positions.get(item.id);
      return position && !item.locked ? { ...item, ...position } : item;
    }),
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("404") || error.message.includes("画布不存在"));
}

export function CanvasStage({ taskId, onBack }: CanvasStageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeTaskId = searchParams.get("taskId");
  const activeTaskId = taskId ?? routeTaskId;
  const handleBack = onBack ?? (() => navigate("/tools/image"));
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scene, setScene] = useState<CanvasScene>(() => buildEmptyScene());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, scale: 1 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [persistedVersion, setPersistedVersion] = useState<number | null>(null);
  const [persistedSceneId, setPersistedSceneId] = useState<string | null>(null);
  const [imageCapabilities, setImageCapabilities] = useState<import("../../../types").ImageModelCapability[]>([]);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const assetPreviewUrlsRef = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [plannerPlan, setPlannerPlan] = useState<PlannerPlan | null>(null);
  const [plannerCount, setPlannerCount] = useState(6);
  const [plannerSource, setPlannerSource] = useState("");
  const historyRef = useRef<{ past: CanvasScene[]; future: CanvasScene[]; applying: boolean }>({
    past: [],
    future: [],
    applying: false,
  });
  const previousSceneRef = useRef(scene);
  const [, setHistoryRevision] = useState(0);
  const nextIdRef = useRef(1);
  const nextEdgeIdRef = useRef(1);
  const nextGroupIdRef = useRef(1);

  const hydrateSceneAssetPreviews = useCallback(async (sourceScene: CanvasScene): Promise<CanvasScene> => {
    const assetIds = Array.from(
      new Set(
        sourceScene.items.flatMap((item) => [
          item.assetId,
          ...(item.metadata?.resultAssetIds ?? []),
        ].filter((assetId): assetId is string => Boolean(assetId))),
      ),
    );
    if (!assetIds.length) return sourceScene;
    const entries = await Promise.all(assetIds.map(async (assetId) => {
      const url = await getImageAssetPreviewUrl(assetId).catch(() => null);
      return [assetId, url] as const;
    }));
    const previews = new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
    previews.forEach((url) => assetPreviewUrlsRef.current.push(url));
    if (!previews.size) return sourceScene;
    return {
      ...sourceScene,
      items: sourceScene.items.map((item) => {
        const assetId = item.assetId ?? item.metadata?.resultAssetIds?.[0];
        const preview = assetId ? previews.get(assetId) : undefined;
        return preview ? { ...item, imageUrl: preview } : item;
      }),
    };
  }, []);

  useEffect(() => () => {
    assetPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    assetPreviewUrlsRef.current = [];
  }, []);

  useEffect(() => {
    getImageModelCapabilities().then(setImageCapabilities).catch(() => setImageCapabilities([]));
  }, []);

  useEffect(() => {
    if (loading) {
      previousSceneRef.current = scene;
      historyRef.current = { past: [], future: [], applying: false };
      return;
    }
    if (historyRef.current.applying) {
      historyRef.current.applying = false;
      previousSceneRef.current = scene;
      setHistoryRevision((value) => value + 1);
      return;
    }
    if (previousSceneRef.current !== scene) {
      historyRef.current.past = [...historyRef.current.past.slice(-49), cloneScene(previousSceneRef.current)];
      historyRef.current.future = [];
      previousSceneRef.current = scene;
      setHistoryRevision((value) => value + 1);
    }
  }, [scene, loading]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      setStageSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!activeTaskId) {
      const emptyScene = buildEmptyScene();
      setScene(emptyScene);
      setViewport(emptyScene.viewport);
      setSelectedIds([]);
      setPersistedVersion(null);
      setPersistedSceneId(null);
      setPlannerPlan(null);
      setPlannerSource("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    getImageTask(activeTaskId)
      .then(async (task) => {
        if (cancelled) return;
        const fallbackScene = buildSceneFromTask(task);
        const hydratedFallback = await hydrateSceneAssetPreviews(fallbackScene);
        if (cancelled) return;
        setScene(hydratedFallback);
        setViewport(hydratedFallback.viewport);
        setPlannerPlan(hydratedFallback.planner_plan ?? null);
        setPlannerSource(hydratedFallback.items.find((item) => item.kind === "requirement")?.metadata?.userIntent ?? "");
        setSelectedIds([]);
        return getLatestCanvasScene(activeTaskId)
          .then(async (response) => {
            if (cancelled) return;
            const hydratedScene = await hydrateSceneAssetPreviews(response.scene);
            if (cancelled) return;
            setScene(hydratedScene);
            setViewport(hydratedScene.viewport);
            setPlannerPlan(hydratedScene.planner_plan ?? null);
            setPlannerSource(hydratedScene.planner_plan?.source_context ?? "");
            setSelectedIds([]);
            setPersistedVersion(response.version);
            setPersistedSceneId(response.id);
          })
          .catch((e) => {
            if (!cancelled && !isNotFoundError(e)) {
              setError(e instanceof Error ? e.message : "加载最近画布版本失败");
            }
          });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载任务失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTaskId, hydrateSceneAssetPreviews]);

  const handleCreatePlannerDraft = useCallback(() => {
    const draft = buildPlannerPlan(plannerCount, plannerSource || scene.items.find((item) => item.kind === "requirement")?.metadata?.userIntent || "");
    setPlannerPlan(draft);
    setScene((current) => ({ ...current, planner_plan: draft }));
    setMessage("已生成可编辑的套图规划草案；规划模型尚未接入，当前内容来自结构模板。");
  }, [plannerCount, plannerSource, scene.items]);

  const handleUpdatePlannerFrame = useCallback((frameId: string, patch: Partial<PlannerFrame>) => {
    setPlannerPlan((current) => {
      if (!current) return current;
      const next = { ...current, frames: current.frames.map((frame) => frame.id === frameId ? { ...frame, ...patch } : frame) };
      setScene((sceneValue) => ({ ...sceneValue, planner_plan: next }));
      return next;
    });
  }, []);

  const handleApplyPlanner = useCallback(() => {
    if (!plannerPlan) return;
    setScene((current) => {
      const bundleId = `bundle-${plannerPlan.id}`;
      const start = findNextPosition(current.items);
      const bundleItem: CanvasItem = {
        id: bundleId,
        kind: "bundle",
        label: `${plannerPlan.slot_count} 张套图容器`,
        x: start.x,
        y: start.y,
        width: CARD_W,
        height: CARD_H,
        zIndex: current.items.length + 1,
        metadata: {
          generationCount: plannerPlan.slot_count,
          aspectRatio: "1:1",
          size: "1024x1024",
          quality: "auto",
          cardPurpose: "主图、细节图、卖点图、参数图",
          prompt: plannerPlan.source_context,
        },
      };
      const cardItems = plannerPlan.frames.map((frame, index) => ({
        id: `${bundleId}-${frame.id}`,
        kind: "bundleCard" as const,
        label: `${String(index + 1).padStart(2, "0")} ${frame.purpose}`,
        x: start.x + (index % 4) * (CARD_W + GAP),
        y: start.y + CARD_H + GAP + Math.floor(index / 4) * (CARD_H + GAP),
        width: CARD_W,
        height: CARD_H,
        zIndex: current.items.length + index + 2,
        groupId: bundleId,
        metadata: {
          containerId: bundleId,
          cardIndex: index + 1,
          cardType: frame.card_type ?? CARD_TYPE_SEQUENCE[index % CARD_TYPE_SEQUENCE.length],
          cardPurpose: frame.purpose,
          copySuggestion: frame.copy_suggestion,
          prompt: frame.prompt,
          aspectRatio: "1:1",
          size: "1024x1024",
          quality: "auto",
          sourceNodeIds: current.items.filter((item) => item.kind === "reference" || item.kind === "asset").map((item) => item.id),
        },
      }));
      const cardEdges: CanvasEdge[] = cardItems.flatMap((card) => [
        { id: `${card.id}-container`, fromId: bundleId, toId: card.id, label: "容器" },
        ...((card.metadata?.sourceNodeIds ?? []).map((sourceId) => ({ id: `${sourceId}-${card.id}`, fromId: sourceId, toId: card.id, label: "参考" }))),
      ]);
      const group: CanvasGroup = { id: bundleId, name: `${plannerPlan.slot_count} 张套图`, itemIds: [bundleId, ...cardItems.map((item) => item.id)], color: "#db2777" };
      return { ...current, items: [...current.items, bundleItem, ...cardItems], edges: [...current.edges, ...cardEdges], groups: [...current.groups, group], planner_plan: plannerPlan };
    });
    setMessage("套图容器已放入画布；每张图片卡片都可以独立编辑用途、提示词和参考来源。");
  }, [plannerPlan]);

  const handleGenerateBundleCards = useCallback((bundleId: string) => {
    setScene((current) => {
      const bundle = current.items.find((item) => item.id === bundleId && item.kind === "bundle");
      if (!bundle) return current;
      const count = Math.max(1, Math.floor(bundle.metadata?.generationCount ?? 1));
      const oldCardIds = new Set(current.items.filter((item) => item.metadata?.containerId === bundleId).map((item) => item.id));
      const sourceIds = current.items
        .filter((item) => item.id !== bundleId && ["requirement", "reference", "asset", "reversePrompt", "prompt", "model"].includes(item.kind))
        .map((item) => item.id);
      const newCards: CanvasItem[] = Array.from({ length: count }, (_, index) => ({
        id: `${bundleId}-card-${Date.now()}-${index + 1}`,
        kind: "bundleCard",
        label: `${String(index + 1).padStart(2, "0")} ${CARD_TYPE_SEQUENCE[index % CARD_TYPE_SEQUENCE.length]}`,
        x: bundle.x + (index % 4) * (CARD_W + GAP),
        y: bundle.y + CARD_H + GAP + Math.floor(index / 4) * (CARD_H + GAP),
        width: CARD_W,
        height: CARD_H,
        zIndex: current.items.length + index + 1,
        groupId: bundleId,
        metadata: {
          containerId: bundleId,
          cardIndex: index + 1,
          cardType: CARD_TYPE_SEQUENCE[index % CARD_TYPE_SEQUENCE.length],
          cardPurpose: CARD_TYPE_SEQUENCE[index % CARD_TYPE_SEQUENCE.length] === "parameter" ? "填写产品尺寸、材质和规格" : "填写这张图片要表达的内容",
          prompt: bundle.metadata?.prompt ?? "",
          aspectRatio: bundle.metadata?.aspectRatio ?? "1:1",
          size: bundle.metadata?.size ?? "1024x1024",
          quality: bundle.metadata?.quality ?? "auto",
          sourceNodeIds: sourceIds,
        },
      }));
      const newEdges: CanvasEdge[] = newCards.flatMap((card) => [
        { id: `${card.id}-container`, fromId: bundleId, toId: card.id, label: "容器" },
        ...sourceIds.map((sourceId) => ({ id: `${sourceId}-${card.id}`, fromId: sourceId, toId: card.id, label: "输入" })),
      ]);
      const nextGroup = current.groups.map((group) => group.id === bundleId
        ? { ...group, itemIds: [bundleId, ...newCards.map((card) => card.id)] }
        : group);
      return {
        ...current,
        items: [...current.items.filter((item) => !oldCardIds.has(item.id)), ...newCards],
        edges: [...current.edges.filter((edge) => !oldCardIds.has(edge.fromId) && !oldCardIds.has(edge.toId)), ...newEdges],
        groups: nextGroup,
      };
    });
    setMessage("套图容器已按当前数量重新生成图片卡片；每张卡片都可以继续编辑。");
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await saveCanvasScene({
        task_id: activeTaskId,
        name: "未命名画布",
        scene: sceneWithoutTransientPreviews({ ...scene, viewport }),
      });
      setScene((current) => ({ ...current, viewport }));
      setPersistedVersion(response.version);
      setPersistedSceneId(response.id);
      setMessage(`画布已保存，版本：${response.version}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存画布失败");
    } finally {
      setSaving(false);
    }
  }, [scene, activeTaskId, viewport]);

  const handleLoadLatest = useCallback(async () => {
    if (!activeTaskId) {
      setError("当前画布没有关联图片任务，无法加载最近版本");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await getLatestCanvasScene(activeTaskId);
      setScene(response.scene);
      setViewport(response.scene.viewport);
      setSelectedIds([]);
      setPersistedVersion(response.version);
      setPersistedSceneId(response.id);
      setMessage(`已加载画布版本：${response.version}`);
    } catch (e) {
      if (isNotFoundError(e)) {
        setMessage("暂无已保存的画布版本，已保留当前画布");
      } else {
        setError(e instanceof Error ? e.message : "加载最近画布版本失败");
      }
    } finally {
      setLoading(false);
    }
  }, [activeTaskId]);

  const handleExportProject = useCallback(async () => {
    if (!persistedSceneId) {
      setError("请先保存画布，再导出后端项目 JSON");
      return;
    }
    try {
      const project = await exportCanvasProject(persistedSceneId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "image-workflow.json";
      link.click();
      URL.revokeObjectURL(url);
      setMessage("项目 JSON 已从后端导出");
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出项目失败");
    }
  }, [persistedSceneId]);

  const handleImportProject = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { schema_version?: string; name?: string; task_id?: string | null; scene?: CanvasScene };
      if (parsed.schema_version && parsed.schema_version !== "image-workbench.project.v1") {
        throw new Error("不支持的画布 JSON 版本");
      }
      if (!parsed.scene || !Array.isArray(parsed.scene.items) || !Array.isArray(parsed.scene.edges)) {
        throw new Error("JSON 不是有效的图片工作流项目");
      }
      const response = await importCanvasProject({
        schema_version: parsed.schema_version,
        name: parsed.name ?? "导入的图片工作流",
        task_id: activeTaskId,
        scene: parsed.scene,
      });
      setScene(response.scene);
      setViewport(response.scene.viewport);
      setSelectedIds([]);
      setPersistedVersion(response.version);
      setPersistedSceneId(response.id);
      setMessage(`项目 JSON 已导入并保存，版本：${response.version}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入项目失败");
    } finally {
      if (projectFileInputRef.current) projectFileInputRef.current.value = "";
    }
  }, [activeTaskId]);

  const handleViewportChange = useCallback((nextViewport: CanvasViewport) => {
    setViewport(nextViewport);
    setScene((current) => ({ ...current, viewport: nextViewport }));
  }, []);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setScene((s) => ({
      ...s,
      items: s.items.map((it) => (it.id === id ? { ...it, x, y } : it)),
    }));
  }, []);

  const handleMoveMany = useCallback((ids: string[], dx: number, dy: number) => {
    setScene((s) => ({
      ...s,
      items: s.items.map((it) =>
        ids.includes(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it
      ),
    }));
  }, []);

  const handleResize = useCallback(
    (id: string, width: number, height: number, rotation: number) => {
      setScene((s) => ({
        ...s,
        items: s.items.map((it) =>
          it.id === id ? { ...it, width, height, rotation } : it
        ),
      }));
    },
    []
  );

  const handleConnect = useCallback((fromId: string, toId: string, fromPortId?: string, toPortId?: string) => {
    setScene((s) => {
      // 避免重复连线
      if (s.edges.some((e) => e.fromId === fromId && e.toId === toId && (e.fromPort ?? "") === (fromPortId ?? "") && (e.toPort ?? "") === (toPortId ?? ""))) {
        return s;
      }
      const fromItem = s.items.find((item) => item.id === fromId);
      const toItem = s.items.find((item) => item.id === toId);
      if (!fromItem || !toItem || fromId === toId) {
        setMessage("不能连接同一个节点或不存在的节点。");
        return s;
      }
      const candidate = validateCanvasConnection(
        fromItem.kind,
        toItem.kind,
        false,
        fromPortId,
        toPortId,
      );
      if ("error" in candidate) {
        setMessage(candidate.error);
        return s;
      }
      const occupied = s.edges.some((edge) => {
        if (edge.toId !== toId) return false;
        // 旧版连线没有端口信息，只能按目标节点的默认输入处理。
        return edge.toPort ? edge.toPort === candidate.toPort.id : !candidate.toPort.multiple;
      });
      if (occupied && !candidate.toPort.multiple) {
        setMessage("这个输入端口已经有来源，请先删除原连线。");
        return s;
      }
      const edgeLabel = fromItem?.kind === "reference" || fromItem?.kind === "asset"
        ? "参考"
        : fromItem?.kind === "prompt" || fromItem?.kind === "reversePrompt"
          ? "提示词"
          : "输入";
      const edge: CanvasEdge = {
        id: `edge-${nextEdgeIdRef.current++}`,
        fromId,
        toId,
        fromPort: candidate.fromPort.id,
        toPort: candidate.toPort.id,
        dataType: candidate.fromPort.dataType,
        label: edgeLabel,
      };
      return {
        ...s,
        edges: [...s.edges, edge],
        items: s.items.map((item) => item.id === toId
          ? { ...item, metadata: { ...item.metadata, sourceNodeIds: Array.from(new Set([...(item.metadata?.sourceNodeIds ?? []), fromId])) } }
          : item),
      };
    });
  }, []);

  const handleDisconnect = useCallback((fromId: string, toId: string, fromPortId?: string, toPortId?: string) => {
    setScene((s) => ({
      ...s,
      edges: s.edges.filter((edge) => !(edge.fromId === fromId && edge.toId === toId && (!fromPortId || edge.fromPort === fromPortId) && (!toPortId || edge.toPort === toPortId))),
      items: s.items.map((item) => item.id === toId
        ? { ...item, metadata: { ...item.metadata, sourceNodeIds: (item.metadata?.sourceNodeIds ?? []).filter((id) => id !== fromId) } }
        : item),
    }));
  }, []);

  const handleBatchConnect = useCallback(() => {
    if (selectedIds.length !== 1) {
      setMessage("请先只选中一个来源节点，再执行批量连接。");
      return;
    }
    const fromId = selectedIds[0];
    setScene((s) => {
      const fromItem = s.items.find((item) => item.id === fromId);
      if (!fromItem) return s;
      let edges = [...s.edges];
      const connectedTargetIds: string[] = [];
      for (const target of s.items) {
        if (target.id === fromId || target.hidden) continue;
        const candidate = validateCanvasConnection(fromItem.kind, target.kind, false);
        if ("error" in candidate) continue;
        const exists = edges.some((edge) => edge.fromId === fromId && edge.toId === target.id && edge.toPort === candidate.toPort.id);
        const occupied = edges.some((edge) => edge.toId === target.id && (edge.toPort ?? candidate.toPort.id) === candidate.toPort.id);
        if (exists || (occupied && !candidate.toPort.multiple)) continue;
        edges.push({ id: `edge-${nextEdgeIdRef.current++}`, fromId, toId: target.id, fromPort: candidate.fromPort.id, toPort: candidate.toPort.id, dataType: candidate.fromPort.dataType, label: "批量输入" });
        connectedTargetIds.push(target.id);
      }
      if (!connectedTargetIds.length) return s;
      setMessage(`已批量连接 ${connectedTargetIds.length} 个兼容目标；不兼容或已占用端口已跳过。`);
      return {
        ...s,
        edges,
        items: s.items.map((item) => connectedTargetIds.includes(item.id)
          ? { ...item, metadata: { ...item.metadata, sourceNodeIds: Array.from(new Set([...(item.metadata?.sourceNodeIds ?? []), fromId])) } }
          : item),
      };
    });
  }, [selectedIds]);

  const handleUpdateNode = useCallback((id: string, patch: Partial<CanvasItem>) => {
    setScene((s) => ({
      ...s,
      items: s.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }, []);

  const handleUpdateNodeMetadata = useCallback((id: string, patch: Partial<CanvasItemMetadata>) => {
    setScene((s) => ({
      ...s,
      items: s.items.map((item) => item.id === id
        ? { ...item, metadata: { ...item.metadata, ...patch } }
        : item),
    }));
  }, []);

  const handleUploadNodeAsset = useCallback(async (id: string, file: File) => {
    handleUpdateNodeMetadata(id, { assetName: file.name, uploadStatus: "uploading" });
    try {
      const asset = await uploadImageAsset(file);
      const previewUrl = await getImageAssetPreviewUrl(asset.id);
      assetPreviewUrlsRef.current.push(previewUrl);
      handleUpdateNode(id, { assetId: asset.id, imageUrl: previewUrl, label: asset.original_name });
      handleUpdateNodeMetadata(id, { assetName: asset.original_name, uploadStatus: "uploaded" });
      setMessage(`参考素材已上传：${asset.original_name}`);
    } catch (e) {
      handleUpdateNodeMetadata(id, { uploadStatus: "failed" });
      setError(e instanceof Error ? e.message : "参考素材上传失败");
    }
  }, [handleUpdateNode, handleUpdateNodeMetadata]);

  const handleExecuteEdit = useCallback(async (editId: string) => {
    const editNode = scene.items.find((item) => item.id === editId && item.kind === "edit");
    if (!editNode) return;
    const imageEdge = scene.edges.find((edge) => edge.toId === editId && (edge.toPort ?? "image") === "image");
    const imageSource = imageEdge ? scene.items.find((item) => item.id === imageEdge.fromId) : undefined;
    const promptEdge = scene.edges.find((edge) => edge.toId === editId && edge.toPort === "prompt");
    const promptSource = promptEdge ? scene.items.find((item) => item.id === promptEdge.fromId) : undefined;
    const assetId = imageSource?.assetId ?? imageSource?.metadata?.resultAssetIds?.[0];
    if (!assetId) {
      setError("修改节点需要连接一个已有图片资产的节点。请先执行上游生成或上传素材。");
      return;
    }
    const prompt = [editNode.metadata?.editPrompt, promptSource?.metadata?.prompt, promptSource?.metadata?.assembledPrompt].filter(Boolean).join("\n").trim();
    if (!prompt) {
      setError("请先填写修改要求，或连接一个提示词节点。");
      return;
    }
    handleUpdateNodeMetadata(editId, { taskStatus: "创建中", taskError: undefined });
    try {
      const task = await createImageTask({
        preset_id: "template",
        user_intent: prompt,
        reference_asset_id: assetId,
        workspace_mode: "canvas",
        generation_mode: "image2image",
        edited_description: prompt,
        model: editNode.metadata?.modelName ?? imageSource?.metadata?.modelName ?? "gpt-image-2",
        size: editNode.metadata?.size ?? imageSource?.metadata?.size ?? "1024x1024",
        aspect_ratio: editNode.metadata?.aspectRatio ?? imageSource?.metadata?.aspectRatio ?? "1:1",
        quality: editNode.metadata?.quality ?? imageSource?.metadata?.quality ?? "auto",
      });
      handleUpdateNodeMetadata(editId, { taskId: task.task_id, taskStatus: "处理中" });
      let status = await getImageTask(task.task_id);
      while (["quoted", "reserved", "running"].includes(status.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        status = await getImageTask(task.task_id);
      }
      if (status.status !== "succeeded") throw new Error(status.error || "图片编辑任务失败");
      const resultEdge = scene.edges.find((edge) => edge.fromId === editId && (edge.fromPort ?? "image") === "image");
      const resultId = resultEdge?.toId;
      const resultAssetId = status.result_asset_ids?.[0];
      const resultUrl = resultAssetId
        ? await getImageAssetPreviewUrl(resultAssetId).then((url) => {
          assetPreviewUrlsRef.current.push(url);
          return url;
        }).catch(() => status.result_image_url ?? undefined)
        : status.result_image_url ?? undefined;
      setScene((current) => ({ ...current, items: current.items.map((item) => {
        if (item.id === editId) return { ...item, metadata: { ...item.metadata, taskId: task.task_id, taskStatus: "已完成", resultAssetIds: status.result_asset_ids ?? [] }, imageUrl: resultUrl, assetId: resultAssetId };
        if (resultId && item.id === resultId) return { ...item, imageUrl: resultUrl, assetId: resultAssetId, metadata: { ...item.metadata, taskId: task.task_id, taskStatus: "已完成", resultAssetIds: status.result_asset_ids ?? [] } };
        return item;
      }) }));
      setMessage("修改任务已完成，新图片资产已回流到结果节点。");
    } catch (e) {
      const detail = e instanceof Error ? e.message : "图片编辑任务失败";
      handleUpdateNodeMetadata(editId, { taskStatus: "失败", taskError: detail });
      setError(detail);
    }
  }, [scene, handleUpdateNodeMetadata]);

  const handleExecuteGenerate = useCallback(async (generateId: string) => {
    const generateNode = scene.items.find((item) => item.id === generateId && item.kind === "generate");
    if (!generateNode) return;
    const incoming = scene.edges.filter((edge) => edge.toId === generateId);
    const promptSources = incoming
      .filter((edge) => edge.toPort === "prompt" || (!edge.toPort && edge.dataType === "prompt"))
      .map((edge) => scene.items.find((item) => item.id === edge.fromId))
      .filter(Boolean) as CanvasItem[];
    const prompt = [
      generateNode.metadata?.prompt,
      ...promptSources.flatMap((source) => [
        source.metadata?.prompt,
        source.metadata?.assembledPrompt,
        source.metadata?.reversePrompt,
        source.metadata?.userIntent,
        source.metadata?.productFacts,
        ...(source.metadata?.sourceNodeIds ?? []).flatMap((sourceId) => {
          const upstream = scene.items.find((item) => item.id === sourceId);
          return [upstream?.metadata?.prompt, upstream?.metadata?.reversePrompt, upstream?.metadata?.assembledPrompt];
        }),
      ]),
    ].filter(Boolean).join("\n").trim();
    if (!prompt) {
      setError("图片生成节点需要连接提示词节点，或先填写提示词内容。");
      return;
    }
    const referenceAssets = incoming
      .filter((edge) => edge.toPort === "image" || (!edge.toPort && edge.dataType === "image"))
      .map((edge) => scene.items.find((item) => item.id === edge.fromId))
      .filter(Boolean)
      .map((source) => source as CanvasItem)
      .map((source, index) => ({
        asset_id: source.assetId ?? source.metadata?.resultAssetIds?.[0] ?? "",
        role: source.metadata?.referenceRole ?? (index === 0 ? "product" : "detail"),
      }))
      .filter((reference) => reference.asset_id);
    const configSource = incoming
      .filter((edge) => edge.toPort === "config" || (!edge.toPort && edge.dataType === "model-config"))
      .map((edge) => scene.items.find((item) => item.id === edge.fromId))
      .find(Boolean);
    const config = configSource?.metadata ?? generateNode.metadata ?? {};
    handleUpdateNodeMetadata(generateId, { taskStatus: "创建中", taskError: undefined });
    try {
      const task = await createImageTask({
        preset_id: "template",
        user_intent: prompt,
        reference_asset_ids: referenceAssets.map((reference) => reference.asset_id),
        reference_assets: referenceAssets,
        workspace_mode: "canvas",
        generation_mode: referenceAssets.length ? "image2image" : "text2image",
        model: config.modelName ?? "gpt-image-2",
        size: config.size ?? "1024x1024",
        aspect_ratio: config.aspectRatio ?? "1:1",
        quality: config.quality ?? "auto",
        generation_count: config.generationCount ?? 1,
      });
      handleUpdateNodeMetadata(generateId, { taskId: task.task_id, taskStatus: "处理中" });
      let status = await getImageTask(task.task_id);
      while (["quoted", "reserved", "running"].includes(status.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        status = await getImageTask(task.task_id);
      }
      if (status.status !== "succeeded") throw new Error(status.error || "图片生成任务失败");
      const resultAssetId = status.result_asset_ids?.[0];
      const resultUrl = resultAssetId
        ? await getImageAssetPreviewUrl(resultAssetId).then((url) => {
          assetPreviewUrlsRef.current.push(url);
          return url;
        }).catch(() => status.result_image_url ?? undefined)
        : status.result_image_url ?? undefined;
      setScene((current) => ({
        ...current,
        items: current.items.map((item) => {
          if (item.id === generateId) {
            return { ...item, assetId: resultAssetId, imageUrl: resultUrl, metadata: { ...item.metadata, taskId: task.task_id, taskStatus: "已完成", resultAssetIds: status.result_asset_ids ?? [], resultImageUrls: status.result_image_urls ?? [] } };
          }
          if (current.edges.some((edge) => edge.fromId === generateId && edge.toId === item.id && (edge.fromPort ?? "image") === "image")) {
            return { ...item, assetId: resultAssetId, imageUrl: resultUrl, metadata: { ...item.metadata, taskId: task.task_id, taskStatus: "已完成", resultAssetIds: status.result_asset_ids ?? [], resultImageUrls: status.result_image_urls ?? [] } };
          }
          return item;
        }),
      }));
      setMessage(`图片生成完成，${status.result_asset_ids?.length ?? 0} 个真实图片资产已回流。`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "图片生成任务失败";
      handleUpdateNodeMetadata(generateId, { taskStatus: "失败", taskError: detail });
      setError(detail);
    }
  }, [scene, handleUpdateNodeMetadata]);

  const handleGenerateReverseDraft = useCallback(async (id: string) => {
    const node = scene.items.find((item) => item.id === id && item.kind === "reversePrompt");
    if (!node) return;
    const connectedIds = new Set([
      ...(node.metadata?.sourceNodeIds ?? []),
      ...scene.edges.filter((edge) => edge.toId === id).map((edge) => edge.fromId),
    ]);
    const sources = scene.items.filter((item) => connectedIds.has(item.id));
    const assetIds = Array.from(new Set(
      sources.flatMap((source) => [source.assetId, ...(source.metadata?.resultAssetIds ?? [])])
        .filter((assetId): assetId is string => Boolean(assetId)),
    ));
    if (assetIds.length === 0) {
      setError("AI 反推提示词需要先连接一个真实图片素材节点。");
      return;
    }
    if (assetIds.length > 1) {
      setError("当前反推节点一次需要一张参考图片，请先只保留一个图片来源。");
      return;
    }
    const focus = node.metadata?.reversePromptFocus ?? "all";
    const snapshot = sceneWithoutTransientPreviews({ ...scene, viewport });
    setScene((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id
        ? { ...item, metadata: { ...item.metadata, reversePromptStatus: "running", taskError: undefined } }
        : item),
    }));
    setError(null);
    setMessage("正在保存当前画布快照并调用图片识别接口…");
    try {
      const execution = await executeCanvasNode({
        node_id: id,
        operation: "reverse_prompt",
        scene: snapshot,
        scene_id: persistedSceneId,
        task_id: activeTaskId,
        input_asset_ids: assetIds,
        input: { focus, model: node.metadata?.reversePromptModel ?? "auto" },
      });
      const reversePrompt = execution.result.reverse_prompt;
      if (typeof reversePrompt !== "string" || !reversePrompt.trim()) {
        throw new Error("图片识别接口没有返回有效提示词");
      }
      setScene((current) => ({
        ...current,
        items: current.items.map((item) => item.id === id
          ? {
            ...item,
            metadata: {
              ...item.metadata,
              reversePrompt: reversePrompt.trim(),
              reversePromptStatus: "succeeded",
              executionNote: `执行记录：${execution.execution_id}`,
            },
          }
          : item),
      }));
      setPersistedSceneId(execution.scene_id);
      setPersistedVersion(execution.scene_version);
      setMessage("AI 反推提示词已完成，并已记录本次执行时的画布快照。");
    } catch (e) {
      const detail = e instanceof Error ? e.message : "AI 反推提示词失败";
      setScene((current) => ({
        ...current,
        items: current.items.map((item) => item.id === id
          ? { ...item, metadata: { ...item.metadata, reversePromptStatus: "failed", taskError: detail } }
          : item),
      }));
      setError(detail);
    }
  }, [activeTaskId, persistedSceneId, scene, viewport]);

  const handleAddNode = useCallback((kind: CanvasItem["kind"]) => {
    setScene((s) => {
      const pos = findNextPosition(s.items);
      const id = `node-${nextIdRef.current++}`;
      const item: CanvasItem = {
        id,
        kind,
        label: KIND_DEFAULT_LABEL[kind],
        x: pos.x,
        y: pos.y,
        width: CARD_W,
        height: CARD_H,
        zIndex: s.items.length + 1,
        metadata: kind === "requirement"
          ? { demandType: "ecommerce_bundle", userIntent: "", productFacts: "" }
          : kind === "asset" || kind === "reference"
            ? { referenceRole: "style" }
            : kind === "reversePrompt"
              ? { reversePromptEnabled: false, reversePromptModel: "auto", reversePromptFocus: "all", reversePromptStatus: "idle" }
              : kind === "model"
                ? { modelName: "gpt-image-2", modelVersion: "gpt-image-2", aspectRatio: "1:1", size: "1024x1024", quality: "auto" }
                : kind === "bundle"
                  ? { generationCount: 6, aspectRatio: "1:1", size: "1024x1024", quality: "auto", cardPurpose: "主图、细节图、卖点图、参数图" }
                  : kind === "bundleCard"
                    ? { cardIndex: 1, cardType: "custom", cardPurpose: "", prompt: "", copySuggestion: "" }
                    : kind === "edit"
                      ? { editMode: "full", editPrompt: "", taskStatus: "待执行", executionNote: "等待图片编辑接口接入" }
                      : kind === "upscale"
                        ? { upscaleFactor: "2x", taskStatus: "待执行", executionNote: "等待超分辨率接口接入" }
                    : {},
      };
      return { ...s, items: [...s.items, item] };
    });
  }, []);

  const handleCreateFollowup = useCallback((sourceId: string, kind: "edit" | "upscale") => {
    setScene((current) => {
      const source = current.items.find((item) => item.id === sourceId);
      if (!source) return current;
      const nextItem = (
        nextKind: CanvasItem["kind"],
        x: number,
        y: number,
        metadata: CanvasItemMetadata = {},
      ): CanvasItem => ({
        id: `node-${nextIdRef.current++}`,
        kind: nextKind,
        label: KIND_DEFAULT_LABEL[nextKind],
        x,
        y,
        width: CARD_W,
        height: CARD_H,
        zIndex: current.items.length + 1,
        metadata,
      });
      const nextEdge = (fromId: string, toId: string, fromPort: string, toPort: string, label: string): CanvasEdge => ({
        id: `edge-${nextEdgeIdRef.current++}`,
        fromId,
        toId,
        fromPort,
        toPort,
        dataType: fromPort === "prompt" ? "prompt" : "image",
        label,
      });
      const startX = source.x + source.width + GAP;
      const process = nextItem(
        kind,
        startX,
        source.y,
        kind === "edit"
          ? { editMode: "full", editPrompt: "", taskStatus: "待执行", executionNote: "等待图片编辑接口接入" }
          : { upscaleFactor: "2x", taskStatus: "待执行", executionNote: "等待超分辨率接口接入" },
      );
      const result = nextItem("result", startX + CARD_W + GAP, source.y, { taskStatus: "等待上游执行" });
      const items = [process, result];
      const edges = [nextEdge(source.id, process.id, "image", "image", kind === "edit" ? "继续修改" : "高清处理"), nextEdge(process.id, result.id, "image", "image", "输出")];
      if (kind === "edit") {
        const prompt = nextItem("prompt", startX, source.y + CARD_H + GAP, { prompt: "在这里补充对当前图片的修改要求。" });
        items.push(prompt);
        edges.push(nextEdge(prompt.id, process.id, "prompt", "prompt", "修改要求"));
      }
      return { ...current, items: [...current.items, ...items], edges: [...current.edges, ...edges] };
    });
    setMessage(kind === "edit" ? "已创建修改节点，可在右侧补充修改要求。" : "已创建超分辨率节点，可在右侧选择放大倍率。留意：服务接口尚未接入。" );
  }, []);

  const handleOpenReversePrompt = useCallback(() => {
    const existing = scene.items.find((item) => item.kind === "reversePrompt");
    if (existing) {
      setSelectedIds([existing.id]);
      setMessage("已选中反推提示词节点，请在右侧设置反推范围和模型。");
      return;
    }
    handleAddNode("reversePrompt");
    setMessage("已添加反推提示词节点，请在右侧设置反推范围和模型。");
  }, [handleAddNode, scene.items]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setScene((s) => ({
      ...s,
      items: s.items.filter((it) => !selectedIds.includes(it.id)),
      edges: s.edges.filter(
        (e) => !selectedIds.includes(e.fromId) && !selectedIds.includes(e.toId)
      ),
    }));
    setSelectedIds([]);
  }, [selectedIds]);

  const handleGroupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    setScene((s) => {
      const groupId = `group-${nextGroupIdRef.current++}`;
      const group: CanvasGroup = {
        id: groupId,
        name: `分组 ${nextGroupIdRef.current - 1}`,
        itemIds: selectedIds,
        color: "#6366f1",
      };
      return {
        ...s,
        groups: [...s.groups, group],
        items: s.items.map((it) =>
          selectedIds.includes(it.id) ? { ...it, groupId } : it
        ),
      };
    });
    setSelectedIds([]);
  }, [selectedIds]);

  const handleUngroupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setScene((s) => {
      const groupIds = new Set(
        selectedIds
          .map((id) => s.items.find((it) => it.id === id)?.groupId)
          .filter(Boolean) as string[]
      );
      return {
        ...s,
        groups: s.groups.filter((g) => !groupIds.has(g.id)),
        items: s.items.map((it) =>
          it.groupId && groupIds.has(it.groupId)
            ? { ...it, groupId: undefined }
            : it
        ),
      };
    });
  }, [selectedIds]);

  const handleToggleLock = useCallback(() => {
    if (selectedIds.length === 0) return;
    setScene((s) => ({
      ...s,
      items: s.items.map((it) =>
        selectedIds.includes(it.id) ? { ...it, locked: !it.locked } : it
      ),
    }));
  }, [selectedIds]);

  const handleToggleHidden = useCallback(() => {
    if (selectedIds.length === 0) return;
    setScene((s) => ({
      ...s,
      items: s.items.map((it) =>
        selectedIds.includes(it.id) ? { ...it, hidden: !it.hidden } : it
      ),
    }));
  }, [selectedIds]);

  const handleBringToFront = useCallback(() => {
    if (selectedIds.length === 0) return;
    setScene((s) => {
      const maxZ = Math.max(...s.items.map((it) => it.zIndex), 0);
      return {
        ...s,
        items: s.items.map((it) =>
          selectedIds.includes(it.id) ? { ...it, zIndex: maxZ + 1 } : it
        ),
      };
    });
  }, [selectedIds]);

  const handleSendToBack = useCallback(() => {
    if (selectedIds.length === 0) return;
    setScene((s) => {
      const minZ = Math.min(...s.items.map((it) => it.zIndex), 0);
      return {
        ...s,
        items: s.items.map((it) =>
          selectedIds.includes(it.id) ? { ...it, zIndex: minZ - 1 } : it
        ),
      };
    });
  }, [selectedIds]);

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future = [cloneScene(scene), ...historyRef.current.future].slice(0, 50);
    historyRef.current.applying = true;
    setScene(previous);
    setViewport(previous.viewport);
  }, [scene]);

  const handleRedo = useCallback(() => {
    const next = historyRef.current.future.shift();
    if (!next) return;
    historyRef.current.past = [...historyRef.current.past, cloneScene(scene)].slice(-50);
    historyRef.current.applying = true;
    setScene(next);
    setViewport(next.viewport);
  }, [scene]);

  const handleAutoLayout = useCallback(() => {
    setScene((current) => autoLayoutScene(current));
    setMessage("已按工作流连接关系整理节点；锁定节点保持原位置。");
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z" && !event.shiftKey) {
        if (editing) return;
        event.preventDefault();
        handleUndo();
        return;
      }
      if (modifier && ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y")) {
        if (editing) return;
        event.preventDefault();
        handleRedo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !editing) {
        event.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteSelected, handleRedo, handleUndo]);

  const selectedItems = useMemo(
    () => scene.items.filter((i) => selectedIds.includes(i.id)),
    [scene, selectedIds]
  );

  const selectedItem = selectedItems.length === 1 ? selectedItems[0] : null;

  return (
    <div className="canvas-stage-page">
      <PlatformNav />
      <main className="canvas-stage-main">
        <header className="canvas-stage-header">
          <div>
            <h1>图片创作 · 高级工作台</h1>
            <p>
              {activeTaskId
                ? "已从基础模式任务还原工作流，可自由拖拽、缩放、旋转、连线、分组"
                : "空白画布，从左侧节点工具箱开始搭建素材导演台"}
            </p>
          </div>
          <div className="canvas-stage-persistence">
            <div className="canvas-stage-persistence__actions">
              <button type="button" onClick={handleUndo} aria-label="撤销">
                撤销
              </button>
              <button type="button" onClick={handleRedo} aria-label="重做">
                重做
              </button>
              <button type="button" onClick={handleAutoLayout} aria-label="自动整理工作流">
                自动整理
              </button>
              <button type="button" onClick={handleOpenReversePrompt}>
                反推提示词设置
              </button>
              <button type="button" onClick={handleSave} disabled={saving}>
                {saving ? "保存中…" : "保存画布"}
              </button>
              <button type="button" onClick={handleLoadLatest} disabled={loading}>
                加载最近版本
              </button>
              <button type="button" onClick={handleExportProject}>
                导出项目 JSON
              </button>
              <button type="button" onClick={() => projectFileInputRef.current?.click()}>
                导入项目 JSON
              </button>
              <input
                ref={projectFileInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImportProject(file);
                }}
              />
            </div>
            {persistedVersion !== null && <span>画布版本：{persistedVersion}</span>}
          </div>
          <button type="button" className="canvas-stage-back" onClick={handleBack}>
            返回基础模式
          </button>
        </header>

        {loading && <p className="canvas-stage-loading">加载任务中…</p>}
        {error && <p className="canvas-stage-error">{error}</p>}
        {message && <p className="canvas-stage-message">{message}</p>}

        <div className="canvas-stage-layout">
          {/* 左侧：节点工具箱 */}
          <aside className="canvas-stage-left">
            <h3>节点工具箱</h3>
            <p className="canvas-stage-left__hint">点击向画布追加节点</p>
            <ul className="canvas-stage-palette">
              {PALETTE.map((p) => (
                <li key={p.kind}>
                  <button
                    type="button"
                    className="canvas-stage-palette__item"
                    onClick={() => handleAddNode(p.kind)}
                  >
                    <span className="canvas-stage-palette__label">{p.label}</span>
                    <span className="canvas-stage-palette__desc">{p.desc}</span>
                  </button>
                </li>
              ))}
            </ul>

            <section className="canvas-stage-planner" aria-label="套图规划">
              <h3 className="canvas-stage-left__section">电商套图规划</h3>
              <p className="canvas-stage-left__hint">先规划结构，再逐张确认和生成</p>
              <label className="canvas-stage-planner__label" htmlFor="planner-count">套图数量（可配置）</label>
              <input
                type="number"
                min="1"
                step="1"
                id="planner-count"
                value={plannerCount}
                onChange={(event) => setPlannerCount(Math.max(1, Number(event.target.value) || 1))}
              />
              <label className="canvas-stage-planner__label" htmlFor="planner-source">产品资料 / 卖点</label>
              <textarea
                id="planner-source"
                value={plannerSource}
                onChange={(event) => setPlannerSource(event.target.value)}
                placeholder="输入产品事实、卖点、渠道和受众"
                rows={4}
              />
              <button type="button" className="canvas-stage-planner__primary" onClick={handleCreatePlannerDraft}>
                生成套图规划草案
              </button>
              <p className="canvas-stage-planner__note">当前为可编辑结构草案，真实 AI 规划模型接入后会保留模型与版本记录。</p>
              {plannerPlan && (
                <>
                  <div className="canvas-stage-planner__summary">{plannerPlan.slot_count} 张 · v{plannerPlan.version} · {plannerPlan.planner_model ?? "结构草案"}</div>
                  <button type="button" className="canvas-stage-planner__secondary" onClick={handleApplyPlanner}>
                    生成套图容器与卡片
                  </button>
                </>
              )}
            </section>

            {plannerPlan && (
              <section className="canvas-stage-planner__frames" aria-label="逐图规划">
                <h3 className="canvas-stage-left__section">逐图提示词</h3>
                {plannerPlan.frames.map((frame) => (
                  <article key={frame.id} className="canvas-stage-planner__frame">
                    <strong>{String(frame.index).padStart(2, "0")} · {frame.purpose}</strong>
                    <span>{frame.layout}</span>
                    <input
                      aria-label={`${frame.index}号图文案建议`}
                      value={frame.copy_suggestion}
                      onChange={(event) => handleUpdatePlannerFrame(frame.id, { copy_suggestion: event.target.value })}
                    />
                    <textarea
                      aria-label={`${frame.index}号图提示词`}
                      value={frame.prompt}
                      rows={3}
                      onChange={(event) => handleUpdatePlannerFrame(frame.id, { prompt: event.target.value })}
                    />
                  </article>
                ))}
              </section>
            )}

            {/* 图层管理 */}
            <h3 className="canvas-stage-left__section">图层</h3>
            <ul className="canvas-stage-layers">
              {scene.items
                .slice()
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((item) => (
                  <li
                    key={item.id}
                    className={`canvas-stage-layer ${
                      selectedIds.includes(item.id) ? "canvas-stage-layer--selected" : ""
                    } ${item.hidden ? "canvas-stage-layer--hidden" : ""}`}
                    onClick={() => setSelectedIds([item.id])}
                  >
                    <span className="canvas-stage-layer__label">{item.label}</span>
                    <span className="canvas-stage-layer__kind">
                      {KIND_DEFAULT_LABEL[item.kind]}
                    </span>
                    <div className="canvas-stage-layer__actions">
                      <button
                        type="button"
                        title={item.locked ? "解锁" : "锁定"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setScene((s) => ({
                            ...s,
                            items: s.items.map((it) =>
                              it.id === item.id ? { ...it, locked: !it.locked } : it
                            ),
                          }));
                        }}
                      >
                        {item.locked ? "🔒" : "🔓"}
                      </button>
                      <button
                        type="button"
                        title={item.hidden ? "显示" : "隐藏"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setScene((s) => ({
                            ...s,
                            items: s.items.map((it) =>
                              it.id === item.id ? { ...it, hidden: !it.hidden } : it
                            ),
                          }));
                        }}
                      >
                        {item.hidden ? "👁" : "👁‍🗨"}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </aside>

          {/* 中间：Konva 画布 */}
          <section className="canvas-stage-center" ref={containerRef}>
            <CanvasBoard
              items={scene.items}
              edges={scene.edges}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onMove={handleMove}
              onMoveMany={handleMoveMany}
              onResize={handleResize}
              onConnect={handleConnect}
              viewport={viewport}
              onViewportChange={handleViewportChange}
              width={stageSize.width}
              height={stageSize.height}
            />
            {/* Minimap 总览 */}
            <Minimap
              items={scene.items}
              viewport={viewport}
              stageWidth={stageSize.width}
              stageHeight={stageSize.height}
              onViewportChange={handleViewportChange}
            />
          </section>

          {/* 右侧：属性面板 + 批量操作 */}
          <aside className="canvas-stage-right">
            <h3>属性面板</h3>
            {selectedIds.length > 0 && (
              <div className="canvas-stage-batch">
                <p className="canvas-stage-batch__count">
                  已选中 {selectedIds.length} 个节点
                </p>
                <div className="canvas-stage-batch__actions">
                  <button type="button" onClick={handleGroupSelected}>
                    分组
                  </button>
                  <button type="button" onClick={handleUngroupSelected}>
                    取消分组
                  </button>
                  <button type="button" onClick={handleToggleLock}>
                    锁定/解锁
                  </button>
                  <button type="button" onClick={handleToggleHidden}>
                    显示/隐藏
                  </button>
                  <button type="button" onClick={handleBringToFront}>
                    置顶
                  </button>
                  <button type="button" onClick={handleBatchConnect}>
                    批量连接
                  </button>
                  <button type="button" onClick={handleSendToBack}>
                    置底
                  </button>
                  <button
                    type="button"
                    className="canvas-stage-batch__delete"
                    onClick={handleDeleteSelected}
                  >
                    删除
                  </button>
                </div>
              </div>
            )}

            {selectedItem ? (
              <>
                <div className="canvas-stage-props__meta">
                  <span>类型：{KIND_DEFAULT_LABEL[selectedItem.kind]}</span>
                  <span>位置：{Math.round(selectedItem.x)}，{Math.round(selectedItem.y)}</span>
                  <span>尺寸：{selectedItem.width}×{selectedItem.height}</span>
                  {selectedItem.imageUrl && (
                    <a href={selectedItem.imageUrl} target="_blank" rel="noreferrer">查看真实结果</a>
                  )}
                </div>
            <CanvasNodeInspector
              item={selectedItem}
              items={scene.items}
              capabilities={imageCapabilities}
                  onUpdate={handleUpdateNode}
                  onUpdateMetadata={handleUpdateNodeMetadata}
                  onUpload={handleUploadNodeAsset}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                  onGenerateReverseDraft={handleGenerateReverseDraft}
                  onGenerateBundleCards={handleGenerateBundleCards}
                  onCreateFollowup={handleCreateFollowup}
                  onExecuteEdit={handleExecuteEdit}
                  onExecuteGenerate={handleExecuteGenerate}
                />
              </>
            ) : selectedIds.length === 0 ? (
              <p className="canvas-stage-props__empty">
                选中画布上的节点查看业务字段。Shift+拖拽框选多个节点，Shift+点击切换选中。
              </p>
            ) : null}
          </aside>
        </div>

        {/* 底部：状态栏 */}
        <footer className="canvas-stage-footer">
          <span>节点数：{scene.items.length}</span>
          <span>连线数：{scene.edges.length}</span>
          <span>分组数：{scene.groups.length}</span>
          <span>缩放：{Math.round(viewport.scale * 100)}%</span>
          <span className="canvas-stage-footer__hint">
            滚轮缩放 · 拖拽空白平移 · Shift+拖拽框选 · 拖端口连线 · 右下角 Minimap 定位
          </span>
        </footer>
      </main>
    </div>
  );
}
