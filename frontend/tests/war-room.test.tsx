import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DecisionBoard } from "../src/components/WarRoom/DecisionBoard";
import { DepartmentActionGrid } from "../src/components/WarRoom/DepartmentActionGrid";
import { EvidenceRiskPanel } from "../src/components/WarRoom/EvidenceRiskPanel";
import { WarRoomPage } from "../src/components/WarRoom/WarRoomPage";
import type { WarRoomPlan } from "../src/types";

const plan: WarRoomPlan = {
  id: "wr_1",
  record_id: "rec_1",
  project_id: "proj_1",
  summary: "未来 30 天优先打销售承接战，次战场关注市场投放结构。",
  primary_battlefield: "sales",
  secondary_battlefield: "market",
  objective: "30 天内提升高质量线索成交率",
  confidence: 0.76,
  decision_items: [
    {
      title: "拍板：重分线索池",
      detail: "是否授权销售负责人本周启动重分线索池。",
      urgency: "now",
    },
    {
      title: "拍板：补齐关键数据",
      detail: "是否立即补齐推广账号数据。",
      urgency: "now",
    },
  ],
  battle_chain: [
    { id: "sales", label: "销售重分线索", depends_on: [], note: "" },
    { id: "market", label: "市场清渠道", depends_on: ["sales"], note: "先统一线索质量口径" },
  ],
  department_actions: [
    {
      id: "sales-action-1",
      department: "sales",
      department_label: "销售与增长",
      battle_goal: "销售承接速度慢导致高意向线索流失",
      priority: "now",
      action_title: "重分线索池",
      action_detail: "A 类线索 10 分钟内首响",
      owner_role: "销售负责人",
      start_window: "本周启动",
      dependency: "本期主战场",
      acceptance_rule: "两周后提供首响时长与成交率变化。",
      required_data: [
        {
          key: "crm_conversion",
          label: "CRM 阶段转化率",
          reason: "验证线索在哪个阶段流失",
          source_hint: "CRM",
          required: true,
        },
      ],
      metrics: [
        {
          name: "高质量线索成交率",
          target: "30 天内出现改善",
          direction: "up",
        },
      ],
      risk_note: "缺少 CRM 数据时先按保守假设执行。",
      confidence: 0.76,
      confidence_reason: "引用覆盖 2/3；缺少 1 类必需数据，置信度下调",
      evidence_refs: ["销售漏斗近 30 天恶化"],
    },
  ],
  priority_board: {
    now: ["重分线索池"],
    soon: ["暂停低效渠道"],
    later: ["保持交付周检查"],
  },
  evidence_summary: ["销售与增长：销售漏斗近 30 天恶化（经营数据）"],
  risk_summary: ["缺少 CRM 阶段转化率，相关判断先按保守方案执行。"],
  data_gaps: [
    {
      key: "crm_conversion",
      label: "CRM 阶段转化率",
      reason: "验证线索在哪个阶段流失",
      source_hint: "CRM",
      required: true,
    },
  ],
  checkpoints: [
    { window: "7d", title: "7 天启动检查", checks: ["关键数据是否补齐"] },
    { window: "14d", title: "14 天过程复盘", checks: ["过程指标是否变化"] },
    { window: "30d", title: "30 天验收与转向", checks: ["核心目标是否改善"] },
  ],
};

describe("WarRoomPage", () => {
  it("renders the boss decision flow from war_room_plan", () => {
    render(<WarRoomPage plan={plan} />);

    expect(screen.getByText("老板作战室")).toBeTruthy();
    expect(screen.getByText(plan.summary)).toBeTruthy();
    expect(screen.getAllByText("销售与增长").length).toBeGreaterThan(0);
    expect(screen.getByText("市场与客户")).toBeTruthy();
    expect(screen.getByText("30 天内提升高质量线索成交率")).toBeTruthy();
    expect(screen.getAllByText("重分线索池").length).toBeGreaterThan(0);
    expect(screen.getByText("销售重分线索")).toBeTruthy();
    expect(screen.getByText("市场清渠道")).toBeTruthy();
    expect(screen.getAllByText("CRM 阶段转化率").length).toBeGreaterThan(0);
    expect(screen.getByText("7 天启动检查")).toBeTruthy();
    expect(screen.getByText("14 天过程复盘")).toBeTruthy();
    expect(screen.getByText("30 天验收与转向")).toBeTruthy();
  });

  it("keeps internal implementation terms out of the boss-facing view", () => {
    render(<WarRoomPage plan={plan} />);

    expect(screen.queryByText(/agent/i)).toBeNull();
    expect(screen.queryByText(/orchestration/i)).toBeNull();
    expect(screen.queryByText(/composer/i)).toBeNull();
  });
});

describe("WarRoom components", () => {
  it("renders decision items without needing the full page shell", () => {
    render(<DecisionBoard items={plan.decision_items} />);

    expect(screen.getByText("老板今天要拍板的事")).toBeTruthy();
    expect(screen.getByText("补齐关键数据")).toBeTruthy();
    expect(screen.getAllByText("立即拍板").length).toBeGreaterThan(0);
    expect(screen.queryByText("展开判断依据")).toBeNull();
  });

  it("renders department action cards with metrics, data gaps, risk, and confidence", () => {
    const { container } = render(<DepartmentActionGrid actions={plan.department_actions} />);
    const detail = container.querySelector(".department-card__detail") as HTMLDetailsElement;

    expect(screen.getByText("部门动作区")).toBeTruthy();
    expect(detail.open).toBe(false);
    expect(screen.getByText("高质量线索成交率：30 天内出现改善")).toBeTruthy();
    expect(screen.getByText("证据置信度 76%")).toBeTruthy();

    fireEvent.click(screen.getByText("查看执行细节与风险"));
    expect(detail.open).toBe(true);
    expect(screen.getByText("A 类线索 10 分钟内首响")).toBeTruthy();
    expect(screen.getByText("缺少 CRM 数据时先按保守假设执行。")).toBeTruthy();
    expect(screen.getByText("置信度依据")).toBeTruthy();
    expect(screen.getByText("引用覆盖 2/3；缺少 1 类必需数据，置信度下调")).toBeTruthy();
  });

  it("renders evidence, risks, and data requests as a standalone evidence panel", () => {
    render(
      <EvidenceRiskPanel
        evidence={plan.evidence_summary}
        risks={plan.risk_summary}
        dataGaps={plan.data_gaps}
      />
    );

    expect(screen.getByText("证据与风险")).toBeTruthy();
    expect(screen.getByText("销售与增长：销售漏斗近 30 天恶化（经营数据）")).toBeTruthy();
    expect(screen.getByText("缺少 CRM 阶段转化率，相关判断先按保守方案执行。")).toBeTruthy();
    expect(screen.getByText("CRM 阶段转化率")).toBeTruthy();
  });
});
