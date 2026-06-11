import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";

describe("Questionnaire wizard", () => {
  it("第一步填字段+选痛点，导航到最后一步提交，onSubmit 收到组装的 answers", () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    // 第一步是 market。填一个字段
    const input = screen.getByPlaceholderText(/杭州明远科技/);
    fireEvent.change(input, { target: { value: "测试公司" } });
    // 选一个痛点
    fireEvent.click(screen.getByText("打不过竞品"));
    // 一路点"下一步"到最后（共6步，点5次）
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText("下一步"));
    }
    // 最后一步点"开始诊断"
    fireEvent.click(screen.getByText("开始诊断"));
    expect(onSubmit).toHaveBeenCalled();
    const [answers, files] = onSubmit.mock.calls[0];
    const market = answers.find((a: any) => a.module === "market");
    expect(market).toBeTruthy();
    expect(market.facts["公司名称"]).toBe("测试公司");
    expect(market.pains).toContain("打不过竞品");
    expect(Array.isArray(files)).toBe(true);
  });

  it("完全不填时开始诊断按钮禁用", () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText("下一步"));
    const btn = screen.getByText("开始诊断") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
