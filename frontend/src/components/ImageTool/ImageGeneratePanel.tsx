import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createImageTask,
  getEcommerceSkillCatalog,
  getImageTemplateCatalog,
  getImageModelCapabilities,
  getImageTask,
  listImageAssets,
  uploadImageAsset,
} from "../../api/client";
import type { EcommerceSkillCatalog, ImageAssetOut, ImageModelCapability, ImageTaskStatus, ImageTemplateCatalog } from "../../types";
import "./ImageGeneratePanel.css";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "refunded"]);

const LOCAL_IMAGE2_CAPABILITY: ImageModelCapability = {
  model: "gpt-image-2",
  label: "gpt-image-2",
  sizes: [
    { value: "1024x1024", label: "1K 方图", aspect_ratio: "1:1" },
    { value: "1536x1024", label: "1K 横图", aspect_ratio: "3:2" },
    { value: "1024x1536", label: "1K 竖图", aspect_ratio: "2:3" },
    { value: "2048x2048", label: "2K 方图", aspect_ratio: "1:1" },
    { value: "2048x1152", label: "2K 横图", aspect_ratio: "16:9" },
    { value: "3840x2160", label: "4K 横图", aspect_ratio: "16:9" },
    { value: "2160x3840", label: "4K 竖图", aspect_ratio: "9:16" },
    { value: "auto", label: "自动", aspect_ratio: "auto" },
  ],
  aspect_ratios: [
    { value: "1:1", label: "1:1 方形" },
    { value: "3:2", label: "3:2 横向" },
    { value: "2:3", label: "2:3 纵向" },
    { value: "16:9", label: "16:9 横屏" },
    { value: "9:16", label: "9:16 竖屏" },
    { value: "auto", label: "自动" },
  ],
  qualities: [
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
    { value: "auto", label: "自动" },
  ],
  backgrounds: [{ value: "opaque", label: "不透明" }],
  generation_counts: [1],
  max_count: 1,
};

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

const STYLE_OPTIONS_BY_PRESET = {
  promo: [
    { id: "store-event", label: "门店活动", prompt: "宣传海报视觉，活动信息醒目，适合门店引流和到店转化" },
    { id: "seasonal-promo", label: "节日促销", prompt: "节日促销海报，氛围明确，重点突出优惠和活动时间" },
    { id: "new-arrival", label: "产品上新", prompt: "产品上新海报，版式清晰，突出新品主体、卖点和品牌信息" },
    { id: "editorial", label: "杂志排版", prompt: "编辑感海报排版，留白克制，文字层级清楚，适合品牌传播" },
    { id: "cinematic", label: "电影质感", prompt: "电影感宣传海报光影，具有层次和情绪，但保持产品事实和主体准确" },
  ],
  ecommerce: [
    { id: "studio", label: "清透棚拍", prompt: "电商商品棚拍，背景干净，主体边缘清晰，适合首图展示" },
    { id: "lifestyle", label: "生活场景", prompt: "电商生活方式场景，真实自然光影，体现商品使用氛围和生活质感" },
    { id: "detail", label: "卖点详情", prompt: "电商详情图视觉，围绕材质、功能、尺寸组织清晰的信息层级" },
    { id: "minimal", label: "极简留白", prompt: "电商极简构图，留白克制，商品材质细节清晰，适合高端展示" },
    { id: "ecommerce", label: "电商清晰", prompt: "干净专业，突出商品主体，背景简洁，适合电商展示" },
  ],
  template: [
    { id: "brand-editorial", label: "品牌编辑感", prompt: "可复用的品牌编辑感模板，保留品牌留白、版式秩序和稳定识别" },
    { id: "social-card", label: "社媒卡片", prompt: "适合社交媒体发布的内容卡片，信息聚焦，标题和卖点易读" },
    { id: "minimal", label: "极简高级", prompt: "极简构图，留白克制，材质细节清晰，高级商业视觉" },
    { id: "lifestyle", label: "生活方式", prompt: "自然生活场景，真实光影，体现产品使用氛围和生活质感" },
  ],
} as const;

interface ImageGeneratePanelProps {
  presetId: string;
  templateId?: string | null;
  /** Called when the user clicks "进入高级模式" after a successful generation. */
  onEnterCanvas?: (taskId: string) => void;
}

