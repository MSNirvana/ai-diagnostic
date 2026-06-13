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
  evidence_package: {
    confidence: 0.82,
    confidence_reason: "有 1 条结论引用；已附外部基准",
    citations: [{ text: "定价高18%", source: "行业报告" }],
    benchmarks: [{ name: "market 外部基准", source: "AI Diagnostic benchmark stub", value: "行业均值" }],
    audit_trail: {
      skill_version_id: "fallback",
      input_modules: ["market"],
      checks: ["引用数量: 1"],
    },
  },
};

describe("ModuleCard", () => {
  it("shows conclusion, hides drilldown until clicked", () => {
    render(<ModuleCard result={result} />);
    expect(screen.getByText("定价偏高是流失主因")).toBeTruthy();
    expect(screen.queryByText(/客单价¥420/)).toBeNull();
    fireEvent.click(screen.getByText("查看更多"));
    expect(screen.getByText(/客单价¥420/)).toBeTruthy();
    expect(screen.getByText("可信证据包")).toBeTruthy();
    expect(screen.getByText("置信度：82%")).toBeTruthy();
    expect(screen.getByText(/AI Diagnostic benchmark stub/)).toBeTruthy();
    expect(screen.getByText(/skill fallback/)).toBeTruthy();
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
