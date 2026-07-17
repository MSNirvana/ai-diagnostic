import { useState } from "react";
import { PlatformNav } from "../../platform/PlatformNav";
import { LoginPage } from "../Auth/LoginPage";
import { useAuth } from "../../auth/useAuth";
import { ImageGeneratePanel } from "./ImageGeneratePanel";
import { ImageHistoryList } from "./ImageHistoryList";
import "./ImageToolPage.css";

const PRESETS = [
  {
    id: "promo",
    name: "一键生成宣传图",
    tagline: "为门店、活动、产品快速生成宣传海报",
  },
  {
    id: "ecommerce",
    name: "一键生成电商图",
    tagline: "为商品生成主图、详情图、场景图",
  },
  {
    id: "template",
    name: "从模板开始",
    tagline: "选择预设模板，快速生成定制化图片",
  },
] as const;

export function ImageToolPage() {
  const { isAuthenticated } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  return (
    <div className="image-tool-page">
      <PlatformNav onRequestLogin={() => setLoginOpen(true)} />
      <main className="image-tool-main">
        <header className="image-tool-header">
          <h1>图片创作</h1>
          <p>选择生成方式，上传参考图，描述你的需求</p>
        </header>

        <section className="image-tool-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`image-tool-preset-card ${activePreset === preset.id ? "active" : ""}`}
              onClick={() => setActivePreset(activePreset === preset.id ? null : preset.id)}
            >
              <h3>{preset.name}</h3>
              <p>{preset.tagline}</p>
            </button>
          ))}
        </section>

        {activePreset && isAuthenticated && (
          <ImageGeneratePanel presetId={activePreset} />
        )}

        {activePreset && !isAuthenticated && (
          <div className="image-tool-login-hint">
            <p>请先登录 GGOO 账号后使用图片生成</p>
            <button type="button" onClick={() => setLoginOpen(true)}>
              去登录
            </button>
          </div>
        )}

        {isAuthenticated && <ImageHistoryList />}
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
