import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";

// mock generateQuestionnaire 避免真实网络
vi.mock("../src/api/client", () => ({
  generateQuestionnaire: vi.fn(async () => [
    {
      key: "market",
      label: "市场与客户",
      subtitle: "x",
      free_text_label: "补充",
      fields: [{ key: "f1", label: "字段一", placeholder: "ph1", accept_file: false }],
      pains: ["痛点A"],
    },
  ]),
}));

describe("Questionnaire with AI generation", () => {
  it("先填画像生成问卷，再填问卷提交", async () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    // ProfileStep: 点生成
    fireEvent.click(screen.getByText("生成专属问卷"));
    // 等生成的问卷出现
    await waitFor(() => screen.getByText("字段一"));
    fireEvent.change(screen.getByPlaceholderText("ph1"), {
      target: { value: "测试值" },
    });
    fireEvent.click(screen.getByText("痛点A"));
    // 只有1个模块，直接是最后一步
    fireEvent.click(screen.getByText("开始诊断"));
    expect(onSubmit).toHaveBeenCalled();
    const [answers] = onSubmit.mock.calls[0];
    expect(answers[0].module).toBe("market");
    expect(answers[0].facts["f1"]).toBe("测试值");
  });
});
