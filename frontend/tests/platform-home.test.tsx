import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";

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
  fetchCreditsBalance: vi.fn(async () => ({ available: false, points: null })),
}));

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

describe("image app entry", () => {
  it("requires the shared GGOO login at the root route", async () => {
    renderAt("/");

    expect(await screen.findByRole("button", { name: "使用 GGOO 登录 / 注册" })).toBeTruthy();
  });

  it("keeps the legacy tools route available for direct navigation", () => {
    renderAt("/tools");

    expect(screen.getByRole("heading", { name: "全部工具" })).toBeTruthy();
    const toolCard = screen.getByRole("link", { name: /图片创作/ });
    expect(toolCard.getAttribute("href")).toBe("/tools/image");
  });

  it("redirects /tools/diagnostic into the diagnostic tool flow (login when logged out)", async () => {
    renderAt("/tools/diagnostic");

    expect(await screen.findByRole("button", { name: "使用 GGOO 登录 / 注册" })).toBeTruthy();
  });
});
