import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RecordDetailPage } from "../src/components/Project/RecordDetailPage";

vi.mock("../src/api/client", () => ({
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
      summary: "未来 30 天优先打销售承接战。",
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

    await waitFor(() => screen.getByText("未来 30 天优先打销售承接战。"));
    expect(screen.getAllByText("老板作战室").length).toBeGreaterThan(0);
    expect(screen.getByText("老板今天要拍板的事")).toBeTruthy();
    expect(screen.getByText("拍板：重分线索池")).toBeTruthy();
  });

  it("loads the dedicated project war room route", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room/rec-1"]}>
        <Routes>
          <Route
            path="/projects/:projectId/war-room/:recordId"
            element={<RecordDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("未来 30 天优先打销售承接战。"));
    expect(screen.getAllByText("老板作战室").length).toBeGreaterThan(0);
    expect(screen.getByText("专家原始诊断")).toBeTruthy();
  });
});
