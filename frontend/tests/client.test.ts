import { describe, it, expect, vi } from "vitest";
import { runDiagnose } from "../src/api/client";

describe("runDiagnose", () => {
  it("posts answers and returns results", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ module: "market", signal: "red", conclusion: "x", evidence: [], actions: ["a"], drilldown: null }] }),
    })) as any;
    const results = await runDiagnose([{ module: "market", facts: {}, pains: [] }]);
    expect(results[0].module).toBe("market");
  });
});
