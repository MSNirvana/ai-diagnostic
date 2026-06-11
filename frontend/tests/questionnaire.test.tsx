import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";

describe("Questionnaire", () => {
  it("collects answers and calls onSubmit", () => {
    const onSubmit = vi.fn();
    render(<Questionnaire onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("打不过竞品"));
    fireEvent.click(screen.getByText("开始诊断"));
    expect(onSubmit).toHaveBeenCalled();
    const answers = onSubmit.mock.calls[0][0];
    expect(answers.some((a: any) => a.pains.includes("打不过竞品"))).toBe(true);
  });
});
