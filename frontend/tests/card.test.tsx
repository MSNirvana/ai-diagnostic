import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModuleCard } from "../src/components/ModuleCard/ModuleCard";

vi.mock("../src/api/client", () => ({ submitFeedback: vi.fn(async () => {}) }));

const result = {
  module: "market", signal: "red" as const,
  conclusion: "定价偏高是流失主因",
  evidence: [{ text: "定价高18%", source: "行业报告" }],
  actions: ["下调定价"],
  data_requests: [
    {
      key: "promotion_account",
      label: "推广账号与广告平台",
      reason: "没有账号或平台范围，无法核验真实获客渠道与预算结构。",
      source_hint: "连接广告账号或上传投放报表。",
      required: true,
    },
  ],
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
    expect(screen.getByText(/定价偏高是流失主因/)).toBeTruthy();
    expect(screen.queryByText(/客单价¥420/)).toBeNull();
    fireEvent.click(screen.getByText("查看更多"));
    expect(screen.getByText(/客单价¥420/)).toBeTruthy();
    expect(screen.getByText("可信证据包")).toBeTruthy();
    expect(screen.getByText("待补数据")).toBeTruthy();
    expect(screen.getByText("推广账号与广告平台")).toBeTruthy();
    expect(screen.getByText("证据完整度：82%")).toBeTruthy();
    expect(screen.getByText(/AI Diagnostic benchmark stub/)).toBeTruthy();
    expect(screen.getByText(/方法版本 fallback/)).toBeTruthy();
  });

  it("hides feedback area for anonymous (no recordId)", () => {
    render(<ModuleCard result={result} />);
    expect(screen.queryByText("这个诊断对你有帮助吗？")).toBeNull();
  });

  it("shows feedback and submit button after thumbup when recordId+skillVersionId present", () => {
    render(<ModuleCard result={result} recordId="rec-1" skillVersionId="sv-1" />);
    expect(screen.getByText("这个诊断对你有帮助吗？")).toBeTruthy();
    expect(screen.queryByText("提交")).toBeNull();
    fireEvent.click(screen.getByText("有帮助"));
    expect(screen.getByText("提交")).toBeTruthy();
  });

  it("marks low-confidence modules with missing evidence as insufficient data", () => {
    render(
      <ModuleCard
        result={{
          ...result,
          conclusion: "应该立刻加大投放。",
          evidence: [],
          evidence_package: {
            ...result.evidence_package,
            confidence: 0.38,
            confidence_reason: "缺少投放账号与转化数据。",
          },
        }}
      />
    );

    expect(screen.getByText("低置信 / 待验证")).toBeTruthy();
    expect(screen.getAllByText("数据不足，需补齐后才能判断").length).toBeGreaterThan(0);
    expect(screen.getByText("暂无可验证依据，需先补齐数据。")).toBeTruthy();
    expect(screen.getByText("推广账号与广告平台")).toBeTruthy();
    expect(screen.queryByText(/应该立刻加大投放/)).toBeNull();
  });
});
