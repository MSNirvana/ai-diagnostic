import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlatformNav } from "../../../platform/PlatformNav";
import { getImageTask } from "../../../api/client";
import type {
  CanvasItem,
  CanvasScene,
  ImageTaskStatus,
} from "../../../types";
import { CanvasBoard } from "./CanvasBoard";
import "./CanvasStage.css";

interface CanvasStageProps {
  taskId?: string | null;
  onBack?: () => void;
}

const PRESET_NAMES: Record<string, string> = {
  promo: "一键生成宣传图",
  ecommerce: "一键生成电商图",
  template: "从模板开始",
};

const CARD_W = 220;
const CARD_H = 160;
const GAP = 24;
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

// 从基础模式任务还原画布初始场景：按文档节点顺序横排摆放，但不连线。
// 节点之间是自由摆放的卡片，用户可拖动、缩放、旋转。
function buildSceneFromTask(task: ImageTaskStatus): CanvasScene {
  const items: CanvasItem[] = [];
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
      userIntent: task.user_intent ?? undefined,
    },
  });

  push("asset", "asset", "素材", {
    assetId: task.reference_asset_id ?? undefined,
    metadata: task.reference_asset_id ? {} : { userIntent: "未上传参考图" },
  });

  if (task.reverse_prompt) {
    push("reversePrompt", "reversePrompt", "反推提示词", {
      metadata: { reversePrompt: task.reverse_prompt ?? undefined },
    });
  }

  push("prompt", "prompt", "图片提示词", {
    metadata: { assembledPrompt: task.assembled_prompt ?? undefined },
  });

  push("model", "model", "图片模型", {
    metadata: { modelName: "image2.0" },
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
    metadata: { taskStatus: task.status },
  });

  push("export", "export", "导出", {
    imageUrl: task.result_image_url ?? undefined,
  });

  return {
    items,
    viewport: { x: 0, y: 0, scale: 1 },
    version: 1,
  };
}

function buildEmptyScene(): CanvasScene {
  return {
    items: [
      {
        id: "hint-requirement",
        kind: "requirement",
        label: "需求/模板",
        x: ORIGIN_X,
        y: ORIGIN_Y,
        width: CARD_W,
        height: CARD_H,
        zIndex: 1,
        metadata: { userIntent: "从左侧选择节点类型添加到画布" },
      },
    ],
    viewport: { x: 0, y: 0, scale: 1 },
    version: 1,
  };
}

// 左侧节点工具箱：点击后向画布追加一个该类型的卡片
const PALETTE: { kind: CanvasItem["kind"]; label: string; desc: string }[] = [
  { kind: "requirement", label: "需求/模板", desc: "用途、产品事实、渠道" },
  { kind: "asset", label: "素材", desc: "产品图、参考图、品牌资产" },
  { kind: "reversePrompt", label: "反推提示词", desc: "从参考图推断" },
  { kind: "prompt", label: "图片提示词", desc: "组装/编辑/版本" },
  { kind: "model", label: "图片模型", desc: "image2.0 等模型选择" },
  { kind: "generate", label: "图片生成", desc: "创建异步生成任务" },
  { kind: "result", label: "结果", desc: "候选图、版本" },
  { kind: "bundle", label: "分组/版式", desc: "归为一套宣传图" },
  { kind: "export", label: "导出", desc: "下载或输出素材包" },
];

const KIND_DEFAULT_LABEL: Record<CanvasItem["kind"], string> = {
  requirement: "需求/模板",
  asset: "素材",
  reversePrompt: "反推提示词",
  prompt: "图片提示词",
  model: "图片模型",
  generate: "图片生成",
  result: "结果",
  bundle: "分组/版式",
  export: "导出",
};

function findNextPosition(items: CanvasItem[]): { x: number; y: number } {
  // 简单策略：在画布右下方依次堆叠，避免覆盖现有节点
  if (items.length === 0) return { x: ORIGIN_X, y: ORIGIN_Y };
  const last = items[items.length - 1];
  const nextX = last.x + CARD_W + GAP;
  // 防止超出常见画布宽度，超过则换行
  if (nextX + CARD_W > 1200) {
    return { x: ORIGIN_X, y: last.y + CARD_H + GAP };
  }
  return { x: nextX, y: last.y };
}

