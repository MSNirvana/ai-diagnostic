import { useCallback, useEffect, useRef, useState } from "react";
import {
  Arrow,
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import type { CanvasEdge, CanvasItem, CanvasItemKind, CanvasPortDefinition } from "../../../types";
import { useCanvasImage } from "./useCanvasImage";
import { getCanvasNodeDefinition } from "./canvasNodeRegistry";

interface CanvasBoardProps {
  items: CanvasItem[];
  edges: CanvasEdge[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveMany: (ids: string[], dx: number, dy: number) => void;
  onResize: (id: string, width: number, height: number, rotation: number) => void;
  onConnect: (fromId: string, toId: string, fromPortId?: string, toPortId?: string) => void;
  viewport: { x: number; y: number; scale: number };
  onViewportChange: (viewport: { x: number; y: number; scale: number }) => void;
  width: number;
  height: number;
}

const KIND_COLOR: Record<CanvasItemKind, string> = {
  requirement: "#3b82f6",
  asset: "#10b981",
  reference: "#0f766e",
  reversePrompt: "#8b5cf6",
  prompt: "#f59e0b",
  model: "#6366f1",
  generate: "#ec4899",
  result: "#14b8a6",
  edit: "#f97316",
  upscale: "#0891b2",
  bundle: "#64748b",
  bundleCard: "#db2777",
  export: "#6b7280",
};

const KIND_TITLE: Record<CanvasItemKind, string> = {
  requirement: "需求/模板",
  asset: "素材",
  reference: "参考节点",
  reversePrompt: "反推提示词",
  prompt: "提示词",
  model: "图片模型",
  generate: "图片生成",
  result: "结果",
  edit: "修改/重绘",
  upscale: "超分辨率",
  bundle: "分组/版式",
  bundleCard: "套图卡片",
  export: "导出",
};

const HEADER_H = 24;
const PADDING = 10;
const PORT_R = 5;

function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface CardNodeProps {
  item: CanvasItem;
  selected: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPortMouseDown: (id: string, portId: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
}

const PORT_LABELS: Record<string, string> = {
  image: "图片", prompt: "提示词", requirement: "需求", config: "配置",
  result: "结果", "reference-prompt": "反推", bundle: "套图",
};

function CardNode({ item, selected, onSelect, onMove, onPortMouseDown }: CardNodeProps) {
  const accent = KIND_COLOR[item.kind];
  const title = KIND_TITLE[item.kind];
  const image = useCanvasImage(item.imageUrl);
  const ports = getCanvasNodeDefinition(item.kind).ports;
  const inputPorts = ports.filter((port) => port.direction === "input");
  const outputPorts = ports.filter((port) => port.direction === "output");
  const portY = (index: number, count: number) => HEADER_H + 12 + ((item.height - HEADER_H - 24) * (index + 1)) / (count + 1);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onMove(item.id, e.target.x(), e.target.y());
  };

  const bodyLines: string[] = [];
  if (!image) {
    const meta = item.metadata ?? {};
    if (meta.presetName) bodyLines.push(truncate(meta.presetName, 22));
    if (meta.demandType) bodyLines.push(`需求: ${truncate(meta.demandType, 18)}`);
    if (meta.productFacts) bodyLines.push(truncate(meta.productFacts, 22));
    if (meta.referenceRole) bodyLines.push(`来源: ${meta.referenceRole}`);
    if (meta.assetName) bodyLines.push(truncate(meta.assetName, 22));
    if (meta.reversePromptEnabled !== undefined) bodyLines.push(meta.reversePromptEnabled ? "已启用反推" : "未启用反推");
    if (meta.reversePromptModel) bodyLines.push(`反推模型: ${meta.reversePromptModel}`);
    if (meta.reversePromptFocus) bodyLines.push(`反推重点: ${truncate(meta.reversePromptFocus, 16)}`);
    if (meta.userIntent) bodyLines.push(truncate(meta.userIntent, 22));
    if (meta.reversePrompt) bodyLines.push(truncate(meta.reversePrompt, 22));
    if (meta.assembledPrompt) bodyLines.push(truncate(meta.assembledPrompt, 22));
    if (meta.prompt) bodyLines.push(truncate(meta.prompt, 22));
    if (meta.modelName) bodyLines.push(`模型: ${meta.modelName}`);
    if (meta.aspectRatio) bodyLines.push(`比例: ${meta.aspectRatio}`);
    if (meta.size) bodyLines.push(`尺寸: ${meta.size}`);
    if (meta.quality) bodyLines.push(`画质: ${meta.quality}`);
    if (meta.generationCount) bodyLines.push(`套图: ${meta.generationCount} 张`);
    if (meta.cardIndex && meta.cardType) bodyLines.push(`${meta.cardIndex}. ${meta.cardType}`);
    if (meta.cardPurpose) bodyLines.push(truncate(meta.cardPurpose, 22));
    if (meta.copySuggestion) bodyLines.push(truncate(meta.copySuggestion, 22));
    if (meta.sourceNodeIds?.length) bodyLines.push(`参考来源: ${meta.sourceNodeIds.length} 个`);
    if (meta.generationMode) {
      bodyLines.push(meta.generationMode === "image2image" ? "图生图" : "文生图");
    }
    if (meta.taskStatus) bodyLines.push(`状态: ${meta.taskStatus}`);
    if (item.imageUrl && !image) bodyLines.push("图片加载中…");
  }

  return (
    <Group
      id={item.id}
      name="canvas-item"
      x={item.x}
      y={item.y}
      rotation={item.rotation ?? 0}
      draggable={!item.locked}
      onDragEnd={handleDragEnd}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(item.id, e.evt.shiftKey);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(item.id, e.evt.shiftKey);
      }}
    >
      {/* 卡片底板 */}
      <Rect
        width={item.width}
        height={item.height}
        cornerRadius={8}
        fill="#ffffff"
        stroke={selected ? accent : "#d1d5db"}
        strokeWidth={selected ? 2 : 1}
        shadowColor="rgba(0,0,0,0.06)"
        shadowBlur={4}
        shadowOffsetY={2}
      />
      {/* 左侧色条 */}
      <Rect width={4} height={item.height} cornerRadius={[8, 0, 0, 8]} fill={accent} />
      {/* 标题栏 */}
      <Text
        x={PADDING + 4}
        y={6}
        width={item.width - PADDING * 2 - 4}
        height={HEADER_H - 6}
        text={title}
        fontSize={13}
        fontStyle="bold"
        fill="#111827"
      />
      {/* 分隔线 */}
      <Rect x={0} y={HEADER_H} width={item.width} height={1} fill="#f3f4f6" />
      {/* 内容区：图片或文字 */}
      {image ? (
        <KonvaImage
          x={PADDING}
          y={HEADER_H + 4}
          width={item.width - PADDING * 2}
          height={item.height - HEADER_H - PADDING - 4}
          image={image}
        />
      ) : (
        bodyLines.map((line, idx) => (
          <Text
            key={idx}
            x={PADDING + 4}
            y={HEADER_H + 6 + idx * 16}
            width={item.width - PADDING * 2 - 4}
            height={16}
            text={line}
            fontSize={12}
            fill="#4b5563"
          />
        ))
      )}
      {inputPorts.map((port, index) => (
        <Group key={`in-${port.id}`} name={`input-port-${port.id}`} x={0} y={portY(index, inputPorts.length)}>
          <Rect x={-PORT_R} y={-PORT_R} width={PORT_R * 2} height={PORT_R * 2} cornerRadius={PORT_R} fill="#ffffff" stroke={accent} strokeWidth={1.5} />
          <Text x={8} y={-7} text={PORT_LABELS[port.id] ?? port.id} fontSize={9} fill="#64748b" />
        </Group>
      ))}
      {outputPorts.map((port, index) => (
        <Group key={`out-${port.id}`} name={`output-port-${port.id}`} x={item.width} y={portY(index, outputPorts.length)}
          onMouseDown={(e) => { e.cancelBubble = true; onPortMouseDown(item.id, port.id, e); }}>
          <Rect x={-PORT_R} y={-PORT_R} width={PORT_R * 2} height={PORT_R * 2} cornerRadius={PORT_R} fill={accent} stroke="#ffffff" strokeWidth={1.5} />
          <Text x={-48} y={-7} width={38} align="right" text={PORT_LABELS[port.id] ?? port.id} fontSize={9} fill="#64748b" />
        </Group>
      ))}
    </Group>
  );
}