export function ImageGeneratePanel({ presetId, templateId, onEnterCanvas }: ImageGeneratePanelProps) {
  const [userIntent, setUserIntent] = useState("");
  const [referenceAsset, setReferenceAsset] = useState<ImageAssetOut | null>(null);
  const [assets, setAssets] = useState<ImageAssetOut[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reversePrompt, setReversePrompt] = useState("");
  const [generationMode, setGenerationMode] = useState<"text2image" | "image2image">("image2image");
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
    }
  }, [styleId, styleOptions]);

  useEffect(() => {
    listImageAssets().then(setAssets).catch(() => {});
  }, []);

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
        const available = items.length > 0 ? items : [LOCAL_IMAGE2_CAPABILITY];
        setCapabilities(available);
        const first = available[0];
        if (!first) return;
        setSelectedModel(first.model);
        setAspectRatio(first.aspect_ratios[0]?.value ?? "");
        setSize(first.sizes[0]?.value ?? "");
        setQuality(first.qualities[0]?.value ?? "");
        setBackground(first.backgrounds[0]?.value ?? "");
        setGenerationCount(first.generation_counts?.[0] ?? 1);
      })
      .catch(() => {
        setCapabilities([LOCAL_IMAGE2_CAPABILITY]);
        setSelectedModel(LOCAL_IMAGE2_CAPABILITY.model);
        setAspectRatio(LOCAL_IMAGE2_CAPABILITY.aspect_ratios[0].value);
        setSize(LOCAL_IMAGE2_CAPABILITY.sizes[0].value);
        setQuality(LOCAL_IMAGE2_CAPABILITY.qualities[0].value);
        setBackground(LOCAL_IMAGE2_CAPABILITY.backgrounds[0].value);
        setGenerationCount(LOCAL_IMAGE2_CAPABILITY.generation_counts[0]);
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
      if (hasUnresolvedRatioConflict) {
        setError(`需求描述中提到了 ${ratioConflict}，请先确认最终比例`);
        return;
      }
      setCreating(true);
      setError(null);
      setGenerationMode(mode);
      try {
        const style = styleOptions.find((item) => item.id === styleId)?.prompt;
        const resp = await createImageTask({
          preset_id: presetId,
          template_id: templateId || undefined,
          user_intent: userIntent.trim(),
          reference_asset_id: referenceAsset?.id,
          style,
          scene_id: presetId === "ecommerce" ? sceneId : undefined,
          conversion_driver: presetId === "ecommerce" ? conversionDriver : undefined,
          product_category: presetId === "ecommerce" ? productCategory || undefined : undefined,
          market_scope: presetId === "ecommerce" ? marketScope : undefined,
          style_variant: presetId === "ecommerce" ? styleVariant : undefined,
          size: size || undefined,
          model: selectedModel || undefined,
          aspect_ratio: aspectRatio || undefined,
          quality: quality || undefined,
          background: background || undefined,
          generation_count: generationCount,
          model_version: selectedModel || undefined,
          generation_mode: mode,
          edited_description: reversePrompt.trim() || undefined,
        });
        setTaskId(resp.task_id);
        setTaskStatus(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "创建任务失败");
      } finally {
        setCreating(false);
      }
    },
    [presetId, templateId, userIntent, referenceAsset, reversePrompt, styleId, styleOptions, selectedModel, aspectRatio, size, quality, background, generationCount, hasUnresolvedRatioConflict, ratioConflict, sceneId, conversionDriver, marketScope, productCategory, styleVariant]
  );



  const handleReset = useCallback(() => {
    setTaskId(null);
    setTaskStatus(null);
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
              onClick={() => setStyleId(style.id)}
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
                { id: "domestic", name: "国内电商", prompt: "" },
                { id: "overseas", name: "海外/跨境电商", prompt: "" },
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
            onChange={(e) => { setUserIntent(e.target.value); setRatioDecision(null); }}
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
                disabled={creating || !userIntent.trim() || !selectedCapability || hasUnresolvedRatioConflict}
                onClick={() => void startTask("image2image")}
              >
                {creating && generationMode === "image2image" ? "创建中…" : "以原图二次创作"}
              </button>
              <button
                type="button"
                className="image-generate-submit image-generate-submit--secondary"
                disabled={creating || !userIntent.trim() || !selectedCapability || hasUnresolvedRatioConflict}
                onClick={() => void startTask("text2image")}
              >
                {creating && generationMode === "text2image" ? "创建中…" : "基于提示词生成"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="image-generate-submit"
              disabled={creating || !userIntent.trim() || !selectedCapability || hasUnresolvedRatioConflict}
              onClick={() => void startTask("text2image")}
            >
              {creating ? "创建中…" : "生成图片"}
            </button>
          )}
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
            {(taskStatus.result_image_urls?.length ? taskStatus.result_image_urls : [taskStatus.result_image_url]).map((url, index) => (
              <img key={`${url}-${index}`} src={url} alt={`生成结果 ${index + 1}`} />
            ))}
          </div>
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
