import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";

const fakeModule = {
  key: "market",
  label: "市场与客户",
  subtitle: "x",
  free_text_label: "补充",
  fields: [{ key: "f1", label: "字段一", placeholder: "ph1", accept_file: false }],
  pains: ["痛点A"],
};

const fakeSummary = {
  core_problem: "获客成本翻倍",
  context: "近半年",
  suspected_cause: "渠道红利消失",
  tried: "换代理",
  company_name: "",
  industry: "直播电商",
  main_business: "带货",
  business_model: "撮合",
  scale: "85人",
  stage: "成长期",
};

vi.mock("../src/api/client", () => ({
  sendChatMessage: vi.fn(async () => ({
    message: "好的，我已了解",
    done: true,
    summary: fakeSummary,
  })),
  generateABFromSummary: vi.fn(async () => ({
    option_a: { modules: [fakeModule] },
    option_b: { modules: [fakeModule] },
  })),
  recordPreference: vi.fn(async () => {}),
}));

describe("Questionnaire conversation flow", () => {
  it("对话→生成→选A→填问卷→提交", async () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    // ChatStep：输入一句话发送
    const input = screen.getByPlaceholderText(/描述|问题|输入/);
    fireEvent.change(input, { target: { value: "获客成本越来越高" } });
    fireEvent.click(screen.getByText("发送"));
    // done=true 后出现生成方案按钮
    await waitFor(() => screen.getByText(/生成诊断方案/));
    fireEvent.click(screen.getByText(/生成诊断方案/));
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
