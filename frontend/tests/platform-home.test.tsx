import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { listProjects } from "../src/api/client";

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
}));

const listProjectsMock = vi.mocked(listProjects);

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

describe("platform home", () => {
  it("renders the platform home with brand, tool cards and login CTA when logged out", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "把 AI 模型变成上手即用的工具" })).toBeTruthy();

    const ggooLink = screen.getByRole("link", { name: "GGOO" });
    expect(ggooLink.getAttribute("href")).toBe("https://ggoo.ai");

    const toolCard = screen.getByRole("link", { name: /经营增长诊断/ });
    expect(toolCard.getAttribute("href")).toBe("/tools/diagnostic");

    expect(screen.getByRole("button", { name: "使用 GGOO 账户开始" })).toBeTruthy();
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it("opens the GGOO login overlay from the hero CTA when logged out", async () => {
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "使用 GGOO 账户开始" }));

    expect(await screen.findByRole("button", { name: "使用 GGOO 登录 / 注册" })).toBeTruthy();
  });

  it("shows recent active projects and hides archived ones when logged in", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    listProjectsMock.mockResolvedValueOnce([
      {
        id: "proj-active",
        name: "进行中项目",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-03T00:00:00Z",
        status: "active",
        memory_summary: "最近仍在推进。",
      },
      {
        id: "proj-archived",
        name: "已归档项目",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-02T00:00:00Z",
        status: "archived",
        memory_summary: "暂时不推进。",
      },
    ] as Awaited<ReturnType<typeof listProjects>>);

    renderAt("/");

    const recentCard = await screen.findByRole("link", { name: /进行中项目/ });
    expect(recentCard.getAttribute("href")).toBe("/projects/proj-active");
    expect(screen.queryByText("已归档项目")).toBeNull();

    const allProjects = screen.getByRole("link", { name: "全部项目" });
    expect(allProjects.getAttribute("href")).toBe("/projects");
  });

  it("guides the user to create a first project when logged in without projects", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;

    renderAt("/");

    const createLink = await screen.findByRole("link", { name: "去创建项目" });
    expect(createLink.getAttribute("href")).toBe("/projects");
  });

  it("lists registered tools on /tools", () => {
    renderAt("/tools");

    expect(screen.getByRole("heading", { name: "全部工具" })).toBeTruthy();
    const toolCard = screen.getByRole("link", { name: /经营增长诊断/ });
    expect(toolCard.getAttribute("href")).toBe("/tools/diagnostic");
  });

  it("redirects /tools/diagnostic into the diagnostic tool flow (login when logged out)", async () => {
    renderAt("/tools/diagnostic");

    expect(await screen.findByRole("button", { name: "使用 GGOO 登录 / 注册" })).toBeTruthy();
  });
});
