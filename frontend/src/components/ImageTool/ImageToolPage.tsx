import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlatformNav } from "../../platform/PlatformNav";
import { LoginPage } from "../Auth/LoginPage";
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
  const navigate = useNavigate();
  const [loginOpen, setLoginOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const handleEnterCanvas = useCallback(
    (taskId: string) => {
      navigate(`/tools/image/canvas?taskId=${encodeURIComponent(taskId)}`);
    },
    [navigate],
  );

  const handleEnterAdvanced = useCallback(() => {
    navigate("/tools/image/canvas");
  }, [navigate]);

  return (
    <div className="image-tool-page">
      <PlatformNav onRequestLogin={() => setLoginOpen(true)} />
      <main className="image-tool-main">
        <header className="image-tool-header">
          <h1>图片创作</h1>
          <p>选择生成方式，上传参考图，描述你的需求</p>
        </header>

        <div className="image-tool-mode-tabs">
          <button type="button" className="image-tool-tab active">
            基础模式
          </button>
          <button type="button" className="image-tool-tab" onClick={handleEnterAdvanced}>
            高级模式
          </button>
        </div>

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

        {activePreset && (
          <ImageGeneratePanel presetId={activePreset} onEnterCanvas={handleEnterCanvas} />
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
