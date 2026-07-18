import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlatformNav } from "../../../platform/PlatformNav";
import { getImageTask } from "../../../api/client";
import type {
  CanvasEdge,
  CanvasGroup,
  CanvasItem,
  CanvasScene,
  CanvasViewport,
  ImageTaskStatus,
} from "../../../types";
import { CanvasBoard } from "./CanvasBoard";
import { Minimap } from "./Minimap";
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

  // 自动连线：表达数据流向（素材 → 生成，生成 → 结果）
  if (task.reference_asset_id) {
    edges.push({
      id: "edge-asset-generate",
      fromId: "asset",
      toId: "generate",
      label: "输入",
    });
  }
  edges.push({
    id: "edge-generate-result",
    fromId: "generate",
    toId: "result",
    label: "输出",
  });

  return {
    items,
    edges,
    groups: [],
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
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, scale: 1 },
    version: 1,
  };
}

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
  if (items.length === 0) return { x: ORIGIN_X, y: ORIGIN_Y };
  const last = items[items.length - 1];
  const nextX = last.x + CARD_W + GAP;
  if (nextX + CARD_W > 1200) {
    return { x: ORIGIN_X, y: last.y + CARD_H + GAP };
  }
  return { x: nextX, y: last.y };
}

export function CanvasStage({ taskId, onBack }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scene, setScene] = useState<CanvasScene>(() => buildEmptyScene());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, scale: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextIdRef = useRef(1);
  const nextEdgeIdRef = useRef(1);
  const nextGroupIdRef = useRef(1);

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

  useEffect(() => {
    if (!taskId) {
      setScene(buildEmptyScene());
      setSelectedIds([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getImageTask(taskId)
      .then((task) => {
        if (!cancelled) {
          setScene(buildSceneFromTask(task));
          setSelectedIds([]);
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

  const handleConnect = useCallback((fromId: string, toId: string) => {
    setScene((s) => {
      // 避免重复连线
      if (s.edges.some((e) => e.fromId === fromId && e.toId === toId)) {
        return s;
      }
      const edge: CanvasEdge = {
        id: `edge-${nextEdgeIdRef.current++}`,
        fromId,
        toId,
      };
      return { ...s, edges: [...s.edges, edge] };
    });
  }, []);

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
              {taskId
                ? "已从基础模式任务还原工作流，可自由拖拽、缩放、旋转、连线、分组"
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
              onViewportChange={setViewport}
              width={stageSize.width}
              height={stageSize.height}
            />
            {/* Minimap 总览 */}
            <Minimap
              items={scene.items}
              viewport={viewport}
              stageWidth={stageSize.width}
              stageHeight={stageSize.height}
              onViewportChange={setViewport}
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
              </div>
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