export function CanvasStage({ taskId, onBack }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scene, setScene] = useState<CanvasScene>(() => buildEmptyScene());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextIdRef = useRef(1);

  // 监听容器尺寸变化，同步给 Konva Stage
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      setStageSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 任务 ID 变化时拉取任务详情并还原画布
  useEffect(() => {
    if (!taskId) {
      setScene(buildEmptyScene());
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getImageTask(taskId)
      .then((task) => {
        if (!cancelled) {
          setScene(buildSceneFromTask(task));
          setSelectedId(null);
        }
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
  }, [taskId]);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setScene((s) => ({
      ...s,
      items: s.items.map((it) => (it.id === id ? { ...it, x, y } : it)),
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
        metadata: kind === "model" ? { modelName: "image2.0" } : {},
      };
      return { ...s, items: [...s.items, item] };
    });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setScene((s) => ({
      ...s,
      items: s.items.filter((it) => it.id !== selectedId),
    }));
    setSelectedId(null);
  }, [selectedId]);

  const selectedItem = useMemo(
    () => scene.items.find((i) => i.id === selectedId) ?? null,
    [scene, selectedId]
  );

  return (
    <div className="canvas-stage-page">
      <PlatformNav />
      <main className="canvas-stage-main">
        <header className="canvas-stage-header">
          <div>
            <h1>图片创作 · 高级工作台</h1>
            <p>
              {taskId
                ? "已从基础模式任务还原工作流，可自由拖拽、缩放、旋转卡片"
                : "空白画布，从左侧节点工具箱开始搭建素材导演台"}
            </p>
          </div>
          {onBack && (
            <button type="button" className="canvas-stage-back" onClick={onBack}>
              返回基础模式
            </button>
          )}
        </header>

        {loading && <p className="canvas-stage-loading">加载任务中…</p>}
        {error && <p className="canvas-stage-error">{error}</p>}

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
          </aside>

          {/* 中间：Konva 画布 */}
          <section className="canvas-stage-center" ref={containerRef}>
            <CanvasBoard
              items={scene.items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={handleMove}
              onResize={handleResize}
              width={stageSize.width}
              height={stageSize.height}
            />
          </section>

          {/* 右侧：选中节点的业务字段 */}
          <aside className="canvas-stage-right">
            <h3>属性面板</h3>
            {selectedItem ? (
              <div className="canvas-stage-props">
                <div className="canvas-stage-props__row">
                  <span>类型</span>
                  <strong>{KIND_DEFAULT_LABEL[selectedItem.kind]}</strong>
                </div>
                <div className="canvas-stage-props__row">
                  <span>位置</span>
                  <span>
                    x={Math.round(selectedItem.x)} y={Math.round(selectedItem.y)}
                  </span>
                </div>
                <div className="canvas-stage-props__row">
                  <span>尺寸</span>
                  <span>
                    {selectedItem.width}×{selectedItem.height}
                  </span>
                </div>
                {selectedItem.metadata?.presetName && (
                  <div className="canvas-stage-props__row">
                    <span>预设</span>
                    <span>{selectedItem.metadata.presetName}</span>
                  </div>
                )}
                {selectedItem.metadata?.userIntent && (
                  <div className="canvas-stage-props__row canvas-stage-props__row--column">
                    <span>用户意图</span>
                    <textarea
                      value={selectedItem.metadata.userIntent}
                      readOnly
                      rows={3}
                    />
                  </div>
                )}
                {selectedItem.metadata?.reversePrompt && (
                  <div className="canvas-stage-props__row canvas-stage-props__row--column">
                    <span>反推提示词</span>
                    <textarea
                      value={selectedItem.metadata.reversePrompt}
                      readOnly
                      rows={4}
                    />
                  </div>
                )}
                {selectedItem.metadata?.assembledPrompt && (
                  <div className="canvas-stage-props__row canvas-stage-props__row--column">
                    <span>组装后提示词</span>
                    <textarea
                      value={selectedItem.metadata.assembledPrompt}
                      readOnly
                      rows={4}
                    />
                  </div>
                )}
                {selectedItem.metadata?.modelName && (
                  <div className="canvas-stage-props__row">
                    <span>模型</span>
                    <span>{selectedItem.metadata.modelName}</span>
                  </div>
                )}
                {selectedItem.metadata?.generationMode && (
                  <div className="canvas-stage-props__row">
                    <span>生成方式</span>
                    <span>
                      {selectedItem.metadata.generationMode === "image2image"
                        ? "图生图"
                        : "文生图"}
                    </span>
                  </div>
                )}
                {selectedItem.metadata?.taskStatus && (
                  <div className="canvas-stage-props__row">
                    <span>任务状态</span>
                    <span>{selectedItem.metadata.taskStatus}</span>
                  </div>
                )}
                {selectedItem.imageUrl && (
                  <div className="canvas-stage-props__row">
                    <span>图片</span>
                    <a
                      href={selectedItem.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看
                    </a>
                  </div>
                )}
                <button
                  type="button"
                  className="canvas-stage-props__delete"
                  onClick={handleDeleteSelected}
                >
                  删除节点
                </button>
              </div>
            ) : (
              <p className="canvas-stage-props__empty">
                选中画布上的节点查看业务字段。节点之间不连线，画布只负责交互与呈现，执行顺序由后端任务模型决定。
              </p>
            )}
          </aside>
        </div>

        {/* 底部：状态栏（占位，后续接入生成队列/历史版本/积分） */}
        <footer className="canvas-stage-footer">
          <span>节点数：{scene.items.length}</span>
          <span>缩放：{Math.round(scene.viewport.scale * 100)}%</span>
          <span className="canvas-stage-footer__hint">
            滚轮缩放 · 拖拽空白平移 · 选中后可调整大小/旋转
          </span>
        </footer>
      </main>
    </div>
  );
}
