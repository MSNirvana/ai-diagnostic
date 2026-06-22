import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminPage } from "../src/components/Admin/AdminPage";

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../src/api/client", () => ({
  listProjects: vi.fn(async () => []),
  patchProject: vi.fn(),
  listSkillRegistry: vi.fn(async () => []),
  listSkillVersions: vi.fn(async () => []),
  addSkillVersion: vi.fn(),
  activateSkillVersion: vi.fn(),
  listLLMConfigs: vi.fn(async () => []),
  createLLMConfig: vi.fn(),
  deleteLLMConfig: vi.fn(),
  patchLLMConfig: vi.fn(),
  fetchL1Stats: vi.fn(),
  fetchL2Stats: vi.fn(),
  fetchL3Stats: vi.fn(),
  fetchL4Stats: vi.fn(),
  fetchReviewQueue: vi.fn(async () => [
    {
      record_id: "rec-1",
      user_id: "user-1",
      primary_module: "market",
      created_at: "2026-06-03T00:00:00Z",
      sla_deadline: "2026-06-04T00:00:00Z",
      hours_remaining: 12,
      overdue: false,
      assigned_to: null,
    },
  ]),
  fetchReviewDetail: vi.fn(async () => ({
    record_id: "rec-1",
    review_status: "pending_review",
    primary_module: "market",
    results: [
      {
        module: "market",
        signal: "red",
        conclusion: "招商回本承诺需要优先核验。",
        evidence: [{ text: "公开招商页存在回本周期表述。", source: "https://example.com/franchise" }],
        actions: ["核验招商承诺与合同边界"],
        drilldown: null,
        evidence_package: null,
        data_requests: [],
        research_questions: [],
      },
    ],
    war_room_plan: null,
    consultant_notes: [],
    created_at: "2026-06-03T00:00:00Z",
    evidence_pack: [
      {
        id: "ev-1",
        job_id: "job-1",
        project_id: "proj-1",
        record_id: "rec-1",
        module: "market",
        source_stage: "expert_supplemental_research",
        provider: "perplexity",
        query: "电火灶 招商加盟 回本周期",
        title: "电火灶招商加盟页",
        url: "https://example.com/franchise",
        snippet: "公开招商页强调回本周期，需要结合资质与合同审查。",
        source_type: "web",
        credibility: 0.7,
        retrieved_at: "2026-06-03T00:00:00Z",
      },
    ],
  })),
  submitReview: vi.fn(),
}));

describe("AdminPage review evidence pack", () => {
  it("shows external evidence before consultant review actions", async () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText("审核队列"));
    await waitFor(() => screen.getByText("market"));
    fireEvent.click(screen.getByText("market"));

    expect(await screen.findByText("外部证据包")).toBeTruthy();
    expect(screen.getByText("证据分析报告")).toBeTruthy();
    expect(screen.getByText("审核目的")).toBeTruthy();
    expect(screen.getByText(/招商承诺需要先证据化核验/)).toBeTruthy();
    expect(screen.getByText(/宣传口径核验线索/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "查看来源 1" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("电火灶招商加盟页")).toBeNull();
    expect(screen.queryByText(/公开招商页强调回本周期/)).toBeNull();
    expect(screen.getByText(/1 条原始证据已归档/)).toBeTruthy();
  });
});
