import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";

const fakeModule = {
  key: "market",
  label: "市场与客户",
  subtitle: "x",
  free_text_label: "补充",
  fields: [{ key: "f1", label: "字段一", placeholder: "ph1", accept_file: false }],
  pains: ["痛点A"],
};

const fakeProblemMap = {
  company_name: "",
  industry: "直播电商",
  main_business: "带货",
  business_model: "撮合",
  scale: "85人",
  stage: "成长期",
  core_problem: "获客成本翻倍",
  sub_problems: [],
  goal: "ROI回正",
  constraints: "预算不加",
  success_criteria: "ROI>1.2",
  context: "近半年",
  suspected_cause: "渠道红利消失",
  tried: "换代理",
  diagnosis_focus: "sales",
};

vi.mock("../src/api/client", () => ({
  startSession: vi.fn(async () => "sess-1"),
  sessionChat: vi.fn(async () => ({
    message: "我这样理解你的情况……这样对吗？",
    done: false,
    phase: "confirm",
    problem_map: fakeProblemMap,
    summary: null,
  })),
  getSessionDetail: vi.fn(),
  generateABFromSummary: vi.fn(async () => ({
    option_a: { modules: [fakeModule] },
    option_b: { modules: [fakeModule] },
  })),
  recordPreference: vi.fn(async () => {}),
  runDiagnose: vi.fn(),
}));

// Questionnaire 现在用 useAuth 和草稿持久化，mock 掉
vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../src/utils/draft", () => ({
  loadDraft: vi.fn(() => null),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
}));

describe("Questionnaire conversation flow", () => {
  it("对话→确认问题地图→生成→选A→填问卷→提交", async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={onSubmit} />
      </MemoryRouter>
    );
    // 等 startSession 完成（sessionId 就绪）后再交互
    const input = screen.getByPlaceholderText(/描述|问题|输入|补充/);
    fireEvent.change(input, { target: { value: "获客成本越来越高" } });
    // sessionId 异步就绪，反复点发送直到 confirm 卡片出现
    await waitFor(
      () => {
        fireEvent.click(screen.getByText("发送"));
        return screen.getByText("确认无误，开始诊断");
      },
      { timeout: 2000 }
    );
    fireEvent.click(screen.getByText("确认无误，开始诊断"));
    // 进入 ab_choice
    await waitFor(() => screen.getByText(/方案 A/));
    fireEvent.click(screen.getByText(/方案 A/));
    fireEvent.click(screen.getByText("用这份方案开始填写"));
    // 进入问卷
    await waitFor(() => screen.getByText("字段一"));
    fireEvent.change(screen.getByPlaceholderText("ph1"), {
      target: { value: "测试值" },
    });
    fireEvent.click(screen.getByText("痛点A"));
    fireEvent.click(screen.getByText("开始诊断"));
    expect(onSubmit).toHaveBeenCalled();
    const [answers] = onSubmit.mock.calls[0];
    expect(answers[0].facts["f1"]).toBe("测试值");
  });
});
