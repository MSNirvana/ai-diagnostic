import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "../src/App";

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
  department_actions: [],
  priority_board: { now: [], soon: [], later: [] },
  evidence_summary: [],
  risk_summary: [],
  data_gaps: [],
  checkpoints: [],
};

vi.mock("../src/api/client", () => ({
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
        "/projects/proj-1/war-room/rec-1"
      )
    );
  });
});
