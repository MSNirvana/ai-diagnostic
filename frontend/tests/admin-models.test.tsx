import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminPage } from "../src/components/Admin/AdminPage";

vi.mock("../src/api/client", () => ({
  listSkillRegistry: vi.fn(async () => []),
  listSkillVersions: vi.fn(async () => []),
}));

describe("AdminPage model gateway", () => {
  it("does not expose Build-local model key configuration", () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText("模型通道")).toBeNull();
    expect(screen.getByText("系统健康")).toBeTruthy();
  });
});
