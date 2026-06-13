import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "../src/components/Dashboard/Dashboard";
import type { ModuleResult, TriageSummary } from "../src/types";

const results: ModuleResult[] = [
  {
    module: "sales",
    signal: "red",
    conclusion: "销售转化链路承压",
    evidence: [],
    actions: ["先拆解线索到成交的漏斗"],
    drilldown: null,
  },
];

const triage: TriageSummary = {
  primary_module: "sales",
  selected_experts: [
    { module: "sales", label: "销售与增长", reason: "问题地图建议优先诊断", priority: 0 },
    { module: "finance", label: "财务与资本", reason: "问题地图提到相关经营信号", priority: 21 },
  ],
  conflicts: [
    {
      modules: ["sales", "finance"],
      description: "增长动作需要投入，但现金流约束要求先设投入上限。",
    },
  ],
  dependencies: ["先确认目标客群与渠道质量，再优化销售转化动作。"],
  priority_actions: ["销售与增长：先拆解线索到成交的漏斗"],
};

describe("Dashboard triage summary", () => {
  it("renders expert routing, conflicts and priority actions", () => {
    render(<Dashboard results={results} triage={triage} />);

    expect(screen.getByText("多专家会诊路线")).toBeTruthy();
    expect(screen.getByText("主诊专家：销售与增长")).toBeTruthy();
    expect(screen.getByText("销售与增长")).toBeTruthy();
    expect(screen.getByText("财务与资本")).toBeTruthy();
    expect(screen.getByText(/现金流约束/)).toBeTruthy();
    expect(screen.getByText("销售与增长：先拆解线索到成交的漏斗")).toBeTruthy();
  });
});
