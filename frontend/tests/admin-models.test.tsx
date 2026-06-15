import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminPage } from "../src/components/Admin/AdminPage";
import { patchLLMConfig } from "../src/api/client";

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../src/api/client", () => ({
  listSkillRegistry: vi.fn(async () => []),
  listSkillVersions: vi.fn(async () => []),
  addSkillVersion: vi.fn(),
  activateSkillVersion: vi.fn(),
  listLLMConfigs: vi.fn(async () => [
    {
      id: "cfg-1",
      name: "Claude opus-4-8",
      provider: "anthropic",
      model: "claude-opus-4-8",
      api_key_masked: "****6Wj0",
      base_url: "https://api.tooken.ai/v1",
      priority: 0,
      is_active: true,
    },
  ]),
  createLLMConfig: vi.fn(),
  deleteLLMConfig: vi.fn(),
  patchLLMConfig: vi.fn(async () => ({
    id: "cfg-1",
    name: "Claude main",
    provider: "anthropic",
    model: "claude-opus-4-8",
    api_key_masked: "****6Wj0",
    base_url: "https://api.tooken.ai/v1",
    priority: 0,
    is_active: true,
  })),
}));

describe("AdminPage model configs", () => {
  it("edits an existing model config without requiring a new api key", async () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("模型通道"));
    await waitFor(() => screen.getByText("Claude opus-4-8"));

    fireEvent.click(screen.getByText("编辑"));
    const nameInput = screen.getByDisplayValue("Claude opus-4-8");
    fireEvent.change(nameInput, { target: { value: "Claude main" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() => expect(patchLLMConfig).toHaveBeenCalled());
    expect(patchLLMConfig).toHaveBeenCalledWith(
      "cfg-1",
      expect.objectContaining({
        name: "Claude main",
        provider: "anthropic",
        model: "claude-opus-4-8",
        base_url: "https://api.tooken.ai/v1",
        priority: 0,
        is_active: true,
      })
    );
    expect((patchLLMConfig as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty("api_key");
    expect(screen.getByText("模型通道已更新")).toBeTruthy();
  });
});
