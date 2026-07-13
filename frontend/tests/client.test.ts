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

  it("refreshes an expired GGOO token and retries the Build request", async () => {
    localStorage.setItem("auth_token", "expired-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 200, data: { access_token: "fresh-token" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
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
      });
    globalThis.fetch = fetchMock;

    await runDiagnose([{ module: "market", facts: {}, pains: [] }]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("api.ggoo.ai/api/v1/auth/refresh");
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh-token");
    expect(localStorage.getItem("auth_token")).toBe("fresh-token");
  });

  it("keeps the current session when GGOO refresh is temporarily unavailable", async () => {
    localStorage.setItem("auth_token", "expired-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    globalThis.fetch = fetchMock;

    await expect(
      runDiagnose([{ module: "market", facts: {}, pains: [] }])
    ).rejects.toThrow("GGOO 登录刷新暂时不可用");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("auth_token")).toBe("expired-token");
  });
});
