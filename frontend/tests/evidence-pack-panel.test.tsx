import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidencePackPanel } from "../src/components/Evidence/EvidencePackPanel";
import type { ResearchEvidenceOut } from "../src/types";

const baseEvidence = {
  job_id: "job-1",
  project_id: "proj-1",
  record_id: "rec-1",
  module: "market",
  source_stage: "expert_supplemental_research",
  provider: "perplexity",
  source_type: "web",
  credibility: 0.62,
  retrieved_at: "2026-06-17T00:00:00Z",
  url: "https://example.com/source",
};

describe("EvidencePackPanel electric stove report", () => {
  it("turns noisy electric-stove sources into a concise due-diligence report", () => {
    const evidence: ResearchEvidenceOut[] = [
      {
        ...baseEvidence,
        id: "policy-long",
        query: "电火灶 新能源厨电 政策 合规 资质",
        title: "国家能源局关于进一步深化电力业务资质许可管理更好服务新型电力系统建设的实施意见",
        snippet:
          "公开事项名称:|国家能源局关于进一步深化电力业务资质许可管理更好服务新型电力系统建设的实施意见（国能发资质﹝2025﹞41号）|电力业务资质许可管理是我国电力市场准入监管的关键环节，多年来在推进电力体制改革、维护电力市场秩序、促进电力生产安全等方面发挥了重要作用。为进一步深化资质许可管理，更好服务新型电力系统建设，依据相关法律法规提出以下实施意见。".repeat(3),
        credibility: 0.9,
      },
      {
        ...baseEvidence,
        id: "huahuo-brand",
        query: "华火新能源 电火灶 招商加盟 回本周期",
        title: "人工智能新能源-华火电火灶品牌中心",
        snippet: "电火灶行业“特斯拉时刻”已至！华火邀你共享万亿市场荣光，抢占招商C位！",
      },
      {
        ...baseEvidence,
        id: "huahuo-channel",
        query: "华火新能源 电火灶 招商加盟 回本周期",
        title: "华火电火灶初步完成国内工厂布局，打造节能减排标杆案例",
        snippet:
          "市场数据显示，产品上市首年即突破2万台销量，国内1600个线下代理商网络与全平台线上店铺构成立体渠道。面对电生明火的技术认知壁垒，团队独创五感体验营销体系。",
      },
      {
        ...baseEvidence,
        id: "competitor",
        query: "电火灶 竞品 公开评价 投诉 招商",
        title: "火王智能灶招商会如火如荼，差异化功能引爆关注",
        snippet: "火王智能厨电在多地招商会上以创新技术和市场前景吸引投资者关注，经销商现场体验后给出正面评价。",
      },
      {
        ...baseEvidence,
        id: "irrelevant",
        query: "电火灶 竞品 公开评价 投诉 招商",
        title: "Certified Pre-Owned Vehicles - Harvey Cadillac",
        snippet: "",
      },
    ];

    render(<EvidencePackPanel evidence={evidence} />);

    expect(screen.getByText("证据分析报告")).toBeTruthy();
    expect(screen.getByText("诊断问题")).toBeTruthy();
    expect(screen.getByText("核心结论")).toBeTruthy();
    expect(screen.getByText("审核目的")).toBeTruthy();
    expect(screen.getByText(/电火灶项目的招商增长叙事/)).toBeTruthy();
    expect(screen.getByText(/招商承诺需要先证据化核验/)).toBeTruthy();
    expect(screen.getByText(/渠道规模宣称需要用真实动销校准/)).toBeTruthy();
    expect(screen.getByText(/政策与认证只能作为合规背景/)).toBeTruthy();
    expect(screen.getByText(/竞品招商热度存在/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "查看来源 2" }).length).toBeGreaterThan(0);

    expect(screen.queryByText(/国家能源局关于进一步深化电力业务资质许可管理/)).toBeNull();
    expect(screen.queryByText(/电力业务资质许可管理是我国电力市场准入监管的关键环节/)).toBeNull();
    expect(screen.queryByText(/Certified Pre-Owned Vehicles/)).toBeNull();
    expect(screen.queryByText(/以往信息质量分低于40分的商品可能被限流/)).toBeNull();
  });
});
