import { describe, it, expect, vi } from "vitest";
import { runDiagnose } from "../src/api/client";

describe("runDiagnose", () => {
  it("posts answers and returns full result", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [{ module: "market", signal: "red", conclusion: "x", evidence: [], actions: ["a"], drilldown: null }],
        record_id: "rec1",
        skill_version_ids: { market: "v1" },
        triage: {
          primary_module: "market",
          selected_experts: [{ module: "market", label: "市场与客户", reason: "用户填写了该模块", priority: 10 }],
          conflicts: [],
          dependencies: [],
          priority_actions: ["市场与客户：a"],
        },
      }),
    })) as any;
    const data = await runDiagnose([{ module: "market", facts: {}, pains: [] }]);
    expect(data.results[0].module).toBe("market");
    expect(data.record_id).toBe("rec1");
    expect(data.skill_version_ids.market).toBe("v1");
    expect(data.triage.primary_module).toBe("market");
  });

  it("includes problem map when posting diagnosis", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [],
        record_id: null,
        skill_version_ids: {},
        triage: {
          primary_module: null,
          selected_experts: [],
          conflicts: [],
          dependencies: [],
          priority_actions: [],
        },
      }),
    }));
    globalThis.fetch = fetchMock as any;

    await runDiagnose(
      [{ module: "market", facts: {}, pains: [] }],
      undefined,
      undefined,
      {
        core_problem: "获客成本翻倍",
        diagnosis_focus: "sales",
      }
    );

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, init] = firstCall;
    expect(JSON.parse(init.body as string).problem_map).toEqual({
      core_problem: "获客成本翻倍",
      diagnosis_focus: "sales",
    });
  });
});
