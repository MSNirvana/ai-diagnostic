import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProjectDetailPage } from "../src/components/Project/ProjectDetailPage";

vi.mock("../src/api/client", () => ({
  getProject: vi.fn(async () => ({
    id: "proj-1",
    name: "星麦直播",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-02T00:00:00Z",
    status: "active",
    memory_summary: "[2026-06-02] 诊断：market（需关注）：获客成本过高",
    memory_entries: [
      {
        id: "mem-1",
        created_at: "2026-06-02T00:00:00Z",
        entry_type: "diagnosis",
        summary: "market（需关注）：获客成本过高；建议：降本",
        payload: {},
        source_id: "rec-1",
      },
      {
        id: "mem-2",
        created_at: "2026-06-01T00:00:00Z",
        entry_type: "feedback",
        summary: "market 诊断反馈：待改进，评分 2/5；反馈：建议太泛",
        payload: {},
        source_id: "fb-1",
      },
    ],
    sessions: [
      {
        id: "sess-1",
        title: "获客成本过高",
        status: "filling",
        updated_at: "2026-06-03T00:00:00Z",
      },
    ],
    records: [
      {
        id: "rec-1",
        created_at: "2026-06-02T00:00:00Z",
        module_count: 3,
        has_war_room_plan: true,
      },
    ],
  })),
}));

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

describe("ProjectDetailPage memory timeline", () => {
  it("renders structured project memory entries", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("项目工作台"));
    expect(screen.getByText("睿策视界")).toBeTruthy();
    expect(screen.getByText("继续跟进")).toBeTruthy();
    expect(screen.getAllByText("新建诊断").length).toBeGreaterThan(0);
    expect(screen.getByText("企业长期档案")).toBeTruthy();
    expect(screen.getByText("诊断")).toBeTruthy();
    expect(screen.getAllByText(/获客成本过高/).length).toBeGreaterThan(0);
    expect(screen.getByText("反馈")).toBeTruthy();
    expect(screen.getByText(/建议太泛/)).toBeTruthy();
    expect(screen.getAllByText("项目会话").length).toBeGreaterThan(0);
    expect(screen.getAllByText("诊断记录").length).toBeGreaterThan(0);
    expect(screen.getByText("查看最新作战室")).toBeTruthy();
    expect(screen.getByText("进入作战室")).toBeTruthy();
  });

  it("opens the selected diagnosis in the dedicated war room route", async () => {
    function LocationProbe() {
      return <span data-testid="location">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route
            path="/projects/:id"
            element={
              <>
                <ProjectDetailPage />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="/projects/:projectId/war-room/:recordId"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("查看最新作战室"));
    fireEvent.click(screen.getByText("查看最新作战室"));

    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj-1/war-room/rec-1"
    );
  });
});
