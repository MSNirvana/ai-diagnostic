import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { CanvasStage } from "../src/components/ImageTool/canvas/CanvasStage";
import { executeCanvasNode, getImageTask, getLatestCanvasScene, saveCanvasScene } from "../src/api/client";

const authState = {
  token: "test-token" as string | null,
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("../src/api/client", () => ({
  getImageTask: vi.fn(),
  executeCanvasNode: vi.fn(),
  getImageModelCapabilities: vi.fn(async () => []),
  saveCanvasScene: vi.fn(),
  getLatestCanvasScene: vi.fn(),
  listImageTasks: vi.fn(async () => []),
  listImageAssets: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
  fetchCreditsBalance: vi.fn(async () => ({ available: false, points: null })),
}));

beforeEach(() => {
  authState.token = "test-token";
  authState.isAuthenticated = true;
  vi.mocked(getImageTask).mockReset();
  vi.mocked(saveCanvasScene).mockReset();
  vi.mocked(getLatestCanvasScene).mockReset();
  vi.mocked(executeCanvasNode).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("advanced image canvas", () => {
  it("opens the standalone blank canvas route", () => {
    render(
      <MemoryRouter initialEntries={["/tools/image/canvas"]}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText("图片创作 · 高级工作台")).toBeTruthy();
    expect(screen.getByText("节点工具箱")).toBeTruthy();
    expect(screen.getAllByText("需求/模板")[0]).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存画布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "加载最近版本" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "撤销" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重做" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "自动整理工作流" })).toBeTruthy();
    expect(screen.getByText("修改/重绘")).toBeTruthy();
    expect(screen.queryByText("超分辨率")).toBeNull();
  });

  it("supports undo, redo, and workflow auto-layout without losing nodes or edges", () => {
    render(
      <MemoryRouter>
        <CanvasStage />
      </MemoryRouter>
    );

    expect(screen.getByText("节点数：7")).toBeTruthy();
    expect(screen.getByText("连线数：5")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^结果/ }));
    expect(screen.getByText("节点数：8")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByText("节点数：7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByText("节点数：8")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "自动整理工作流" }));
    expect(screen.getByText("已按工作流连接关系整理节点；锁定节点保持原位置。")).toBeTruthy();
    expect(screen.getByText("节点数：8")).toBeTruthy();
    expect(screen.getByText("连线数：5")).toBeTruthy();
  });

  it("does not intercept editing shortcuts in planner inputs", () => {
    render(
      <MemoryRouter>
        <CanvasStage />
      </MemoryRouter>
    );

    const source = screen.getByLabelText("产品资料 / 卖点") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: "保温杯卖点" } });

    const undoEvent = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    source.dispatchEvent(undoEvent);
    expect(undoEvent.defaultPrevented).toBe(false);
    expect(source.value).toBe("保温杯卖点");

    const deleteEvent = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    source.dispatchEvent(deleteEvent);
    expect(deleteEvent.defaultPrevented).toBe(false);
    expect(source.value).toBe("保温杯卖点");
  });

  it("saves the current scene including its viewport", async () => {
    vi.mocked(saveCanvasScene).mockResolvedValue({
      id: "scene-1",
      task_id: null,
      name: "未命名画布",
      version: 1,
      scene: {
        items: [],
        edges: [],
        groups: [],
        viewport: { x: 0, y: 0, scale: 1 },
        version: 1,
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <CanvasStage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "保存画布" }));

    await waitFor(() => expect(saveCanvasScene).toHaveBeenCalledTimes(1));
    expect(saveCanvasScene).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: expect.objectContaining({
          viewport: { x: 0, y: 0, scale: 1 },
        }),
      })
    );
  });

  it("creates a configurable image bundle planning draft", () => {
    render(
      <MemoryRouter>
        <CanvasStage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("套图数量（可配置）"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("产品资料 / 卖点"), { target: { value: "保温杯，通勤人群，长效保温" } });
    fireEvent.click(screen.getByRole("button", { name: "生成套图规划草案" }));

    expect(screen.getByText("16 张 · v1 · 结构草案")).toBeTruthy();
    expect((screen.getByLabelText("1号图提示词") as HTMLTextAreaElement).value).toContain("保温杯，通勤人群，长效保温");
    expect(screen.getByLabelText("16号图提示词")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "生成套图容器与卡片" }));
    expect(screen.getByText("套图容器已放入画布；每张图片卡片都可以独立编辑用途、提示词和参考来源。")).toBeTruthy();
  });

  it("loads the latest persisted scene for a task", async () => {
    vi.mocked(getImageTask).mockResolvedValue({
      id: "task-1",
      status: "succeeded",
      progress: 100,
      quote_points: null,
      actual_points: null,
      error: null,
      result_image_url: null,
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
      preset_id: "promo",
      user_intent: "测试任务",
    });
    vi.mocked(getLatestCanvasScene).mockResolvedValue({
      id: "scene-2",
      task_id: "task-1",
      name: "已保存画布",
      version: 3,
      scene: {
        items: [
          {
            id: "saved-node",
            kind: "prompt",
            label: "已保存提示词",
            x: 240,
            y: 80,
            width: 220,
            height: 160,
            zIndex: 1,
          },
        ],
        edges: [],
        groups: [],
        viewport: { x: 12, y: 24, scale: 0.8 },
        version: 1,
      },
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
    });

    render(
      <MemoryRouter>
        <CanvasStage taskId="task-1" />
      </MemoryRouter>
    );

    await waitFor(() => expect(getLatestCanvasScene).toHaveBeenCalledWith("task-1"));
    expect(await screen.findByText("已保存提示词")).toBeTruthy();
    expect(screen.getByText("画布版本：3")).toBeTruthy();
  });
});
