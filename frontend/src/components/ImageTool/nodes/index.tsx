import { Handle, Position } from "@xyflow/react";
import type { CanvasNodeData } from "../../../types";
import "./Nodes.css";

export function RequirementNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--requirement">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">需求/模板</div>
      <div className="canvas-node__body">
        {data.presetName && <div className="canvas-node__field">{data.presetName}</div>}
        {data.userIntent && (
          <div className="canvas-node__field canvas-node__field--muted">{data.userIntent}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function AssetNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--asset">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">素材</div>
      <div className="canvas-node__body">
        {data.assetThumbUrl ? (
          <img src={data.assetThumbUrl} alt={data.assetName ?? "素材"} className="canvas-node__thumb" />
        ) : (
          <div className="canvas-node__field canvas-node__field--muted">无参考图</div>
        )}
        {data.assetName && <div className="canvas-node__field">{data.assetName}</div>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ReversePromptNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--reverse">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">反推提示词</div>
      <div className="canvas-node__body">
        {data.reversePrompt ? (
          <div className="canvas-node__field canvas-node__field--text">{data.reversePrompt}</div>
        ) : (
          <div className="canvas-node__field canvas-node__field--muted">未提供参考图</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function PromptNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--prompt">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">提示词</div>
      <div className="canvas-node__body">
        {data.assembledPrompt ? (
          <div className="canvas-node__field canvas-node__field--text">{data.assembledPrompt}</div>
        ) : (
          <div className="canvas-node__field canvas-node__field--muted">待组装</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ModelNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--model">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">模型</div>
      <div className="canvas-node__body">
        <div className="canvas-node__field">{data.modelName ?? "image2.0"}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function GenerateNode({ data }: { data: CanvasNodeData }) {
  const status = data.taskStatus ?? "pending";
  return (
    <div className={`canvas-node canvas-node--generate canvas-node--${status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">
        图片生成{data.generationMode === "image2image" ? "（图生图）" : "（文生图）"}
      </div>
      <div className="canvas-node__body">
        <div className="canvas-node__status">{status}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ResultNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--result">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">结果</div>
      <div className="canvas-node__body">
        {data.resultImageUrl ? (
          <img src={data.resultImageUrl} alt="生成结果" className="canvas-node__thumb" />
        ) : (
          <div className="canvas-node__field canvas-node__field--muted">未生成</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ExportNode({ data }: { data: CanvasNodeData }) {
  return (
    <div className="canvas-node canvas-node--export">
      <Handle type="target" position={Position.Left} />
      <div className="canvas-node__title">导出</div>
      <div className="canvas-node__body">
        {data.resultImageUrl ? (
          <a href={data.resultImageUrl} download target="_blank" rel="noreferrer">
            下载图片
          </a>
        ) : (
          <div className="canvas-node__field canvas-node__field--muted">暂无可导出结果</div>
        )}
      </div>
    </div>
  );
}
