import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectListPage } from "../src/components/Project/ProjectListPage";
import { patchProject } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  createProject: vi.fn(),
  patchProject: vi.fn(async (id: string, body: { status?: string }) => ({
    id,
    name: id === "active-1" ? "进行中项目" : "已归档项目",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    status: body.status ?? "active",
    memory_summary: id === "active-1" ? "最近仍在推进。" : "暂时不推进。",
  })),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
    await within(projectList).findByText("进行中项目");
    fireEvent.click(within(portfolioTools).getByRole("button", { name: "归档箱 1" }));

    expect(await within(projectList).findByText("已归档项目")).toBeTruthy();
    expect(within(projectList).queryByText("进行中项目")).toBeNull();
  });

  it("archives active projects from the list page", async () => {
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectListPage />
      </MemoryRouter>
    );

    const projectList = document.querySelector(".proj-list") as HTMLElement;
    await within(projectList).findByText("进行中项目");
    fireEvent.click(within(projectList).getByRole("button", { name: "归档项目：进行中项目" }));

    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("active-1", { status: "archived" }));
    expect(within(projectList).queryByText("进行中项目")).toBeNull();
  });

  it("restores and user-deletes projects from the archive box without physical deletion", async () => {
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectListPage />
      </MemoryRouter>
    );

    const projectList = document.querySelector(".proj-list") as HTMLElement;
    const portfolioTools = document.querySelector(".portfolio-board__tools") as HTMLElement;
    await within(projectList).findByText("进行中项目");
    await within(portfolioTools).findByRole("button", { name: "归档箱 1" });
    fireEvent.click(within(portfolioTools).getByRole("button", { name: "归档箱 1" }));

    await within(projectList).findByText("已归档项目");
    fireEvent.click(within(projectList).getByRole("button", { name: "恢复项目：已归档项目" }));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("archived-1", { status: "active" }));

    fireEvent.click(within(portfolioTools).getByRole("button", { name: "进行中 2" }));
    fireEvent.click(within(projectList).getByRole("button", { name: "归档项目：进行中项目" }));
    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("active-1", { status: "archived" }));
    fireEvent.click(within(portfolioTools).getByRole("button", { name: "归档箱 1" }));
    await within(projectList).findByText("进行中项目");
    fireEvent.click(within(projectList).getByRole("button", { name: "删除项目：进行中项目" }));
    fireEvent.click(within(projectList).getByRole("button", { name: "确认删除项目：进行中项目" }));

    await waitFor(() => expect(patchProject).toHaveBeenCalledWith("active-1", { status: "deleted" }));
    expect(within(projectList).queryByText("进行中项目")).toBeNull();
  });
});
