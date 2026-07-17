import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { fetchCreditsBalance, listImageTasks, listProjects } from "../src/api/client";

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
  listImageAssets: vi.fn(async () => []),
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

    expect(await screen.findByText("一键生成宣传图")).toBeTruthy();
    expect(screen.getByText("一键生成电商图")).toBeTruthy();
    expect(screen.getByText("从模板开始")).toBeTruthy();
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
    expect(screen.getByText("已完成")).toBeTruthy();
  });
});
