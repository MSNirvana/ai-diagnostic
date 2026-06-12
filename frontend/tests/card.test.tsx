import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModuleCard } from "../src/components/ModuleCard/ModuleCard";

vi.mock("../src/api/client", () => ({ submitFeedback: vi.fn(async () => {}) }));

const result = {
  module: "market", signal: "red" as const,
  conclusion: "定价偏高是流失主因",
  evidence: [{ text: "定价高18%", source: "行业报告" }],
  actions: ["下调定价"],
  drilldown: { data_points: [{ text: "客单价¥420 vs ¥350", source: "销售表" }], comparisons: ["高出20%"] },
};

describe("ModuleCard", () => {
  it("shows conclusion, hides drilldown until clicked", () => {
    render(<ModuleCard result={result} />);
    expect(screen.getByText("定价偏高是流失主因")).toBeTruthy();
    expect(screen.queryByText(/客单价¥420/)).toBeNull();
    fireEvent.click(screen.getByText("查看更多"));
    expect(screen.getByText(/客单价¥420/)).toBeTruthy();
  });

  it("hides feedback area for anonymous (no recordId)", () => {
    render(<ModuleCard result={result} />);
    expect(screen.queryByText("这个诊断对你有帮助吗？")).toBeNull();
  });

  it("shows feedback and submit button after thumbup when recordId+skillVersionId present", () => {
    render(<ModuleCard result={result} recordId="rec-1" skillVersionId="sv-1" />);
    expect(screen.getByText("这个诊断对你有帮助吗？")).toBeTruthy();
    expect(screen.queryByText("提交")).toBeNull();
    fireEvent.click(screen.getByText("👍 有帮助"));
    expect(screen.getByText("提交")).toBeTruthy();
  });
});
