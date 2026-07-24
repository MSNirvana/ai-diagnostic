import type { ChangeEvent } from "react";
import type { CanvasBundleCardType, CanvasItem, CanvasItemMetadata, ImageModelCapability } from "../../../types";

interface CanvasNodeInspectorProps {
  item: CanvasItem;
  items: CanvasItem[];
  onUpdate: (id: string, patch: Partial<CanvasItem>) => void;
  onUpdateMetadata: (id: string, patch: Partial<CanvasItemMetadata>) => void;
  onUpload: (id: string, file: File) => void;
  onConnect: (fromId: string, toId: string, fromPortId?: string, toPortId?: string) => void;
  onDisconnect: (fromId: string, toId: string, fromPortId?: string, toPortId?: string) => void;
  onGenerateReverseDraft: (id: string) => void;
  onGenerateBundleCards: (id: string) => void;
  onCreateFollowup: (id: string, kind: "edit" | "upscale") => void;
  onExecuteEdit: (id: string) => void;
  onExecuteGenerate: (id: string) => void;
  capabilities: ImageModelCapability[];
}

const DEMAND_OPTIONS = [
  ["ecommerce_bundle", "生成电商套图"],
  ["hero_image", "生成商品主图"],
  ["detail_image", "生成产品详情图"],
  ["poster", "生成宣传海报"],
] as const;

const REFERENCE_ROLES = [
  ["product", "产品事实"],
  ["detail", "产品细节"],
  ["style", "视觉风格"],
  ["scene", "使用场景"],
  ["brand", "品牌资产"],
  ["parameter", "参数来源"],
  ["layout", "版式参考"],
  ["copy", "文案参考"],
  ["other", "其他参考"],
] as const;

const CARD_TYPES: Array<[CanvasBundleCardType, string]> = [
  ["hero", "商品主图"],
  ["detail", "产品细节图"],
  ["feature", "产品卖点图"],
  ["parameter", "产品参数图"],
  ["lifestyle", "生活场景图"],
  ["comparison", "对比说明图"],
  ["custom", "自定义图片"],
];

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="canvas-node-inspector__field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} rows={3} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]> | ReadonlyArray<string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="canvas-node-inspector__field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const [optionValue, optionLabel] = typeof option === "string" ? [option, option] : option;
          return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    </label>
  );
}

