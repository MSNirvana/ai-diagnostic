import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import App from "../src/App";
import { ProjectWarRoomPage } from "../src/components/Project/ProjectWarRoomPage";

const warRoomPlan = {
  id: "wr-1",
  record_id: "rec-1",
  project_id: "proj-1",
  summary: "未来 30 天优先打销售承接战。",
  primary_battlefield: "sales",
  secondary_battlefield: "market",
  objective: "提升高质量线索成交率",
  confidence: 0.8,
  decision_items: [],
  battle_chain: [],
  department_actions: [
    {
      id: "sales-action-1",
      department: "sales",
      department_label: "销售与增长",
      battle_goal: "高意向线索响应过慢",
      priority: "now",
      action_title: "重分线索池",
      action_detail: "A 类线索 10 分钟内首响",
      owner_role: "销售负责人",
      start_window: "本周启动",
      acceptance_rule: "两周后复盘首响时长。",
      required_data: [],
      metrics: [
        {
          name: "高质量线索成交率",
          target: "30 天内改善",
          direction: "up",
        },
      ],
      confidence: 0.8,
      evidence_refs: [],
    },
  ],
  priority_board: { now: [], soon: [], later: [] },
  evidence_summary: [],
  risk_summary: [],
  data_gaps: [],
  checkpoints: [],
};

vi.mock("../src/api/client", () => ({
  getProjectWarRoom: vi.fn(async () => warRoomPlan),
  runDiagnose: vi.fn(async () => ({
    results: [],
    record_id: "rec-1",
    skill_version_ids: {},
    triage: {
      primary_module: "sales",
      selected_experts: [],
      conflicts: [],
      dependencies: [],
      priority_actions: [],
    },
    war_room_plan: warRoomPlan,
  })),
  runDiagnoseWithFiles: vi.fn(),
  getProject: vi.fn(),
  fetchRecord: vi.fn(async () => ({
    id: "rec-1",
    created_at: "2026-06-13T00:00:00Z",
    answers: { answers: [] },
    results: [],
    war_room_plan: warRoomPlan,
    profile: null,
  })),
}));

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({
    token: "test-token",
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../src/components/Questionnaire/Questionnaire", () => ({
  Questionnaire: ({ onSubmit, projectId }: { onSubmit: Function; projectId?: string }) => (
    <button
      type="button"
      onClick={() => onSubmit([{ module: "sales", facts: {}, pains: [] }], [], undefined, projectId)}
    >
      模拟完成诊断
    </button>
  ),
}));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

describe("project diagnosis war room routing", () => {
  it("navigates to the dedicated war room after a project diagnosis is saved", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/diagnose"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("模拟完成诊断"));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1/war-room"
      )
    );
  });

  it("routes from the project war room overview into a functional section", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room"]}>
        <Routes>
          <Route path="/projects/:projectId/war-room" element={<ProjectWarRoomPage />} />
          <Route path="/projects/:projectId/war-room/view/:section" element={<ProjectWarRoomPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("经营会总览"));
    fireEvent.click(screen.getByText("分配执行"));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1/war-room/view/actions"
      )
    );
    expect(screen.getByText("部门动作区")).toBeTruthy();
    expect(screen.getByText("重分线索池")).toBeTruthy();
  });
});
