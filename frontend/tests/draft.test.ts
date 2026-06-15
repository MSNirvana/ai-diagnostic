import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft } from "../src/utils/draft";

// 该测试环境的 localStorage 是残缺桩，装一个完整的内存实现
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
// @ts-expect-error 覆盖全局
globalThis.localStorage = new MemStorage();

const baseState = {
  mode: "ready" as const,
  messages: [{ role: "user" as const, content: "你好" }],
  chatSummary: null,
  problemMap: null,
  activeModules: [],
  current: 2,
  facts: { market: { 客单价: "120" } },
  pains: { market: ["获客太贵"] },
  freeText: { market: "补充说明" },
  fileNames: { market__营收: ["a.csv"] },
};

describe("draft persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saveDraft 后 loadDraft 能读回来", () => {
    saveDraft("user1", baseState);
    const got = loadDraft("user1");
    expect(got).not.toBeNull();
    expect(got!.current).toBe(2);
    expect(got!.facts.market["客单价"]).toBe("120");
    expect(got!.userId).toBe("user1");
    expect(got!.savedAt).toBeTruthy();
  });

  it("保存已确认的问题地图，供后续专家分诊使用", () => {
    saveDraft("user1", {
      ...baseState,
      problemMap: {
        company_name: "",
        industry: "直播电商",
        main_business: "带货",
        business_model: "撮合",
        scale: "85人",
        stage: "成长期",
        core_problem: "获客成本翻倍",
        sub_problems: ["线索质量下降"],
        goal: "ROI回正",
        constraints: "预算不加",
        success_criteria: "ROI>1.2",
        impact: "ROI 从 1.2 降到 0.8",
        context: "近半年",
        suspected_cause: "渠道红利消失",
        tried: "换代理",
        data_readiness: "可提供投放报表",
        diagnosis_focus: "sales",
        information_score: 92,
        missing_fields: [],
        next_question_reason: "",
      },
    });

    const got = loadDraft("user1");
    expect(got!.problemMap?.core_problem).toBe("获客成本翻倍");
    expect(got!.problemMap?.diagnosis_focus).toBe("sales");
  });

  it("不同 userId 互相隔离", () => {
    saveDraft("user1", baseState);
    expect(loadDraft("user2")).toBeNull();
  });

  it("不同 projectId 互相隔离，避免新项目捡到旧项目草稿", () => {
    saveDraft("user1", { ...baseState, current: 1 }, "project-a");
    saveDraft("user1", { ...baseState, current: 3 }, "project-b");

    expect(loadDraft("user1", "project-a")!.current).toBe(1);
    expect(loadDraft("user1", "project-b")!.current).toBe(3);
    expect(loadDraft("user1", "project-c")).toBeNull();
  });

  it("clearDraft 后返回 null", () => {
    saveDraft("user1", baseState);
    clearDraft("user1");
    expect(loadDraft("user1")).toBeNull();
  });

  it("clearDraft 只清理指定项目草稿", () => {
    saveDraft("user1", { ...baseState, current: 1 }, "project-a");
    saveDraft("user1", { ...baseState, current: 3 }, "project-b");

    clearDraft("user1", "project-a");

    expect(loadDraft("user1", "project-a")).toBeNull();
    expect(loadDraft("user1", "project-b")!.current).toBe(3);
  });

  it("版本不匹配返回 null", () => {
    localStorage.setItem(
      "ai_diagnostic_draft_user1",
      JSON.stringify({ ...baseState, version: 999, userId: "user1", savedAt: "x" })
    );
    expect(loadDraft("user1")).toBeNull();
  });

  it("损坏的 JSON 返回 null 不抛错", () => {
    localStorage.setItem("ai_diagnostic_draft_user1", "{坏掉的");
    expect(loadDraft("user1")).toBeNull();
  });
});
