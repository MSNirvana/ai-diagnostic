import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RecordDetailPage } from "../src/components/Project/RecordDetailPage";
import { ProjectWarRoomPage } from "../src/components/Project/ProjectWarRoomPage";

afterEach(cleanup);

vi.mock("../src/api/client", () => ({
  listProjects: vi.fn(async () => []),
  patchProject: vi.fn(),
  getTransformationPlan: vi.fn(async () => ({ items: {} })),
  listDataSupplementRequests: vi.fn(async () => []),
  getProject: vi.fn(async () => ({
    id: "proj-1",
    name: "待审核项目",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
    status: "active",
    memory_summary: "",
    memory_entries: [],
    sessions: [],
    records: [],
    archive: {
      profile: [],
      modules: [],
      files: [],
      last_updated: null,
    },
    delivery_status: {
      state: "approved",
      approved_count: 1,
      pending_review_count: 0,
      rejected_count: 0,
      latest_review_status: "approved",
    },
    war_room_plan: null,
  })),
  getProjectWarRoom: vi.fn(async () => ({
    id: "wr-project",
    record_id: "rec-1",
    project_id: "proj-1",
    source_record_ids: ["rec-1"],
    iteration_count: 1,
    iterations: [
      {
        record_id: "rec-1",
        created_at: "2026-06-13T00:00:00Z",
        summary: "本轮经营会先围绕销售承接链路定动作。",
        primary_battlefield: "sales",
        objective: "提升高质量线索成交率",
        confidence: 0.8,
        changes: ["建立项目作战室"],
      },
    ],
    summary: "本轮经营会先围绕销售承接链路定动作。",
    primary_battlefield: "sales",
    secondary_battlefield: "",
    objective: "提升高质量线索成交率",
    confidence: 0.8,
    decision_items: [
      { title: "拍板：重分线索池", detail: "授权销售负责人推进。", urgency: "now" },
    ],
    battle_chain: [{ id: "sales", label: "销售重分线索", depends_on: [], note: "" }],
    department_actions: [],
    priority_board: { now: ["重分线索池"], soon: [], later: [] },
    evidence_summary: ["销售漏斗恶化"],
    risk_summary: ["需复盘过程指标"],
    data_gaps: [],
    checkpoints: [
      { window: "7d", title: "7 天启动检查", checks: ["动作是否启动"] },
      { window: "14d", title: "14 天过程复盘", checks: ["过程指标是否变化"] },
      { window: "30d", title: "30 天验收与转向", checks: ["目标是否改善"] },
    ],
  })),
  listWarRoomFeedback: vi.fn(async () => []),
  submitWarRoomFeedback: vi.fn(async (_projectId: string, body: any) => ({
    id: "fb-1",
    project_id: "proj-1",
    created_at: "2026-06-23T00:00:00Z",
    ...body,
    note: body.note ?? "",
    owner: body.owner ?? "",
    attachments: body.attachments ?? [],
  })),
  fetchRecord: vi.fn(async () => ({
    id: "rec-1",
    created_at: "2026-06-13T00:00:00Z",
    answers: { answers: [{ module: "sales", facts: {}, pains: [] }] },
    results: [
      {
        module: "sales",
        signal: "red",
        conclusion: "销售转化链路承压",
        evidence: [],
        actions: ["重分线索池"],
        drilldown: null,
        data_requests: [],
      },
    ],
    war_room_plan: {
      id: "wr-1",
      record_id: "rec-1",
      project_id: "proj-1",
      summary: "本轮经营会先围绕销售承接链路定动作。",
      primary_battlefield: "sales",
      secondary_battlefield: "",
      objective: "提升高质量线索成交率",
      confidence: 0.8,
      decision_items: [
        { title: "拍板：重分线索池", detail: "授权销售负责人推进。", urgency: "now" },
      ],
      battle_chain: [{ id: "sales", label: "销售重分线索", depends_on: [], note: "" }],
      department_actions: [],
      priority_board: { now: ["重分线索池"], soon: [], later: [] },
      evidence_summary: ["销售漏斗恶化"],
      risk_summary: ["需复盘过程指标"],
      data_gaps: [],
      checkpoints: [
        { window: "7d", title: "7 天启动检查", checks: ["动作是否启动"] },
        { window: "14d", title: "14 天过程复盘", checks: ["过程指标是否变化"] },
        { window: "30d", title: "30 天验收与转向", checks: ["目标是否改善"] },
      ],
    },
    profile: null,
    review_status: "approved",
  })),
}));

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

describe("RecordDetailPage", () => {
  it("renders persisted war room plan before raw expert dashboard", async () => {
    render(
      <MemoryRouter initialEntries={["/records/rec-1"]}>
        <Routes>
          <Route path="/records/:id" element={<RecordDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getAllByText("本轮经营会先围绕销售承接链路定动作。").length).toBeGreaterThan(0)
    );
    expect(screen.getAllByText("老板作战室").length).toBeGreaterThan(0);
    expect(screen.getByText("先拍板的事项")).toBeTruthy();
    expect(screen.getAllByText("重分线索池").length).toBeGreaterThan(0);
  });

  it("loads the dedicated project war room route", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room"]}>
        <Routes>
          <Route
            path="/projects/:projectId/war-room"
            element={<ProjectWarRoomRoute />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() =>
    expect(screen.getAllByText("本轮经营会先围绕销售承接链路定动作。").length).toBeGreaterThan(0)
    );
    expect(screen.getByText("项目总览")).toBeTruthy();
    expect(screen.getAllByText(/咨询把握度/).length).toBeGreaterThan(0);
    expect(screen.getByText("当前第 1 版")).toBeTruthy();
    expect(screen.getAllByText(/重分线索池/).length).toBeGreaterThan(0);
    expect(screen.queryByText("历史版本")).toBeNull();
  });

  it("opens a project war room functional section", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room/view/review"]}>
        <Routes>
          <Route
            path="/projects/:projectId/war-room/view/:section"
            element={<ProjectWarRoomRoute />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getAllByText("历史版本").length).toBeGreaterThan(0));
    expect(screen.getByText("返回作战室总览")).toBeTruthy();
    expect(screen.getByText(/第 1 版 · 当前/)).toBeTruthy();
    expect(screen.getByText("本轮经营会先围绕销售承接链路定动作。")).toBeTruthy();
  });
});

function ProjectWarRoomRoute() {
  return <ProjectWarRoomPage />;
}
