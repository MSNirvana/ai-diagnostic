import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlatformNav } from "../../platform/PlatformNav";
import { LoginPage } from "../Auth/LoginPage";
import { ImageGeneratePanel } from "./ImageGeneratePanel";
import { ImageHistoryList } from "./ImageHistoryList";
import "./ImageToolPage.css";

type PresetId = "promo" | "ecommerce" | "template";

type TemplateCase = {
  id: string;
  name: string;
  description: string;
  style: string;
  previewClass: string;
  previewKicker: string;
  previewTitle: string;
  previewMeta: string;
};

const PRESETS: Array<{
  id: PresetId;
  name: string;
  tagline: string;
  detail: string;
}> = [
  {
    id: "promo",
    name: "生成宣传海报",
    tagline: "门店活动、产品上新、节日促销",
    detail: "先选海报方向，再补充活动信息",
  },
  {
    id: "ecommerce",
    name: "生成电商套图",
    tagline: "主图、场景图、卖点图一套生成",
    detail: "围绕商品展示和转化组织画面",
  },
  {
    id: "template",
    name: "从模板开始",
    tagline: "从模板库出发，替换内容快速生成",
    detail: "适合已有品牌规范的快速套用",
  },
] as const;

const TEMPLATE_CASES: Record<PresetId, TemplateCase[]> = {
  promo: [
    {
      id: "promo-weekend",
      name: "周末门店活动",
      description: "大标题 + 活动利益点，适合门店引流",
      style: "门店活动",
      previewClass: "is-promo-warm",
      previewKicker: "WEEKEND EVENT",
      previewTitle: "周末限时活动",
      previewMeta: "到店即享专属礼遇",
    },
    {
      id: "promo-launch",
      name: "新品上新海报",
      description: "突出新品主体与上新信息，留出品牌落款",
      style: "产品上新",
      previewClass: "is-promo-clean",
      previewKicker: "NEW ARRIVAL",
      previewTitle: "夏日新品",
      previewMeta: "今日正式上线",
    },
    {
      id: "promo-festival",
      name: "节日限定主题",
      description: "节日氛围明确，适合活动预热与社媒传播",
      style: "节日促销",
      previewClass: "is-promo-festival",
      previewKicker: "LIMITED EDITION",
      previewTitle: "节日限定",
      previewMeta: "把好心意带回家",
    },
  ],
  ecommerce: [
    {
      id: "ecommerce-studio",
      name: "清透商品主图",
      description: "干净背景突出商品，适合作为首图展示",
      style: "清透棚拍",
      previewClass: "is-ecommerce-studio",
      previewKicker: "PRODUCT HERO",
      previewTitle: "清透棚拍",
      previewMeta: "主体清晰 · 信息克制",
    },
    {
      id: "ecommerce-life",
      name: "生活方式场景",
      description: "用真实使用氛围表达商品价值和生活感",
      style: "生活场景",
      previewClass: "is-ecommerce-life",
      previewKicker: "LIFESTYLE",
      previewTitle: "自然使用场景",
      previewMeta: "让商品进入日常",
    },
    {
      id: "ecommerce-detail",
      name: "卖点详情图",
      description: "围绕功能、材质、尺寸组织卖点信息",
      style: "卖点详情",
      previewClass: "is-ecommerce-detail",
      previewKicker: "DETAILS",
      previewTitle: "细节看得见",
      previewMeta: "材质 · 功能 · 规格",
    },
  ],
  template: [
    {
      id: "template-brand",
      name: "品牌上新模板",
      description: "保留品牌留白和版式，替换商品与文案即可使用",
      style: "品牌编辑感",
      previewClass: "is-template-editorial",
      previewKicker: "BRAND TEMPLATE",
      previewTitle: "品牌上新",
      previewMeta: "可替换商品与文案",
    },
    {
      id: "template-social",
      name: "社媒内容卡片",
      description: "适合小红书、朋友圈等内容发布场景",
      style: "社媒卡片",
      previewClass: "is-template-social",
      previewKicker: "SOCIAL CONTENT",
      previewTitle: "今日灵感",
      previewMeta: "一张图讲清一个卖点",
    },
    {
      id: "template-minimal",
      name: "极简产品展示",
      description: "结构清晰、信息克制，适合长期复用",
      style: "极简高级",
      previewClass: "is-template-minimal",
      previewKicker: "ESSENTIAL",
      previewTitle: "少即是多",
      previewMeta: "产品 · 留白 · 质感",
    },
  ],
};

