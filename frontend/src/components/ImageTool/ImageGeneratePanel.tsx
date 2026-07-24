import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createImageTask,
  getEcommerceSkillCatalog,
  getImageTemplateCatalog,
  getImageModelCapabilities,
  getImageTask,
  getImageAssetPreviewUrl,
  getImageAssetUsage,
  listImageAssets,
  uploadImageAsset,
} from "../../api/client";
import type { EcommerceSkillCatalog, ImageAssetOut, ImageAssetUsage, ImageModelCapability, ImageTaskStatus, ImageTemplateCatalog } from "../../types";
import "./ImageGeneratePanel.css";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "refunded"]);

const RATIO_PATTERNS = [
  { value: "16:9", pattern: /16\s*[:：]\s*9|横版|横屏/ },
  { value: "9:16", pattern: /9\s*[:：]\s*16|竖版|竖屏/ },
  { value: "4:3", pattern: /4\s*[:：]\s*3/ },
  { value: "3:4", pattern: /3\s*[:：]\s*4/ },
  { value: "3:2", pattern: /3\s*[:：]\s*2/ },
  { value: "2:3", pattern: /2\s*[:：]\s*3/ },
  { value: "1:1", pattern: /1\s*[:：]\s*1|正方形|方形/ },
] as const;

function detectRequestedRatio(text: string): string | null {
  return RATIO_PATTERNS.find((item) => item.pattern.test(text))?.value ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const STYLE_OPTIONS_BY_PRESET = {
  promo: [
    { id: "clean", label: "清晰商业" },
    { id: "minimal", label: "极简留白" },
    { id: "luxury", label: "高级质感" },
    { id: "tech", label: "科技未来" },
  ],
  ecommerce: [
    { id: "clean", label: "清透专业" },
    { id: "minimal", label: "极简留白" },
    { id: "luxury", label: "高级质感" },
    { id: "tech", label: "科技感" },
  ],
  template: [
    { id: "clean", label: "清晰商业" },
    { id: "minimal", label: "极简高级" },
    { id: "luxury", label: "品牌编辑感" },
    { id: "tech", label: "现代社媒" },
  ],
  content: [
    { id: "clean", label: "清晰易读" },
    { id: "minimal", label: "极简留白" },
    { id: "luxury", label: "杂志质感" },
    { id: "tech", label: "年轻潮流" },
  ],
} as const;

interface ImageGeneratePanelProps {
  presetId: string;
  templateId?: string | null;
  /** Called when the user clicks "进入高级模式" after a successful generation. */
  onEnterCanvas?: (taskId?: string | null) => void;
}

export function ImageGeneratePanel({ presetId, templateId, onEnterCanvas }: ImageGeneratePanelProps) {
  const [userIntent, setUserIntent] = useState("");
  const [referenceAssets, setReferenceAssets] = useState<ImageAssetOut[]>([]);
  const [assets, setAssets] = useState<ImageAssetOut[]>([]);
  const [assetUsage, setAssetUsage] = useState<ImageAssetUsage | null>(null);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});
  const [resultPreviewUrls, setResultPreviewUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reversePrompt, setReversePrompt] = useState("");
  const [generationMode, setGenerationMode] = useState<"text2image" | "image2image">("text2image");
  const [skillCatalog, setSkillCatalog] = useState<EcommerceSkillCatalog | null>(null);
  const [templateCatalog, setTemplateCatalog] = useState<ImageTemplateCatalog | null>(null);
  const [sceneId, setSceneId] = useState("hero");
  const [conversionDriver, setConversionDriver] = useState("visual");
  const [marketScope, setMarketScope] = useState("domestic");
  const [productCategory, setProductCategory] = useState("");
  const [styleVariant, setStyleVariant] = useState("clean");
  const styleOptions = STYLE_OPTIONS_BY_PRESET[presetId as keyof typeof STYLE_OPTIONS_BY_PRESET] ?? STYLE_OPTIONS_BY_PRESET.promo;
  const [styleId, setStyleId] = useState<string>(styleOptions[0].id);
  const [capabilities, setCapabilities] = useState<ImageModelCapability[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("");
  const [background, setBackground] = useState("");
  const [generationCount, setGenerationCount] = useState(1);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<ImageTaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ratioDecision, setRatioDecision] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!styleOptions.some((item) => item.id === styleId)) {
      setStyleId(styleOptions[0].id);
      setStyleVariant(styleOptions[0].id);
    }
  }, [styleId, styleOptions]);

  useEffect(() => {
    Promise.all([listImageAssets(), getImageAssetUsage()]).then(([items, usage]) => {
      setAssets(items);
      setAssetUsage(usage);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadedUrls: string[] = [];
    const loadPreviews = async () => {
      const entries = await Promise.all(assets.map(async (asset) => {
        try {
          return [asset.id, await getImageAssetPreviewUrl(asset.id)] as const;
        } catch {
          return null;
        }
      }));
      loadedUrls = entries.flatMap((entry) => entry ? [entry[1]] : []);
      if (!cancelled) setAssetPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    };
    void loadPreviews();
    return () => {
      cancelled = true;
      loadedUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assets]);

  useEffect(() => {
    let cancelled = false;
    let loadedUrls: string[] = [];
    const assetIds = taskStatus?.result_asset_ids ?? [];
    if (!assetIds.length) {
      setResultPreviewUrls([]);
      return () => { cancelled = true; };
    }
    void Promise.all(assetIds.map((assetId) => getImageAssetPreviewUrl(assetId).catch(() => null))).then((urls) => {
      loadedUrls = urls.filter((url): url is string => Boolean(url));
      if (!cancelled) setResultPreviewUrls(loadedUrls);
    });
    return () => {
      cancelled = true;
      loadedUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [taskStatus?.result_asset_ids]);

  useEffect(() => {
    getImageTemplateCatalog().then(setTemplateCatalog).catch(() => setTemplateCatalog(null));
  }, []);

  useEffect(() => {
    if (presetId !== "ecommerce") return;
    getEcommerceSkillCatalog().then(setSkillCatalog).catch(() => setSkillCatalog(null));
  }, [presetId]);

  const selectedCapability = capabilities.find((item) => item.model === selectedModel) ?? capabilities[0];
  const compatibleSizes = useMemo(
    () => selectedCapability?.sizes.filter((option) =>
      !aspectRatio || aspectRatio === "auto" || option.value === "auto" || !option.aspect_ratio || option.aspect_ratio === "auto" || option.aspect_ratio === aspectRatio
    ) ?? [],
    [selectedCapability, aspectRatio],
  );

  useEffect(() => {
    const template = templateCatalog?.templates.find((item) => item.id === templateId && item.preset_id === presetId);
    if (!template || !selectedCapability) return;
    if (selectedCapability.aspect_ratios.some((item) => item.value === template.recommended_ratio)) {
      setAspectRatio(template.recommended_ratio);
      setRatioDecision(null);
    }
  }, [presetId, templateCatalog, templateId, selectedCapability]);

  useEffect(() => {
    getImageModelCapabilities()
      .then((items) => {
        setCapabilities(items);
        const first = items[0];
        if (!first) return;
        setSelectedModel(first.model);
        setAspectRatio(first.aspect_ratios[0]?.value ?? "");
        setSize(first.sizes[0]?.value ?? "");
        setQuality(first.qualities[0]?.value ?? "");
        setBackground(first.backgrounds[0]?.value ?? "");
        setGenerationCount(first.generation_counts?.[0] ?? 1);
      })
      .catch(() => {
        setCapabilities([]);
        setError("暂时无法读取图片模型能力，请检查后端服务连接");
      });
  }, []);

  const detectedRatio = detectRequestedRatio(userIntent);
  const ratioConflict = detectedRatio && aspectRatio && detectedRatio !== aspectRatio ? detectedRatio : null;
  const ratioConflictKey = ratioConflict ? `${aspectRatio}|${ratioConflict}` : null;
  const hasUnresolvedRatioConflict = Boolean(ratioConflictKey && ratioDecision !== ratioConflictKey);

  useEffect(() => {
    if (!selectedCapability) return;
    if (!selectedCapability.aspect_ratios.some((item) => item.value === aspectRatio)) {
      setAspectRatio(selectedCapability.aspect_ratios[0]?.value ?? "");
    }
    if (!compatibleSizes.some((item) => item.value === size)) {
      setSize(compatibleSizes[0]?.value ?? "");
    }
    if (!selectedCapability.qualities.some((item) => item.value === quality)) {
      setQuality(selectedCapability.qualities[0]?.value ?? "");
    }
    if (!selectedCapability.backgrounds.some((item) => item.value === background)) {
      setBackground(selectedCapability.backgrounds[0]?.value ?? "");
    }
    const counts = selectedCapability.generation_counts ?? [1];
    if (!counts.includes(generationCount)) {
      setGenerationCount(counts[0] ?? 1);
    }
  }, [selectedCapability, compatibleSizes, aspectRatio, size, quality, background, generationCount]);

  // When the selected reference asset changes, sync the reverse-prompt editor.
  useEffect(() => {
    const primary = referenceAssets[0];
    if (primary?.vision_status === "parsed" && primary.vision_description) {
      setReversePrompt(primary.vision_description);
    } else {
      setReversePrompt("");
    }
  }, [referenceAssets]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await getImageTask(taskId);
        if (cancelled) return;
        setTaskStatus(status);
        if (status.status === "succeeded") {
          void getImageAssetUsage().then(setAssetUsage).catch(() => {});
        }
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
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("仅支持 PNG、JPEG 或 WebP 图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("图片不得超过 10MB");
      return;
    }
    if (referenceAssets.length >= 2) {
      setError("基础模式最多选择 2 张参考图片");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadImageAsset(file);
      setAssets((prev) => [asset, ...prev]);
      setReferenceAssets((prev) => [...prev, asset]);
      void getImageAssetUsage().then(setAssetUsage).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }, [referenceAssets.length]);

  const startTask = useCallback(
    async (mode: "text2image" | "image2image") => {
      if (!userIntent.trim()) {
        setError("请描述你的需求");
        return;
      }
      if (hasUnresolvedRatioConflict) {
        setError(`需求描述中提到了 ${ratioConflict}，请先确认最终比例`);
        return;
      }
      setCreating(true);
      setError(null);
      setGenerationMode(mode);
      try {
        const selectedReferences = mode === "image2image" ? referenceAssets : [];
        const resp = await createImageTask({
          preset_id: presetId,
          template_id: templateId || undefined,
          user_intent: userIntent.trim(),
          reference_asset_id: selectedReferences[0]?.id,
          reference_asset_ids: selectedReferences.map((asset) => asset.id),
          reference_assets: selectedReferences.map((asset, index) => ({
            asset_id: asset.id,
            role: index === 0 ? "product" : "detail",
          })),
          workspace_mode: "basic",
          scene_id: presetId === "ecommerce" ? sceneId : undefined,
          conversion_driver: presetId === "ecommerce" ? conversionDriver : undefined,
          product_category: presetId === "ecommerce" ? productCategory || undefined : undefined,
          market_scope: presetId === "ecommerce" ? marketScope : undefined,
          style_variant: styleVariant,
          size: size || undefined,
          model: selectedModel || undefined,
          aspect_ratio: aspectRatio || undefined,
          quality: quality || undefined,
          background: background || undefined,
          generation_count: generationCount,
          model_version: selectedModel || undefined,
          generation_mode: mode,
          edited_description: mode === "image2image" ? reversePrompt.trim() || undefined : undefined,
        });
        setTaskId(resp.task_id);
        setTaskStatus(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "创建任务失败");
      } finally {
        setCreating(false);
      }
    },
    [presetId, templateId, userIntent, referenceAssets, reversePrompt, selectedModel, aspectRatio, size, quality, background, generationCount, hasUnresolvedRatioConflict, ratioConflict, sceneId, conversionDriver, marketScope, productCategory, styleVariant]
  );



  const handleReset = useCallback(() => {
    setTaskId(null);
    setTaskStatus(null);
    setResultPreviewUrls([]);
    setError(null);
  }, []);

  const isTerminal = taskStatus && TERMINAL_STATUSES.has(taskStatus.status);
  const isRunning = taskStatus && !isTerminal;

  return (
    <div className="image-generate-panel">
      <h3>生成设置</h3>

      <div className="image-generate-field">
        <label>视觉风格</label>
        <div className="image-generate-style-options" role="listbox" aria-label="视觉风格">
          {styleOptions.map((style) => (
            <button
              key={style.id}
              type="button"
              className={`image-generate-style ${styleId === style.id ? "selected" : ""}`}
              onClick={() => { setStyleId(style.id); setStyleVariant(style.id); }}
              aria-pressed={styleId === style.id}
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      {presetId === "ecommerce" && skillCatalog && (
        <div className="image-generate-options" aria-label="电商视觉 Skill">
          <div className="image-generate-field">
            <label htmlFor="ecommerce-scene">电商场景</label>
            <select id="ecommerce-scene" value={sceneId} onChange={(e) => {
              const nextScene = skillCatalog.scenes.find((item) => item.id === e.target.value);
              setSceneId(e.target.value);
              if (nextScene && selectedCapability?.aspect_ratios.some((item) => item.value === nextScene.default_ratio)) {
                setAspectRatio(nextScene.default_ratio);
                setRatioDecision(null);
              }
            }}>
              {skillCatalog.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
            </select>
          </div>
          <div className="image-generate-field">
            <label htmlFor="ecommerce-driver">转化目标</label>
            <select id="ecommerce-driver" value={conversionDriver} onChange={(e) => setConversionDriver(e.target.value)}>
              {skillCatalog.conversion_drivers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="image-generate-field">
            <label htmlFor="ecommerce-market-scope">销售市场</label>
            <select id="ecommerce-market-scope" value={marketScope} onChange={(e) => setMarketScope(e.target.value)}>
              {(skillCatalog.market_scopes ?? [
                { id: "domestic", name: "国内电商" },
                { id: "overseas", name: "海外/跨境电商" },
              ]).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="image-generate-field">
            <label htmlFor="ecommerce-category">商品品类</label>
            <select id="ecommerce-category" value={productCategory} onChange={(e) => setProductCategory(e.target.value)}>
              <option value="">自动判断</option>
              {skillCatalog.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="image-generate-field">
            <label htmlFor="ecommerce-style-variant">电商风格</label>
            <select id="ecommerce-style-variant" value={styleVariant} onChange={(e) => setStyleVariant(e.target.value)}>
              {skillCatalog.styles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="image-generate-options" aria-label="图片规格">
        <div className="image-generate-field">
          <label htmlFor="image-model">图片模型</label>
          <select
            id="image-model"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={capabilities.length === 0}
          >
            {capabilities.map((capability) => (
              <option key={capability.model} value={capability.model}>
                {capability.label}
              </option>
            ))}
          </select>
        </div>
        <div className="image-generate-field">
          <label htmlFor="image-aspect-ratio">比例</label>
          <select
            id="image-aspect-ratio"
            value={aspectRatio}
            onChange={(event) => { setAspectRatio(event.target.value); setRatioDecision(null); }}
            disabled={!selectedCapability}
          >
            {selectedCapability?.aspect_ratios.map((option) => (
              <option key={option.value} value={option.value}>{option.label}（{option.value}）</option>
            ))}
          </select>
        </div>
        <div className="image-generate-field">
          <label htmlFor="image-size">分辨率</label>
          <select
            id="image-size"
            value={size}
            onChange={(event) => setSize(event.target.value)}
            disabled={!selectedCapability}
          >
            {compatibleSizes.map((option) => (
              <option key={option.value} value={option.value}>{option.label}（{option.value}）</option>
            ))}
          </select>
        </div>
        <div className="image-generate-field">
          <label htmlFor="image-quality">画质</label>
          <select
            id="image-quality"
            value={quality}
            onChange={(event) => setQuality(event.target.value)}
            disabled={!selectedCapability}
          >
            {selectedCapability?.qualities.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="image-generate-field">
          <label htmlFor="image-generation-count">生成数量</label>
          <select
            id="image-generation-count"
            value={generationCount}
            onChange={(event) => setGenerationCount(Number(event.target.value))}
            disabled={!selectedCapability}
          >
            {(selectedCapability?.generation_counts ?? [1]).map((count) => (
              <option key={count} value={count}>{count} 张候选图</option>
            ))}
          </select>
        </div>
      </div>

      {ratioConflict && ratioConflictKey && (
        <div className="image-generate-ratio-conflict" role="alert">
          <p>
            需求描述中提到了 <strong>{ratioConflict}</strong>，但当前选择的是 <strong>{aspectRatio}</strong>。请确认最终比例。
          </p>
          <div>
            <button type="button" onClick={() => { setAspectRatio(ratioConflict); setRatioDecision(null); }}>
              改为 {ratioConflict}
            </button>
            <button type="button" onClick={() => setRatioDecision(ratioConflictKey)}>
              保持 {aspectRatio}
            </button>
          </div>
        </div>
      )}

      {selectedCapability?.label.includes("待配置") && (
        <p className="image-generate-capability-note">当前模型的可用规格由服务端配置；未确认的能力不会在这里虚构展示。</p>
      )}

      <div className="image-generate-field">
        <label>参考图片（可选）</label>
        <div className="image-generate-storage-notice" role="status">
          <span>素材库：已保存 {assetUsage?.reference_count ?? 0} / {assetUsage?.reference_count_limit ?? 50} 张，已占用 {formatBytes(assetUsage?.reference_bytes ?? 0)} / {formatBytes(assetUsage?.reference_bytes_limit ?? 500 * 1024 * 1024)}</span>
          <span>单张图片不超过 10MB；生成结果也会计入素材库。取消选择只会移除本次使用，不会删除素材。</span>
          {assetUsage?.warning && <strong>素材库已使用超过 80%，建议及时清理。</strong>}
        </div>
        <div className="image-generate-assets">
          {assets.map((asset) => {
            const selected = referenceAssets.some((item) => item.id === asset.id);
            return (
            <div
              key={asset.id}
              className={`image-generate-asset ${selected ? "selected" : ""}`}
            >
              <button
                type="button"
                className="image-generate-asset__select"
                aria-pressed={selected}
                aria-label={`${selected ? "取消选择" : "选择"}参考图片 ${asset.original_name}`}
                onClick={() => setReferenceAssets((current) => {
                  const exists = current.some((item) => item.id === asset.id);
                  if (exists) return current.filter((item) => item.id !== asset.id);
                  if (current.length >= 2) {
                    setError("基础模式最多选择 2 张参考图片");
                    return current;
                  }
                  return [...current, asset];
                })}
              >
                {assetPreviewUrls[asset.id] && <img src={assetPreviewUrls[asset.id]} alt="" />}
                <span>{asset.original_name}</span>
                {selected && <small>已选择</small>}
                {asset.vision_status === "parsed" && <small>已识别</small>}
                {asset.vision_status === "pending" && <small>识别中</small>}
                {asset.vision_status === "failed" && <small>识别失败</small>}
              </button>
              {selected && (
                <button
                  type="button"
                  className="image-generate-asset__remove"
                  aria-label={`取消选择参考图片 ${asset.original_name}`}
                  title="取消选择"
                  onClick={() => setReferenceAssets((current) => current.filter((item) => item.id !== asset.id))}
                >
                  ×
                </button>
              )}
            </div>
            );
          })}
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
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {referenceAssets.length > 0 && (
        <div className="image-generate-field">
          <label>创作方式</label>
          <div className="image-generate-mode-options" role="group" aria-label="创作方式">
            <button type="button" className={generationMode === "text2image" ? "selected" : ""} onClick={() => setGenerationMode("text2image")}>
              仅用文字生成
            </button>
            <button type="button" className={generationMode === "image2image" ? "selected" : ""} onClick={() => setGenerationMode("image2image")}>
              基于参考图继续创作
            </button>
          </div>
          <p className="image-generate-hint">已选择 {referenceAssets.length} 张参考图；只有选择“基于参考图继续创作”时才会参与生成。</p>
          <label htmlFor="image-reverse-prompt">
            参考图描述{referenceAssets[0].vision_status === "pending" ? "（识别中…）" : "（可编辑）"}
          </label>
          <textarea
            id="image-reverse-prompt"
            value={reversePrompt}
            onChange={(e) => setReversePrompt(e.target.value)}
            placeholder={referenceAssets[0].vision_status === "failed" ? "图片识别失败，可手动输入描述" : "可补充参考图中的商品、材质和构图信息"}
            rows={3}
            disabled={referenceAssets[0].vision_status === "pending"}
          />
        </div>
      )}

      <div className="image-generate-field">
        <label htmlFor="image-intent">需求描述</label>
          <textarea
            id="image-intent"
            value={userIntent}
            onChange={(e) => { setUserIntent(e.target.value); setRatioDecision(null); }}
          placeholder="描述你想要的图片效果，如：夏日饮品促销海报，突出冰爽感"
          rows={3}
        />
      </div>

      {error && <p className="image-generate-error">{error}</p>}

      {!taskId && (
        <div className="image-generate-actions-row">
          <button
            type="button"
            className="image-generate-submit"
            disabled={creating || !userIntent.trim() || !selectedCapability || hasUnresolvedRatioConflict}
            onClick={() => void startTask(generationMode)}
          >
            {creating ? "创建中…" : generationMode === "image2image" ? "基于参考图继续创作" : "仅用文字生成"}
          </button>
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
          <div className="image-generate-result-grid">
            {(resultPreviewUrls.length ? resultPreviewUrls : (taskStatus.result_image_urls?.length ? taskStatus.result_image_urls : [taskStatus.result_image_url])).map((url, index) => (
              <img key={`${url}-${index}`} src={url} alt={`生成结果 ${index + 1}`} />
            ))}
          </div>
          <div className="image-generate-actions">
            <button type="button" onClick={handleReset}>再次生成</button>
            {onEnterCanvas && (
              <button
                type="button"
                className="image-generate-submit--secondary"
                onClick={() => onEnterCanvas(taskId)}
              >
                在高级工作台继续编辑
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