export function CanvasNodeInspector({
  item,
  items,
  onUpdate,
  onUpdateMetadata,
  onUpload,
  onConnect,
  onDisconnect,
  onGenerateReverseDraft,
  onGenerateBundleCards,
  onCreateFollowup,
  onExecuteEdit,
  onExecuteGenerate,
  capabilities,
}: CanvasNodeInspectorProps) {
  const metadata = item.metadata ?? {};
  const update = (patch: Partial<CanvasItemMetadata>) => onUpdateMetadata(item.id, patch);
  const connectedSourceIds = new Set(metadata.sourceNodeIds ?? []);
  const sourceCandidates = items.filter((candidate) => candidate.id !== item.id && candidate.kind !== "bundleCard");
  const capability = capabilities.find((entry) => entry.model === (metadata.modelName ?? "gpt-image-2")) ?? capabilities[0];
  const modelOptions = capabilities.map((entry) => [entry.model, entry.label] as const);
  const ratioOptions = capability?.aspect_ratios.map((option) => [option.value, `${option.label}（${option.value}）`] as const) ?? [];
  const selectedRatio = metadata.aspectRatio ?? capability?.aspect_ratios[0]?.value ?? "auto";
  const compatibleSizes = capability?.sizes.filter((option) =>
    !selectedRatio || selectedRatio === "auto" || option.value === "auto" || !option.aspect_ratio || option.aspect_ratio === "auto" || option.aspect_ratio === selectedRatio,
  ) ?? [];
  const sizeOptions = compatibleSizes.map((option) => [option.value, `${option.label}（${option.value}）`] as const);
  const selectedSize = compatibleSizes.some((option) => option.value === metadata.size)
    ? metadata.size!
    : compatibleSizes[0]?.value ?? "auto";
  const qualityOptions = capability?.qualities.map((option) => [option.value, option.label] as const) ?? [];

  const handleRatioChange = (value: string) => {
    const nextSize = capability?.sizes.find((option) =>
      option.value === "auto" || !option.aspect_ratio || option.aspect_ratio === "auto" || option.aspect_ratio === value,
    )?.value;
    update({ aspectRatio: value, ...(nextSize ? { size: nextSize } : {}) });
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onUpload(item.id, file);
    event.target.value = "";
  };

  return (
    <div className="canvas-node-inspector">
      <div className="canvas-node-inspector__identity">
        <span className="canvas-node-inspector__kind">{item.kind}</span>
        <input
          aria-label="节点名称"
          value={item.label}
          onChange={(event) => onUpdate(item.id, { label: event.target.value })}
        />
      </div>

      {item.kind === "requirement" && (
        <>
          <SelectField label="需求方向" value={metadata.demandType ?? "ecommerce_bundle"} options={DEMAND_OPTIONS} onChange={(value) => update({ demandType: value })} />
          <TextField label="用户需求" value={metadata.userIntent ?? ""} multiline placeholder="描述这套图片要完成什么业务目标" onChange={(value) => update({ userIntent: value })} />
          <TextField label="产品事实 / 卖点" value={metadata.productFacts ?? ""} multiline placeholder="只填写已确认的产品信息、参数和卖点" onChange={(value) => update({ productFacts: value })} />
          <TextField label="渠道" value={metadata.channel ?? ""} placeholder="例如：天猫首图、社媒投放" onChange={(value) => update({ channel: value })} />
          <TextField label="目标受众" value={metadata.audience ?? ""} placeholder="例如：通勤用户、家庭用户" onChange={(value) => update({ audience: value })} />
        </>
      )}

      {(item.kind === "asset" || item.kind === "reference") && (
        <>
          <SelectField label="参考角色" value={metadata.referenceRole ?? "product"} options={REFERENCE_ROLES} onChange={(value) => update({ referenceRole: value as CanvasItemMetadata["referenceRole"] })} />
          <label className="canvas-node-inspector__upload">
            <span>上传参考素材</span>
            <input type="file" accept="image/*" onChange={handleFile} />
          </label>
          {metadata.assetName && <p className="canvas-node-inspector__hint">当前素材：{metadata.assetName}</p>}
          {metadata.uploadStatus === "uploading" && <p className="canvas-node-inspector__hint">素材上传中…</p>}
          {metadata.uploadStatus === "uploaded" && <p className="canvas-node-inspector__success">素材已进入工作流</p>}
          {metadata.uploadStatus === "failed" && <p className="canvas-node-inspector__error">素材上传失败，请重试</p>}
        </>
      )}

      {item.kind === "reversePrompt" && (
        <>
          <label className="canvas-node-inspector__checkbox">
            <input type="checkbox" checked={metadata.reversePromptEnabled ?? false} onChange={(event) => update({ reversePromptEnabled: event.target.checked })} />
            <span>启用反推提示词</span>
          </label>
          <SelectField label="反推模型" value={metadata.reversePromptModel ?? "auto"} options={[["auto", "平台低成本视觉模型（自动）"]]} onChange={(value) => update({ reversePromptModel: value })} />
          <SelectField
            label="反推重点"
            value={metadata.reversePromptFocus ?? "all"}
            options={[["all", "风格、版式、产品特征和文案结构"], ["style", "视觉风格与版式"], ["product", "产品特征与材质"], ["copy", "文案结构与卖点"]]}
            onChange={(value) => update({ reversePromptFocus: value })}
          />
          <TextField label="反推结果（可编辑）" value={metadata.reversePrompt ?? ""} multiline placeholder="反推结果会作为后续提示词节点的输入" onChange={(value) => update({ reversePrompt: value })} />
          <button type="button" className="canvas-node-inspector__primary" onClick={() => onGenerateReverseDraft(item.id)}>
            调用 AI 反推提示词
          </button>
          <p className="canvas-node-inspector__hint">执行时会保存当前画布快照，并使用已连接的真实图片素材调用平台视觉接口。</p>
        </>
      )}

      {item.kind === "prompt" && (
        <>
          <TextField label="图片提示词" value={metadata.prompt ?? metadata.assembledPrompt ?? ""} multiline placeholder="描述画面主体、构图、风格和需要保留的事实" onChange={(value) => update({ prompt: value, assembledPrompt: value })} />
          <TextField label="文案建议" value={metadata.copySuggestion ?? ""} multiline placeholder="这张图要讲清楚什么" onChange={(value) => update({ copySuggestion: value })} />
          <p className="canvas-node-inspector__hint">提示词节点会读取需求、反推和参考节点的连接数据。</p>
        </>
      )}

      {item.kind === "model" && (
        <>
          <SelectField label="图片生成模型" value={metadata.modelName ?? capability?.model ?? "gpt-image-2"} options={modelOptions} onChange={(value) => update({ modelName: value, modelVersion: value })} />
          <SelectField label="比例" value={selectedRatio} options={ratioOptions} onChange={handleRatioChange} />
          <SelectField label="分辨率" value={selectedSize} options={sizeOptions} onChange={(value) => update({ size: value })} />
          <SelectField label="画质" value={metadata.quality ?? capability?.qualities[0]?.value ?? "auto"} options={qualityOptions} onChange={(value) => update({ quality: value })} />
          {!capability && <p className="canvas-node-inspector__hint">尚未读取服务端模型能力，暂不能修改规格。</p>}
        </>
      )}

      {item.kind === "bundle" && (
        <>
          <label className="canvas-node-inspector__field">
            <span>套图数量（可配置）</span>
            <input type="number" min="1" step="1" value={metadata.generationCount ?? 6} onChange={(event) => update({ generationCount: Math.max(1, Number(event.target.value) || 1) })} />
          </label>
          <SelectField label="统一比例" value={selectedRatio} options={ratioOptions} onChange={handleRatioChange} />
          <SelectField label="统一分辨率" value={selectedSize} options={sizeOptions} onChange={(value) => update({ size: value })} />
          <SelectField label="统一画质" value={metadata.quality ?? capability?.qualities[0]?.value ?? "auto"} options={qualityOptions} onChange={(value) => update({ quality: value })} />
          <TextField label="套图规则" value={metadata.cardPurpose ?? "主图、细节图、卖点图、参数图"} multiline onChange={(value) => update({ cardPurpose: value })} />
          <p className="canvas-node-inspector__hint">修改数量后，点击“按配置生成卡片”更新容器中的图片卡片。</p>
          <button type="button" className="canvas-node-inspector__primary" onClick={() => onGenerateBundleCards(item.id)}>
            按配置生成卡片
          </button>
        </>
      )}

      {item.kind === "bundleCard" && (
        <>
          <SelectField label="图片用途" value={metadata.cardType ?? "custom"} options={CARD_TYPES} onChange={(value) => update({ cardType: value as CanvasBundleCardType })} />
          <TextField label="这张图要讲什么" value={metadata.cardPurpose ?? ""} multiline placeholder="例如：讲清楚产品的长效保温参数" onChange={(value) => update({ cardPurpose: value })} />
          <TextField label="卡片文案" value={metadata.copySuggestion ?? ""} multiline placeholder="填写这张图需要出现的文案结构" onChange={(value) => update({ copySuggestion: value })} />
          <TextField label="卡片提示词" value={metadata.prompt ?? ""} multiline placeholder="为这张图补充独立提示词" onChange={(value) => update({ prompt: value })} />
          <div className="canvas-node-inspector__sources">
            <span>连接参考来源</span>
            {sourceCandidates.map((source) => (
              <label key={source.id} className="canvas-node-inspector__checkbox">
                <input
                  type="checkbox"
                  checked={connectedSourceIds.has(source.id)}
                  onChange={(event) => event.target.checked ? onConnect(source.id, item.id) : onDisconnect(source.id, item.id)}
                />
                <span>{source.label}（{source.kind}）</span>
              </label>
            ))}
          </div>
        </>
      )}

      {item.kind === "generate" && (
        <>
          <SelectField label="生成模型" value={metadata.modelName ?? capability?.model ?? "gpt-image-2"} options={modelOptions} onChange={(value) => update({ modelName: value, modelVersion: value })} />
          <p className="canvas-node-inspector__hint">生成节点会读取已连接的提示词、模型、版式和参考来源，真实任务创建仍由后端任务接口负责。</p>
          <div className="canvas-node-inspector__status">当前状态：{metadata.taskStatus ?? "待连接输入"}</div>
          {metadata.taskError && <p className="canvas-node-inspector__error">{metadata.taskError}</p>}
          <button type="button" className="canvas-node-inspector__primary" onClick={() => onExecuteGenerate(item.id)}>
            执行图片生成
          </button>
        </>
      )}

      {(item.kind === "result" || item.kind === "export") && (
        <>
          <p className="canvas-node-inspector__hint">该节点会接收上游生成结果；当前还没有可展示的真实图片结果。</p>
          {item.kind === "result" && (
            <div className="canvas-node-inspector__actions">
              <button type="button" className="canvas-node-inspector__primary" onClick={() => onCreateFollowup(item.id, "edit")}>
                基于此结果继续修改
              </button>
            </div>
          )}
        </>
      )}

      {item.kind === "edit" && (
        <>
          <SelectField label="修改方式" value={metadata.editMode ?? "full"} options={[["full", "整体重绘"], ["masked", "局部重绘"]]} onChange={(value) => update({ editMode: value as CanvasItemMetadata["editMode"] })} />
          <TextField label="补充修改要求" value={metadata.editPrompt ?? ""} multiline placeholder="例如：保留产品形状，只更换背景和光线" onChange={(value) => update({ editPrompt: value })} />
          <div className="canvas-node-inspector__status">当前状态：{metadata.taskStatus ?? "待执行"}</div>
          {metadata.taskError && <p className="canvas-node-inspector__error">{metadata.taskError}</p>}
          <button type="button" className="canvas-node-inspector__primary" onClick={() => onExecuteEdit(item.id)}>
            执行图片修改
          </button>
          <p className="canvas-node-inspector__hint">执行后会读取上游真实图片资产，并把新结果写回下游结果节点。</p>
        </>
      )}

      {item.kind === "upscale" && (
        <>
          <SelectField label="放大倍率" value={metadata.upscaleFactor ?? "2x"} options={[["2x", "2 倍"], ["4x", "4 倍"]]} onChange={(value) => update({ upscaleFactor: value as CanvasItemMetadata["upscaleFactor"] })} />
          <div className="canvas-node-inspector__status">当前状态：{metadata.taskStatus ?? "待执行"}</div>
          <p className="canvas-node-inspector__hint">超分辨率服务接入后，将使用上游结果生成高清版本。</p>
        </>
      )}

      {metadata.conflictMessage && <p className="canvas-node-inspector__warning">{metadata.conflictMessage}</p>}
    </div>
  );
}
