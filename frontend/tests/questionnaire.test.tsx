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

vi.mock("../src/api/client", () => ({
  generateABQuestionnaire: vi.fn(async () => ({
    option_a: { modules: [fakeModule] },
    option_b: { modules: [fakeModule] },
  })),
  recordPreference: vi.fn(async () => {}),
}));

describe("Questionnaire A/B flow", () => {
  it("填画像→生成两份→选A→填问卷→提交", async () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("生成专属问卷"));
    // 等 A/B 选择页
    await waitFor(() => screen.getByText(/方案 A/));
    // 点选方案 A 卡片
    fireEvent.click(screen.getByText(/方案 A/));
    // 点确认按钮
    fireEvent.click(screen.getByText("用这份方案开始填写"));
    // 进入问卷，填字段
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
