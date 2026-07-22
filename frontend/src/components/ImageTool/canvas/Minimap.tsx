import { useCallback, useEffect, useRef } from "react";
import type { CanvasItem, CanvasViewport } from "../../../types";

interface MinimapProps {
  items: CanvasItem[];
  viewport: CanvasViewport;
  stageWidth: number;
  stageHeight: number;
  onViewportChange: (viewport: CanvasViewport) => void;
}

const MINIMAP_W = 180;
const MINIMAP_H = 120;
const PADDING = 20;

export function Minimap({
  items,
  viewport,
  stageWidth,
  stageHeight,
  onViewportChange,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);

  // 计算画布内容边界
  const getBounds = useCallback(() => {
    if (items.length === 0) {
      return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    items.forEach((item) => {
      if (item.hidden) return;
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.width);
      maxY = Math.max(maxY, item.y + item.height);
    });
    // 加 padding
    return {
      minX: minX - PADDING,
      minY: minY - PADDING,
      maxX: maxX + PADDING,
      maxY: maxY + PADDING,
    };
  }, [items]);

  // 绘制 Minimap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;

    const bounds = getBounds();
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    const scale = Math.min(MINIMAP_W / contentW, MINIMAP_H / contentH);

    // 清空
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

    // 背景
    ctx.fillStyle = "#f7f8fa";
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    // 绘制节点（简化版）
    items.forEach((item) => {
      if (item.hidden) return;
      const x = (item.x - bounds.minX) * scale;
      const y = (item.y - bounds.minY) * scale;
      const w = item.width * scale;
      const h = item.height * scale;

      // 节点颜色（根据类型）
      const colors: Record<string, string> = {
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
      ctx.fillStyle = colors[item.kind] ?? "#d1d5db";
      ctx.fillRect(x, y, w, h);

      // 边框
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    });

    // 绘制视口框（当前可见区域）
    const viewportX = (-viewport.x / viewport.scale - bounds.minX) * scale;
    const viewportY = (-viewport.y / viewport.scale - bounds.minY) * scale;
    const viewportW = (stageWidth / viewport.scale) * scale;
    const viewportH = (stageHeight / viewport.scale) * scale;

    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2;
    ctx.strokeRect(viewportX, viewportY, viewportW, viewportH);

    // 视口框半透明填充
    ctx.fillStyle = "rgba(99, 102, 241, 0.1)";
    ctx.fillRect(viewportX, viewportY, viewportW, viewportH);
  }, [items, viewport, stageWidth, stageHeight, getBounds]);

  // 点击 Minimap 定位
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const bounds = getBounds();
      const contentW = bounds.maxX - bounds.minX;
      const contentH = bounds.maxY - bounds.minY;
      const scale = Math.min(MINIMAP_W / contentW, MINIMAP_H / contentH);

      // 计算点击位置对应的画布坐标
      const canvasX = clickX / scale + bounds.minX;
      const canvasY = clickY / scale + bounds.minY;

      // 计算新的 viewport（让点击位置居中）
      const newViewportX = -(canvasX * viewport.scale - stageWidth / 2);
      const newViewportY = -(canvasY * viewport.scale - stageHeight / 2);

      onViewportChange({
        x: newViewportX,
        y: newViewportY,
        scale: viewport.scale,
      });
    },
    [getBounds, viewport.scale, stageWidth, stageHeight, onViewportChange]
  );

  // 拖拽 Minimap 视口框
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const bounds = getBounds();
      const contentW = bounds.maxX - bounds.minX;
      const contentH = bounds.maxY - bounds.minY;
      const scale = Math.min(MINIMAP_W / contentW, MINIMAP_H / contentH);

      // 检查是否点击在视口框内
      const viewportX = (-viewport.x / viewport.scale - bounds.minX) * scale;
      const viewportY = (-viewport.y / viewport.scale - bounds.minY) * scale;
      const viewportW = (stageWidth / viewport.scale) * scale;
      const viewportH = (stageHeight / viewport.scale) * scale;

      if (
        clickX >= viewportX &&
        clickX <= viewportX + viewportW &&
        clickY >= viewportY &&
        clickY <= viewportY + viewportH
      ) {
        isDragging.current = true;
      }
    },
    [getBounds, viewport, stageWidth, stageHeight]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const moveX = e.clientX - rect.left;
      const moveY = e.clientY - rect.top;

      const bounds = getBounds();
      const contentW = bounds.maxX - bounds.minX;
      const contentH = bounds.maxY - bounds.minY;
      const scale = Math.min(MINIMAP_W / contentW, MINIMAP_H / contentH);

      // 计算拖拽位置对应的画布坐标
      const canvasX = moveX / scale + bounds.minX;
      const canvasY = moveY / scale + bounds.minY;

      // 计算新的 viewport（让拖拽位置居中）
      const newViewportX = -(canvasX * viewport.scale - stageWidth / 2);
      const newViewportY = -(canvasY * viewport.scale - stageHeight / 2);

      onViewportChange({
        x: newViewportX,
        y: newViewportY,
        scale: viewport.scale,
      });
    },
    [getBounds, viewport.scale, stageWidth, stageHeight, onViewportChange]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div className="canvas-minimap">
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