export function ImageToolPage() {
  const navigate = useNavigate();
  const [loginOpen, setLoginOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [caseCategory, setCaseCategory] = useState<PresetId>("promo");

  const handleEnterCanvas = useCallback((taskId: string) => {
    navigate(`/tools/image/canvas?taskId=${encodeURIComponent(taskId)}`);
  }, [navigate]);

  const handlePresetClick = (presetId: PresetId) => {
    setCaseCategory(presetId);
    setActivePreset((current) => (current === presetId ? null : presetId));
    setActiveTemplateId(null);
  };

  const handleUseTemplate = (presetId: PresetId, templateId: string) => {
    setCaseCategory(presetId);
    setActivePreset(presetId);
    setActiveTemplateId(templateId);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".image-generate-panel")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const activeCases = TEMPLATE_CASES[caseCategory];

  return (
    <div className="image-tool-page">
      <PlatformNav onRequestLogin={() => setLoginOpen(true)} />
      <main className="image-tool-main">
        <header className="image-tool-header">
          <h1>图片创作</h1>
          <p>选择生成方式，上传参考图，描述你的需求</p>
        </header>

        <div className="image-tool-mode-tabs">
          <button
            type="button"
            className="image-tool-tab active"
          >
            基础模式
          </button>
          <button
            type="button"
            className="image-tool-tab"
            onClick={() => navigate("/tools/image/canvas")}
          >
            高级工作台
          </button>
        </div>

        <section className="image-tool-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`image-tool-preset-card ${activePreset === preset.id ? "active" : ""}`}
              onClick={() => handlePresetClick(preset.id)}
            >
              <span className="image-tool-preset-card__index">0{PRESETS.indexOf(preset) + 1}</span>
              <div>
                <h3>{preset.name}</h3>
                <p>{preset.tagline}</p>
                <small>{preset.detail}</small>
              </div>
            </button>
          ))}
        </section>

        <section className="image-template-gallery" aria-labelledby="image-template-gallery-title">
          <div className="image-template-gallery__heading">
            <div>
              <span className="image-template-gallery__eyebrow">模板库 · 案例预览</span>
              <h2 id="image-template-gallery-title">先选一个视觉方向</h2>
              <p>这里展示已经沉淀的生成效果，后续可以持续补充真实案例和团队模板。</p>
            </div>
            <span className="image-template-gallery__count">{activeCases.length} 个模板预览</span>
          </div>

          <div className="image-template-gallery__tabs" role="tablist" aria-label="案例分类">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="tab"
                aria-selected={caseCategory === preset.id}
                className={caseCategory === preset.id ? "active" : ""}
                onClick={() => setCaseCategory(preset.id)}
              >
                {preset.id === "promo" ? "宣传海报" : preset.id === "ecommerce" ? "电商套图" : "品牌模板"}
              </button>
            ))}
          </div>

          <div className="image-template-gallery__grid">
            {activeCases.map((template) => (
              <article className="image-template-card" key={template.id}>
                <div className={`image-template-preview ${template.previewClass}`} aria-label={`${template.name}模板预览`}>
                  <span>{template.previewKicker}</span>
                  <strong>{template.previewTitle}</strong>
                  <small>{template.previewMeta}</small>
                  <i aria-hidden="true" />
                </div>
                <div className="image-template-card__body">
                  <div>
                    <h3>{template.name}</h3>
                    <p>{template.description}</p>
                  </div>
                  <span className="image-template-card__style">{template.style}</span>
                  <button type="button" onClick={() => handleUseTemplate(caseCategory, template.id)}>使用模板</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {activePreset && (
          <ImageGeneratePanel presetId={activePreset} templateId={activeTemplateId} onEnterCanvas={handleEnterCanvas} />
        )}

        <ImageHistoryList />
      </main>

      {loginOpen && (
        <div className="image-tool-login-overlay" role="presentation" onMouseDown={() => setLoginOpen(false)}>
          <div className="image-tool-login-overlay__panel" onMouseDown={(e) => e.stopPropagation()}>
            <LoginPage modal onClose={() => setLoginOpen(false)} returnTo="/tools/image" />
          </div>
        </div>
      )}
    </div>
  );
}
