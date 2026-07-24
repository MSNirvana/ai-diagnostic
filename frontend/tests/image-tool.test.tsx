import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { createImageTask, fetchCreditsBalance, getImageModelCapabilities, getImageTemplateCatalog, listImageTasks, listProjects } from "../src/api/client";

const authState = {
  token: null as string | null,
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("../src/auth/ggooSso", () => ({
  beginGGOOSSO: vi.fn(),
}));

vi.mock("../src/api/client", () => ({
  listProjects: vi.fn(async () => []),
  fetchCreditsBalance: vi.fn(async () => ({ available: false, points: null })),
  listImageTasks: vi.fn(async () => []),
  getImageModelCapabilities: vi.fn(async () => [
    {
      model: "image2",
      label: "image2",
      sizes: [
        { value: "1024x1024", label: "标准方图", aspect_ratio: "1:1" },
        { value: "auto", label: "自动", aspect_ratio: "auto" },
      ],
      aspect_ratios: [{ value: "1:1", label: "方图" }],
      qualities: [{ value: "auto", label: "自动" }],
      backgrounds: [{ value: "opaque", label: "不透明" }],
      generation_counts: [1, 3, 6],
      max_count: 1,
    },
  ]),
  getImageTemplateCatalog: vi.fn(async () => ({
    version: "v1",
    templates: [
      { id: "promo-weekend", preset_id: "promo", name: "周末门店活动", description: "活动", recommended_ratio: "1:1", scene_id: null },
      { id: "promo-launch", preset_id: "promo", name: "新品上新海报", description: "新品", recommended_ratio: "1:1", scene_id: null },
      { id: "promo-festival", preset_id: "promo", name: "节日限定主题", description: "节日", recommended_ratio: "4:5", scene_id: null },
      { id: "ecommerce-studio", preset_id: "ecommerce", name: "清透商品主图", description: "主图", recommended_ratio: "1:1", scene_id: "hero" },
      { id: "ecommerce-life", preset_id: "ecommerce", name: "生活方式场景", description: "场景", recommended_ratio: "4:5", scene_id: "lifestyle" },
      { id: "ecommerce-detail", preset_id: "ecommerce", name: "卖点详情图", description: "详情", recommended_ratio: "2:3", scene_id: "benefit-detail" },
    ],
  })),
  listImageAssets: vi.fn(async () => []),
  getImageAssetUsage: vi.fn(async () => ({
    reference_count: 0,
    reference_bytes: 0,
    reference_count_limit: 50,
    reference_bytes_limit: 500 * 1024 * 1024,
    generated_count: 0,
    generated_bytes: 0,
    generated_count_limit: 100,
    generated_bytes_limit: 1024 * 1024 * 1024,
    warning: false,
  })),
  createImageTask: vi.fn(),
  confirmImageTask: vi.fn(),
  getImageTask: vi.fn(),
  uploadImageAsset: vi.fn(),
  deleteImageAsset: vi.fn(),
}));

const listImageTasksMock = vi.mocked(listImageTasks);

beforeEach(() => {
  authState.token = null;
  authState.isAuthenticated = false;
  vi.mocked(getImageModelCapabilities).mockResolvedValue([
    {
      model: "image2",
      label: "image2",
      sizes: [
        { value: "1024x1024", label: "标准方图", aspect_ratio: "1:1" },
        { value: "auto", label: "自动", aspect_ratio: "auto" },
      ],
      aspect_ratios: [{ value: "1:1", label: "方图" }],
      qualities: [{ value: "auto", label: "自动" }],
      backgrounds: [{ value: "opaque", label: "不透明" }],
      generation_counts: [1, 3, 6],
      max_count: 1,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe("image tool registry", () => {
  it("shows the image tool card on /tools", async () => {
    renderAt("/tools");
    const card = await screen.findByText("图片创作");
    expect(card).toBeTruthy();
  });

  it("links the image tool card to /tools/image", async () => {
    renderAt("/tools");
    const link = await screen.findByRole("link", { name: /图片创作/ });
    expect(link.getAttribute("href")).toBe("/tools/image");
  });
});

describe("image tool page", () => {
  it("redirects to login when not authenticated", () => {
    renderAt("/tools/image");
    expect(screen.queryByText("图片创作")).toBeNull();
  });

  it("shows preset cards when authenticated", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listImageTasksMock.mockResolvedValueOnce([]);

    renderAt("/tools/image");

    expect(await screen.findByText("生成宣传海报")).toBeTruthy();
    expect(screen.getByText("生成电商套图")).toBeTruthy();
    expect(screen.getByText("生成内容配图")).toBeTruthy();
    expect(screen.getByText("从模板开始")).toBeTruthy();
    expect(screen.getByText("模板库 · 案例预览")).toBeTruthy();
    expect(screen.getByText("周末门店活动")).toBeTruthy();
  });

  it("shows history list when authenticated and has tasks", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listImageTasksMock.mockResolvedValueOnce([
      {
        id: "task-1",
        status: "succeeded",
        progress: 100,
        quote_points: 10,
        actual_points: 10,
        error: null,
        result_image_url: "https://img.example.com/1.png",
        created_at: "2026-07-18T10:00:00",
        updated_at: "2026-07-18T10:01:00",
      },
    ]);

    renderAt("/tools/image");

    expect(await screen.findByText("生成历史")).toBeTruthy();
    expect(screen.getAllByText("已完成")[0]).toBeTruthy();
  });
});
  it("starts generation directly without a quote confirmation step", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listImageTasksMock.mockResolvedValueOnce([]);

    renderAt("/tools/image");
    document.querySelector<HTMLButtonElement>(".image-tool-preset-card")?.click();
    const submit = await waitFor(() => {
      const element = document.querySelector<HTMLButtonElement>(".image-generate-submit");
      if (!element) throw new Error("generation submit button not found");
      return element;
    });

    expect(submit.className).toContain("image-generate-submit");
    expect(submit.textContent).toBe("\u4EC5\u7528\u6587\u5B57\u751F\u6210");
    expect(submit.textContent).not.toBe("\u83B7\u53D6\u62A5\u4EF7");
  });


describe("image result delivery", () => {
  it("filters results and exports a material pack", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listImageTasksMock.mockResolvedValueOnce([
      {
        id: "task-success",
        status: "succeeded",
        progress: 100,
        quote_points: 10,
        actual_points: 10,
        error: null,
        result_image_url: "https://img.example.com/success.png",
        created_at: "2026-07-18T10:00:00",
        updated_at: "2026-07-18T10:01:00",
      },
      {
        id: "task-running",
        status: "running",
        progress: 40,
        quote_points: 10,
        actual_points: null,
        error: null,
        result_image_url: null,
        created_at: "2026-07-18T09:00:00",
        updated_at: "2026-07-18T09:01:00",
      },
    ]);

    renderAt("/tools/image");

    expect(await screen.findByText("生成历史")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    expect(screen.getByAltText("生成结果")).toBeTruthy();
    expect(screen.queryByText("生成中")).toBeNull();

    const selectButton = screen.getByRole("button", { name: "选择素材" });
    fireEvent.click(selectButton);
    expect((screen.getByRole("button", { name: /导出素材包/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("image generation specifications", () => {
  it("submits style, ratio, resolution, quality, and count without a quote step", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listImageTasksMock.mockResolvedValueOnce([]);
    vi.mocked(createImageTask).mockResolvedValueOnce({ task_id: "task-new", status: "quoted", quote_points: null });

    renderAt("/tools/image");
    fireEvent.click(await screen.findByText("生成宣传海报"));
    await waitFor(() => expect((screen.getByLabelText("图片模型") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "高级质感" }));
    fireEvent.change(screen.getByLabelText("需求描述"), { target: { value: "新品主图" } });
    fireEvent.change(screen.getByLabelText("生成数量"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "仅用文字生成" }));

    await waitFor(() => expect(createImageTask).toHaveBeenCalledWith(expect.objectContaining({
      preset_id: "promo",
      user_intent: "新品主图",
      aspect_ratio: "1:1",
      size: "1024x1024",
      quality: "auto",
      generation_count: 1,
      model_version: "image2",
      style_variant: "luxury",
    })));
    expect(screen.queryByText("获取报价")).toBeNull();
  });

  it("routes the selected business template to the image task", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listImageTasksMock.mockResolvedValueOnce([]);
    vi.mocked(createImageTask).mockResolvedValueOnce({ task_id: "task-template", status: "quoted", quote_points: null });

    renderAt("/tools/image");
    fireEvent.click(await screen.findByText("生成宣传海报"));
    fireEvent.click(screen.getAllByRole("button", { name: "使用模板" })[1]);
    fireEvent.change(screen.getByLabelText("需求描述"), { target: { value: "新品发布" } });
    const submit = await waitFor(() => {
      const button = screen.getByRole("button", { name: "仅用文字生成" }) as HTMLButtonElement;
      if (button.disabled) throw new Error("generation button is still disabled");
      return button;
    });
    fireEvent.click(submit);

    await waitFor(() => expect(createImageTask).toHaveBeenCalledWith(expect.objectContaining({
      preset_id: "promo",
      template_id: "promo-launch",
    })));
  });
});
