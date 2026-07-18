import { useCallback, useEffect, useRef, useState } from "react";
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import type { CanvasItem, CanvasItemKind } from "../../../types";
import { useCanvasImage } from "./useCanvasImage";

interface CanvasBoardProps {
  items: CanvasItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number, rotation: number) => void;
  width: number;
  height: number;
}

const KIND_COLOR: Record<CanvasItemKind, string> = {
  requirement: "#3b82f6",
  asset: "#10b981",
  reversePrompt: "#8b5cf6",
  prompt: "#f59e0b",
  model: "#6366f1",
  generate: "#ec4899",
  result: "#14b8a6",
  bundle: "#64748b",
  export: "#6b7280",
};

const KIND_TITLE: Record<CanvasItemKind, string> = {
  requirement: "需求/模板",
  asset: "素材",
  reversePrompt: "反推提示词",
  prompt: "提示词",
  model: "图片模型",
  generate: "图片生成",
  result: "结果",
  bundle: "分组/版式",
  export: "导出",
};

const HEADER_H = 24;
const PADDING = 10;

function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface CardNodeProps {
  item: CanvasItem;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
}

function CardNode({ item, selected, onSelect, onMove }: CardNodeProps) {
  const accent = KIND_COLOR[item.kind];
  const title = KIND_TITLE[item.kind];
  const image = useCanvasImage(item.imageUrl);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onMove(item.id, e.target.x(), e.target.y());
  };

  // 没有图片时，卡片内展示业务字段摘要
  const bodyLines: string[] = [];
  if (!image) {
    const meta = item.metadata ?? {};
    if (meta.presetName) bodyLines.push(truncate(meta.presetName, 22));
    if (meta.userIntent) bodyLines.push(truncate(meta.userIntent, 22));
    if (meta.reversePrompt) bodyLines.push(truncate(meta.reversePrompt, 22));
    if (meta.assembledPrompt) bodyLines.push(truncate(meta.assembledPrompt, 22));
    if (meta.prompt) bodyLines.push(truncate(meta.prompt, 22));
    if (meta.modelName) bodyLines.push(`模型: ${meta.modelName}`);
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
      draggable
      onDragEnd={handleDragEnd}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(item.id);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(item.id);
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
    </Group>
  );
}

export function CanvasBoard({
  items,
  selectedId,
  onSelect,
  onMove,
  onResize,
  width,
  height,
}: CanvasBoardProps) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });

  // 选中节点变化时，把 Transformer 绑到对应 Group 上
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (!selectedId) {
      tr.nodes([]);
      return;
    }
    const node = stage.findOne(`#${selectedId}`);
    if (node) {
      tr.nodes([node as Konva.Node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, items]);

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
      setViewport({
        scale: clamped,
        x: pointer.x - mousePointTo.x * clamped,
        y: pointer.y - mousePointTo.y * clamped,
      });
    },
    [viewport]
  );

  // 拖拽背景平移整个画布
  const handleStageDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    setViewport((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
  }, []);

  // 点击空白处取消选中
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const target = e.target;
      const isBackground = target === stageRef.current || target.attrs.name === "background";
      if (isBackground) {
        onSelect(null);
      }
    },
    [onSelect]
  );

  const handleTransformEnd = useCallback(() => {
    if (!selectedId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const node = stage.findOne(`#${selectedId}`) as Konva.Group | undefined;
    if (!node) return;
    const newWidth = Math.max(80, Math.round(node.width() * node.scaleX()));
    const newHeight = Math.max(80, Math.round(node.height() * node.scaleY()));
    const newRotation = node.rotation();
    // 把 scale 归 1，避免下次交互时被乘上
    node.scaleX(1);
    node.scaleY(1);
    onResize(selectedId, newWidth, newHeight, newRotation);
  }, [selectedId, onResize]);

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
    >
      <Layer>
        {/* 背景层：点中它即视为点空白 */}
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
        {/* 节点层 */}
        {items
          .slice()
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((item) => (
            <CardNode
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={onSelect}
              onMove={onMove}
            />
          ))}
        {/* 选中节点的变换器：缩放 + 旋转 */}
        <Transformer
          ref={transformerRef}
          rotateEnabled
          enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
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
