import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProjectDetailPage } from "../src/components/Project/ProjectDetailPage";

vi.mock("../src/api/client", () => ({
  getProject: vi.fn(async () => ({
    id: "proj-1",
    name: "星麦直播",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-02T00:00:00Z",
    status: "active",
    memory_summary: "[2026-06-02] 诊断：market（需关注）：获客成本过高",
    memory_entries: [
      {
        id: "mem-1",
        created_at: "2026-06-02T00:00:00Z",
        entry_type: "diagnosis",
        summary: "market（需关注）：获客成本过高；建议：降本",
        payload: {},
        source_id: "rec-1",
      },
      {
        id: "mem-2",
        created_at: "2026-06-01T00:00:00Z",
        entry_type: "feedback",
        summary: "market 诊断反馈：待改进，评分 2/5；反馈：建议太泛",
        payload: {},
        source_id: "fb-1",
      },
    ],
    sessions: [],
    records: [],
  })),
}));

describe("ProjectDetailPage memory timeline", () => {
  it("renders structured project memory entries", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("企业长期档案"));
    expect(screen.getByText("诊断")).toBeTruthy();
    expect(screen.getByText(/获客成本过高/)).toBeTruthy();
    expect(screen.getByText("反馈")).toBeTruthy();
    expect(screen.getByText(/建议太泛/)).toBeTruthy();
  });
});
