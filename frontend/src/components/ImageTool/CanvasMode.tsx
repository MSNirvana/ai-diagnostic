import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PlatformNav } from "../../platform/PlatformNav";
import { getImageTask } from "../../api/client";
import type { ImageTaskStatus } from "../../types";
import { buildCanvasNodes, buildEmptyCanvasNodes } from "./buildCanvasNodes";
import {
  AssetNode,
  ExportNode,
  GenerateNode,
  ModelNode,
  PromptNode,
  RequirementNode,
  ResultNode,
  ReversePromptNode,
} from "./nodes";
import "./CanvasMode.css";

const nodeTypes = {
  requirement: RequirementNode,
  asset: AssetNode,
  reversePrompt: ReversePromptNode,
  prompt: PromptNode,
  model: ModelNode,
  generate: GenerateNode,
  result: ResultNode,
  export: ExportNode,
};

interface CanvasModeProps {
  /** When set, expand the canvas from this task's payload. */
  taskId?: string | null;
  /** Called when the user wants to go back to basic mode. */
  onBack?: () => void;
}

export function CanvasMode({ taskId, onBack }: CanvasModeProps) {
  const [task, setTask] = useState<ImageTaskStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getImageTask(taskId)
      .then((t) => {
        if (!cancelled) setTask(t);
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

  const { nodes, edges } = useMemo(() => {
    if (task) {
      return buildCanvasNodes(task, {
        preset_id: task.preset_id ?? undefined,
        user_intent: task.user_intent ?? undefined,
        reverse_prompt: task.reverse_prompt ?? undefined,
        edited_description: task.reverse_prompt ?? undefined,
        assembled_prompt: task.assembled_prompt ?? undefined,
        generation_mode: task.generation_mode ?? undefined,
      });
    }
    return buildEmptyCanvasNodes();
  }, [task]);

  return (
    <div className="canvas-mode-page">
      <PlatformNav />
      <main className="canvas-mode-main">
        <header className="canvas-mode-header">
          <h1>图片创作 · 高级模式</h1>
          <p>
            {taskId
              ? "已展开本次任务的节点链，首版为只读视图"
              : "空白画布，从左侧节点工具箱开始搭建工作流"}
          </p>
          {onBack && (
            <button type="button" className="canvas-mode-back" onClick={onBack}>
              返回基础模式
            </button>
          )}
        </header>

        {loading && <p className="canvas-mode-loading">加载任务中…</p>}
        {error && <p className="canvas-mode-error">{error}</p>}

        <div className="canvas-mode-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </main>
    </div>
  );
}
