import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectListPage } from "../src/components/Project/ProjectListPage";

vi.mock("../src/api/client", () => ({
  createProject: vi.fn(),
  patchProject: vi.fn(),
  listProjects: vi.fn(async () => [
    {
      id: "active-1",
      name: "进行中项目",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
      status: "active",
      memory_summary: "最近仍在推进。",
    },
    {
      id: "archived-1",
      name: "已归档项目",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-02T00:00:00Z",
      status: "archived",
      memory_summary: "暂时不推进。",
    },
  ]),
}));

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

describe("ProjectListPage archive filter", () => {
  it("hides archived projects by default and shows them in the archive box", async () => {
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectListPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getAllByText("进行中项目").length).toBeGreaterThan(0));
    expect(screen.queryByText("已归档项目")).toBeNull();

    const projectList = document.querySelector(".proj-list") as HTMLElement;
    const portfolioTools = document.querySelector(".portfolio-board__tools") as HTMLElement;
    fireEvent.click(within(portfolioTools).getByRole("button", { name: "归档箱 1" }));

    expect(await within(projectList).findByText("已归档项目")).toBeTruthy();
    expect(within(projectList).queryByText("进行中项目")).toBeNull();
  });
});