export function CanvasBoard({
  items,
  edges,
  selectedIds,
  onSelect,
  onMove,
  onMoveMany,
  onResize,
  onConnect,
  viewport,
  onViewportChange,
  width,
  height,
}: CanvasBoardProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [connecting, setConnecting] = useState<{
    fromId: string;
    fromPortId: string;
    toX: number;
    toY: number;
  } | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragStartItems = useRef<Map<string, { x: number; y: number }>>(new Map());

  // 选中节点变化时，把 Transformer 绑到所有选中的 Group 上
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (selectedIds.length === 0) {
      tr.nodes([]);
      return;
    }
    const nodes = selectedIds
      .map((id) => stage.findOne(`#${id}`))
      .filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, items]);

  // 滚轮缩放：以鼠标位置为中心
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const oldScale = viewport.scale;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const mousePointTo = {
        x: (pointer.x - viewport.x) / oldScale,
        y: (pointer.y - viewport.y) / oldScale,
      };
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const factor = 1.1;
      const newScale = direction > 0 ? oldScale * factor : oldScale / factor;
      const clamped = Math.max(0.2, Math.min(3, newScale));
      onViewportChange({
        scale: clamped,
        x: pointer.x - mousePointTo.x * clamped,
        y: pointer.y - mousePointTo.y * clamped,
      });
    },
    [viewport, onViewportChange]
  );

  // 拖拽背景平移整个画布
  const handleStageDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onViewportChange({ ...viewport, x: e.target.x(), y: e.target.y() });
  }, [viewport, onViewportChange]);

  // 点击空白处：开始框选或取消选中
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const target = e.target;
      const isBackground = target === stageRef.current || target.attrs.name === "background";
      if (!isBackground) return;

      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // 转换到画布坐标系
      const canvasX = (pointer.x - viewport.x) / viewport.scale;
      const canvasY = (pointer.y - viewport.y) / viewport.scale;

      if (e.evt.shiftKey) {
        // Shift + 拖拽 = 框选
        setSelectionRect({ x: canvasX, y: canvasY, w: 0, h: 0 });
      } else {
        // 普通点击空白 = 取消选中
        onSelect([]);
      }
    },
    [onSelect, viewport]
  );

  // 框选过程
  const handleStageMouseMove = useCallback(() => {
    if (!selectionRect) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const canvasX = (pointer.x - viewport.x) / viewport.scale;
    const canvasY = (pointer.y - viewport.y) / viewport.scale;
    setSelectionRect((r) =>
      r ? { ...r, w: canvasX - r.x, h: canvasY - r.y } : null
    );
  }, [selectionRect, viewport]);

  // 框选结束：计算选中的节点
  const handleStageMouseUp = useCallback(() => {
    if (!selectionRect) return;
    const { x, y, w, h } = selectionRect;
    const minX = Math.min(x, x + w);
    const maxX = Math.max(x, x + w);
    const minY = Math.min(y, y + h);
    const maxY = Math.max(y, y + h);

    const selected = items
      .filter((item) => {
        if (item.hidden) return false;
        const itemRight = item.x + item.width;
        const itemBottom = item.y + item.height;
        return (
          item.x < maxX && itemRight > minX && item.y < maxY && itemBottom > minY
        );
      })
      .map((item) => item.id);

    onSelect(selected);
    setSelectionRect(null);
  }, [selectionRect, items, onSelect]);

  // 连线开始：从输出端口拖出
  const handlePortMouseDown = useCallback(
    (fromId: string, fromPortId: string, e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const canvasX = (pointer.x - viewport.x) / viewport.scale;
      const canvasY = (pointer.y - viewport.y) / viewport.scale;
      setConnecting({ fromId, fromPortId, toX: canvasX, toY: canvasY });
    },
    [viewport]
  );

  // 连线过程：更新临时连线终点
  const handleConnectingMove = useCallback(() => {
    if (!connecting) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const canvasX = (pointer.x - viewport.x) / viewport.scale;
    const canvasY = (pointer.y - viewport.y) / viewport.scale;
    setConnecting((c) => (c ? { ...c, toX: canvasX, toY: canvasY } : null));
  }, [connecting, viewport]);

  // 连线结束：检查是否落在输入端口上
  const handleConnectingEnd = useCallback(() => {
    if (!connecting) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const canvasX = (pointer.x - viewport.x) / viewport.scale;
    const canvasY = (pointer.y - viewport.y) / viewport.scale;

    // 查找落点附近的具体输入端口
    let targetItem: CanvasItem | undefined;
    let targetPort: CanvasPortDefinition | undefined;
    items.forEach((item) => {
      if (item.hidden || item.id === connecting.fromId) return false;
      const inputPorts = getCanvasNodeDefinition(item.kind).ports.filter((port) => port.direction === "input");
      inputPorts.forEach((port, index) => {
        const portX = item.x;
        const portY = item.y + HEADER_H + 12 + ((item.height - HEADER_H - 24) * (index + 1)) / (inputPorts.length + 1);
        if (Math.hypot(canvasX - portX, canvasY - portY) < 20) {
          targetItem = item;
          targetPort = port;
        }
      });
    });

    if (targetItem && targetPort) {
      onConnect(connecting.fromId, targetItem.id, connecting.fromPortId, targetPort.id);
    }
    setConnecting(null);
  }, [connecting, items, onConnect, viewport]);

  // 多选拖拽：记录起始位置
  const handleMultiDragStart = useCallback(() => {
    if (selectedIds.length <= 1) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    dragStartPos.current = { x: pointer.x, y: pointer.y };
    dragStartItems.current.clear();
    selectedIds.forEach((id) => {
      const item = items.find((i) => i.id === id);
      if (item) {
        dragStartItems.current.set(id, { x: item.x, y: item.y });
      }
    });
  }, [selectedIds, items]);

  // 多选拖拽：计算位移并批量移动
  const handleMultiDragMove = useCallback(() => {
    if (selectedIds.length <= 1 || !dragStartPos.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const dx = (pointer.x - dragStartPos.current.x) / viewport.scale;
    const dy = (pointer.y - dragStartPos.current.y) / viewport.scale;
    onMoveMany(selectedIds, dx, dy);
  }, [selectedIds, onMoveMany, viewport]);

  // 多选拖拽结束
  const handleMultiDragEnd = useCallback(() => {
    dragStartPos.current = null;
    dragStartItems.current.clear();
  }, []);

  const handleTransformEnd = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const stage = stageRef.current;
    if (!stage) return;
    const node = stage.findOne(`#${id}`) as Konva.Group | undefined;
    if (!node) return;
    const newWidth = Math.max(80, Math.round(node.width() * node.scaleX()));
    const newHeight = Math.max(80, Math.round(node.height() * node.scaleY()));
    const newRotation = node.rotation();
    node.scaleX(1);
    node.scaleY(1);
    onResize(id, newWidth, newHeight, newRotation);
  }, [selectedIds, onResize]);

  // 计算连线端点坐标
  const getEdgePoints = useCallback(
    (edge: CanvasEdge) => {
      const fromItem = items.find((i) => i.id === edge.fromId);
      const toItem = items.find((i) => i.id === edge.toId);
      if (!fromItem || !toItem) return null;
      const fromPort = edge.fromPort ?? getCanvasNodeDefinition(fromItem.kind).ports.find((port) => port.direction === "output")?.id;
      const toPort = edge.toPort ?? getCanvasNodeDefinition(toItem.kind).ports.find((port) => port.direction === "input")?.id;
      const fromPorts = getCanvasNodeDefinition(fromItem.kind).ports.filter((port) => port.direction === "output");
      const toPorts = getCanvasNodeDefinition(toItem.kind).ports.filter((port) => port.direction === "input");
      const fromIndex = Math.max(0, fromPorts.findIndex((port) => port.id === fromPort));
      const toIndex = Math.max(0, toPorts.findIndex((port) => port.id === toPort));
      const fromY = fromItem.y + HEADER_H + 12 + ((fromItem.height - HEADER_H - 24) * (fromIndex + 1)) / (fromPorts.length + 1);
      const fromX = fromItem.x + fromItem.width;
      const toX = toItem.x;
      const toY = toItem.y + HEADER_H + 12 + ((toItem.height - HEADER_H - 24) * (toIndex + 1)) / (toPorts.length + 1);
      return { fromX, fromY, toX, toY };
    },
    [items]
  );

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={viewport.x}
      y={viewport.y}
      scaleX={viewport.scale}
      scaleY={viewport.scale}
      draggable
      onDragEnd={handleStageDragEnd}
      onWheel={handleWheel}
      onMouseDown={handleStageMouseDown}
      onMouseMove={(e) => {
        handleStageMouseMove();
        handleConnectingMove();
      }}
      onMouseUp={(e) => {
        handleStageMouseUp();
        handleConnectingEnd();
      }}
    >
      <Layer>
        {/* 背景层 */}
        <Rect
          name="background"
          x={-10000}
          y={-10000}
          width={20000}
          height={20000}
          fill="#f7f8fa"
          listening
        />
        {/* 网格点 */}
        {Array.from({ length: 40 }).map((_, i) =>
          Array.from({ length: 40 }).map((_, j) => (
            <Rect
              key={`grid-${i}-${j}`}
              x={i * 80 - 10000}
              y={j * 80 - 10000}
              width={1}
              height={1}
              fill="#e5e7eb"
              listening={false}
            />
          ))
        )}
        {/* 连线层（在节点下层） */}
        {edges.map((edge) => {
          const pts = getEdgePoints(edge);
          if (!pts) return null;
          return (
            <Arrow
              key={edge.id}
              points={[pts.fromX, pts.fromY, pts.toX, pts.toY]}
              stroke="#94a3b8"
              strokeWidth={2}
              fill="#94a3b8"
              pointerLength={8}
              pointerWidth={8}
              dash={[6, 4]}
            />
          );
        })}
        {/* 临时连线（拖拽中） */}
        {connecting && (
          <Arrow
            points={[
              (items.find((i) => i.id === connecting.fromId)?.x ?? 0) + (items.find((i) => i.id === connecting.fromId)?.width ?? 0),
              (items.find((i) => i.id === connecting.fromId)?.y ?? 0) + (items.find((i) => i.id === connecting.fromId)?.height ?? 0) / 2,
              connecting.toX,
              connecting.toY,
            ]}
            stroke="#6366f1"
            strokeWidth={2}
            fill="#6366f1"
            pointerLength={8}
            pointerWidth={8}
            dash={[4, 4]}
          />
        )}
        {/* 节点层 */}
        {items
          .filter((item) => !item.hidden)
          .slice()
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((item) => (
            <CardNode
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              onSelect={(id, shiftKey) => {
                if (shiftKey) {
                  // Shift + 点击 = 切换选中状态
                  onSelect(
                    selectedIds.includes(id)
                      ? selectedIds.filter((sid) => sid !== id)
                      : [...selectedIds, id]
                  );
                } else {
                  // 普通点击 = 单选
                  onSelect([id]);
                }
              }}
              onMove={onMove}
              onPortMouseDown={handlePortMouseDown}
            />
          ))}
        {/* 框选矩形 */}
        {selectionRect && (
          <Rect
            x={selectionRect.x}
            y={selectionRect.y}
            width={selectionRect.w}
            height={selectionRect.h}
            fill="rgba(99, 102, 241, 0.1)"
            stroke="#6366f1"
            strokeWidth={1}
            dash={[4, 4]}
          />
        )}
        {/* 选中节点的变换器 */}
        <Transformer
          ref={transformerRef}
          rotateEnabled={selectedIds.length === 1}
          enabledAnchors={
            selectedIds.length === 1
              ? ["top-left", "top-right", "bottom-left", "bottom-right"]
              : []
          }
          borderStroke="#6366f1"
          anchorStroke="#6366f1"
          anchorFill="#ffffff"
          anchorSize={8}
          onTransformEnd={handleTransformEnd}
          boundBoxFunc={(oldBox, newBox) => {
            if (Math.abs(newBox.width) < 80 || Math.abs(newBox.height) < 80) {
              return oldBox;
            }
            return newBox;
          }}
        />
      </Layer>
    </Stage>
  );
}
