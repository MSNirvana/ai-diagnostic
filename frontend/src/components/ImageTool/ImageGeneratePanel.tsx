import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmImageTask,
  createImageTask,
  getImageTask,
  listImageAssets,
  uploadImageAsset,
} from "../../api/client";
import type { ImageAssetOut, ImageTaskStatus } from "../../types";
import "./ImageGeneratePanel.css";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "refunded"]);

interface ImageGeneratePanelProps {
  presetId: string;
  /** Called when the user clicks "进入高级模式" after a successful generation. */
  onEnterCanvas?: (taskId: string) => void;
}

export function ImageGeneratePanel({ presetId, onEnterCanvas }: ImageGeneratePanelProps) {
  const [userIntent, setUserIntent] = useState("");
  const [referenceAsset, setReferenceAsset] = useState<ImageAssetOut | null>(null);
  const [assets, setAssets] = useState<ImageAssetOut[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reversePrompt, setReversePrompt] = useState("");
  const [generationMode, setGenerationMode] = useState<"text2image" | "image2image">("image2image");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [quotePoints, setQuotePoints] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listImageAssets().then(setAssets).catch(() => {});
  }, []);

  // When the selected reference asset changes, sync the reverse-prompt editor.
  useEffect(() => {
    if (referenceAsset?.vision_status === "parsed" && referenceAsset.vision_description) {
      setReversePrompt(referenceAsset.vision_description);
    } else {
      setReversePrompt("");
    }
  }, [referenceAsset]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await getImageTask(taskId);
        if (cancelled) return;
        setTaskStatus(status);
        if (TERMINAL_STATUSES.has(status.status)) return;
        timer = setTimeout(poll, 3500);
      } catch (e) {
        if (!cancelled) {
          setTaskStatus((cur) =>
            cur
              ? { ...cur, status: "failed", error: e instanceof Error ? e.message : "状态获取失败" }
              : cur
          );
        }
      }
    };

    timer = setTimeout(poll, 1800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadImageAsset(file);
      setAssets((prev) => [asset, ...prev]);
      setReferenceAsset(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }, []);

  const startTask = useCallback(
    async (mode: "text2image" | "image2image") => {
      if (!userIntent.trim()) {
        setError("请描述你的需求");
        return;
      }
      setCreating(true);
      setError(null);
      setGenerationMode(mode);
      try {
        const resp = await createImageTask({
          preset_id: presetId,
          user_intent: userIntent.trim(),
          reference_asset_id: referenceAsset?.id,
          generation_mode: mode,
          edited_description: reversePrompt.trim() || undefined,
        });
        setTaskId(resp.task_id);
        setQuotePoints(resp.quote_points);
        setTaskStatus(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "创建任务失败");
      } finally {
        setCreating(false);
      }
    },
    [presetId, userIntent, referenceAsset, reversePrompt]
  );

  const handleConfirm = useCallback(async () => {
    if (!taskId) return;
    try {
      const status = await confirmImageTask(taskId);
      setTaskStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认失败");
    }
  }, [taskId]);

  const handleReset = useCallback(() => {
    setTaskId(null);
    setTaskStatus(null);
    setQuotePoints(null);
    setError(null);
  }, []);

  const isTerminal = taskStatus && TERMINAL_STATUSES.has(taskStatus.status);
  const isQuoted = taskStatus?.status === "quoted";
  const isRunning = taskStatus && !isTerminal && !isQuoted;

  return (
    <div className="image-generate-panel">
      <h3>生成设置</h3>

      <div className="image-generate-field">
        <label>参考图片（可选）</label>
        <div className="image-generate-assets">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={`image-generate-asset ${referenceAsset?.id === asset.id ? "selected" : ""}`}
              onClick={() => setReferenceAsset(referenceAsset?.id === asset.id ? null : asset)}
            >
              <span>{asset.original_name}</span>
              {asset.vision_status === "parsed" && <small>已识别</small>}
              {asset.vision_status === "pending" && <small>识别中</small>}
              {asset.vision_status === "failed" && <small>识别失败</small>}
            </button>
          ))}
          <button
            type="button"
            className="image-generate-upload"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "上传中…" : "+ 上传图片"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {referenceAsset && (
        <div className="image-generate-field">
          <label htmlFor="image-reverse-prompt">
            反推提示词{referenceAsset.vision_status === "pending" ? "（识别中…）" : "（可编辑）"}
          </label>
          <textarea
            id="image-reverse-prompt"
            value={reversePrompt}
            onChange={(e) => setReversePrompt(e.target.value)}
            placeholder={referenceAsset.vision_status === "failed" ? "图片识别失败，可手动输入描述" : "基于参考图反推的提示词，可修改"}
            rows={3}
            disabled={referenceAsset.vision_status === "pending"}
          />
        </div>
      )}

      <div className="image-generate-field">
        <label htmlFor="image-intent">需求描述</label>
        <textarea
          id="image-intent"
          value={userIntent}
          onChange={(e) => setUserIntent(e.target.value)}
          placeholder="描述你想要的图片效果，如：夏日饮品促销海报，突出冰爽感"
          rows={3}
        />
      </div>

      {error && <p className="image-generate-error">{error}</p>}

      {!taskId && (
        <div className="image-generate-actions-row">
          {referenceAsset ? (
            <>
              <button
                type="button"
                className="image-generate-submit"
                disabled={creating || !userIntent.trim()}
                onClick={() => void startTask("image2image")}
              >
                {creating && generationMode === "image2image" ? "创建中…" : "以原图二次创作"}
              </button>
              <button
                type="button"
                className="image-generate-submit image-generate-submit--secondary"
                disabled={creating || !userIntent.trim()}
                onClick={() => void startTask("text2image")}
              >
                {creating && generationMode === "text2image" ? "创建中…" : "基于提示词生成"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="image-generate-submit"
              disabled={creating || !userIntent.trim()}
              onClick={() => void startTask("text2image")}
            >
              {creating ? "创建中…" : "获取报价"}
            </button>
          )}
        </div>
      )}

      {isQuoted && (
        <div className="image-generate-quote">
          <p>
            预估积分：
            {quotePoints !== null ? <strong>{quotePoints}</strong> : <span>暂无法预估</span>}
          </p>
          <div className="image-generate-actions">
            <button type="button" onClick={() => void handleConfirm()}>
              确认生成
            </button>
            <button type="button" onClick={handleReset}>
              取消
            </button>
          </div>
        </div>
      )}

      {isRunning && (
        <div className="image-generate-progress">
          <p>生成中… {taskStatus.progress}%</p>
          <div className="image-generate-progress-bar">
            <div style={{ width: `${taskStatus.progress}%` }} />
          </div>
        </div>
      )}

      {taskStatus?.status === "succeeded" && taskStatus.result_image_url && (
        <div className="image-generate-result">
          <img src={taskStatus.result_image_url} alt="生成结果" />
          <div className="image-generate-actions">
            <button type="button" onClick={handleReset}>再次生成</button>
            {onEnterCanvas && taskId && (
              <button
                type="button"
                className="image-generate-submit--secondary"
                onClick={() => onEnterCanvas(taskId)}
              >
                进入高级模式
              </button>
            )}
          </div>
        </div>
      )}

      {taskStatus?.status === "failed" && (
        <div className="image-generate-failed">
          <p>生成失败：{taskStatus.error || "未知错误"}</p>
          <button type="button" onClick={handleReset}>重试</button>
        </div>
      )}
    </div>
  );
}
