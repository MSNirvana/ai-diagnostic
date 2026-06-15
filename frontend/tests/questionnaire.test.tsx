import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";
import { startSession } from "../src/api/client";
import { formatChatBlocks } from "../src/components/Questionnaire/ChatStep";

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
  impact: "ROI 从 1.2 降到 0.8",
  context: "近半年",
  suspected_cause: "渠道红利消失",
  tried: "换代理",
  data_readiness: "可提供投放报表",
  diagnosis_focus: "sales",
  information_score: 92,
  missing_fields: [],
  next_question_reason: "",
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
  clearLegacyDraft: vi.fn(),
}));

describe("Questionnaire conversation flow", () => {
  it("把长段 AI 回复拆成更易读的段落和追问", () => {
    const blocks = formatChatBlocks(
      "这里我得跟你点做一个硬矛盾，否则30天会白跑：按刚才的账，每月烧5万，代理毛利约240元/台，不亏钱意味着月销要冲到约208台。所以「不亏钱」其实有两条路：一条是砍成本，另一条是维持投入。你更倾向哪一条？",
      "assistant"
    );

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[blocks.length - 1]?.kind).toBe("question");
  });

  it("对话→确认问题地图→生成→选A→填问卷→提交", async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={onSubmit} />
      </MemoryRouter>
    );
    const input = screen.getByPlaceholderText(/描述|问题|输入|补充/);
    expect(startSession).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "获客成本越来越高" } });
    // 首条真实消息发送时才创建会话，避免用户只点进诊断页产生空历史。
    await waitFor(
      () => {
        fireEvent.click(screen.getByText("发送"));
        return screen.getByText("确认无误，开始诊断");
      },
      { timeout: 2000 }
    );
    expect(startSession).toHaveBeenCalledTimes(1);
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
    expect(onSubmit.mock.calls[0][4]).toEqual(fakeProblemMap);
  });
});
