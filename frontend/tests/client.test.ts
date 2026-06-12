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
      }),
    })) as any;
    const data = await runDiagnose([{ module: "market", facts: {}, pains: [] }]);
    expect(data.results[0].module).toBe("market");
    expect(data.record_id).toBe("rec1");
    expect(data.skill_version_ids.market).toBe("v1");
  });
});
