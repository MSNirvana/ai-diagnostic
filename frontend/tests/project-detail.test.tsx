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
        payload: {
          top_module: "market",
          signal: "red",
          conclusion: "获客成本过高但没有被拆到渠道、素材和承接链路，导致团队只能看到成本上升，却不知道该先砍预算还是先修转化。",
          actions: ["先补齐近 30 天渠道花费、线索质量、跟进阶段和成交结果，再判断优先优化哪一段链路", "优化渠道结构"],
          triage: {
            priority_actions: ["市场与客户：先重做渠道结构"],
          },
        },
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
    war_room_plan: {
      id: "wr-1",
      record_id: "rec-1",
      project_id: "proj-1",
      source_record_ids: ["rec-1"],
      iteration_count: 1,
      iterations: [
        {
          record_id: "rec-1",
          created_at: "2026-06-02T00:00:00Z",
          summary: "未来 30 天优先打市场获客战。",
          primary_battlefield: "market",
          objective: "把 CAC 降下来",
          confidence: 0.7,
          changes: ["建立项目作战室"],
        },
      ],
      summary: "未来 30 天优先打市场获客战。",
      primary_battlefield: "market",
      secondary_battlefield: "",
      objective: "把 CAC 降下来",
      confidence: 0.7,
      decision_items: [],
      battle_chain: [],
      department_actions: [],
      priority_board: { now: [], soon: [], later: [] },
      evidence_summary: [],
      risk_summary: [],
      data_gaps: [],
      checkpoints: [],
    },
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
    expect(screen.getAllByText("诊断").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/获客成本过高/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/该先砍预算还是先修转化。/).length).toBeGreaterThan(0);
    expect(screen.getByText(/先补齐近 30 天渠道花费、线索质量、跟进阶段和成交结果，再判断优先优化哪一段链路。/)).toBeTruthy();
    expect(screen.getByText("反馈")).toBeTruthy();
    expect(screen.getByText(/建议太泛/)).toBeTruthy();
    expect(screen.getAllByText("项目会话").length).toBeGreaterThan(0);
    expect(screen.getAllByText("诊断记录").length).toBeGreaterThan(0);
    expect(screen.getByText("进入项目作战室")).toBeTruthy();
    expect(screen.getByText("查看记录")).toBeTruthy();
  });

  it("expands memory details when requested", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("企业长期档案"));
    const toggles = screen.getAllByText("展开详情");
    fireEvent.click(toggles[0]);

    expect(screen.getByText("建议动作")).toBeTruthy();
  });

  it("opens the project-level war room", async () => {
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
            path="/projects/:projectId/war-room"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("进入项目作战室"));
    fireEvent.click(screen.getByText("进入项目作战室"));

    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj-1/war-room"
    );
  });
});
