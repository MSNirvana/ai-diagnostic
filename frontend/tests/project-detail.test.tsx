import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import {
  confirmArchiveFileExtraction,
  deleteSessionFile,
  deleteSession,
  extractArchiveFile,
  getBrainstormSession,
  getProject,
  sendBrainstormMessage,
  startSession,
  updateSession,
  uploadSessionFile,
} from "../src/api/client";
import { ProjectDetailPage } from "../src/components/Project/ProjectDetailPage";
import type { ProjectDetail } from "../src/types";

const baseProjectDetail: ProjectDetail = {
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
      payload: {
        top_module: "market",
        signal: "red",
        conclusion: "获客成本过高但没有被拆到渠道、素材和承接链路，导致团队只能看到成本上升，却不知道该先砍预算还是先修转化。",
        actions: ["先补齐近 30 天渠道花费、线索质量、跟进阶段和成交结果，再判断优先优化哪一段链路", "优化渠道结构"],
        triage: {
          priority_actions: ["市场与客户：先重做渠道结构"],
        },
      },
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
  sessions: [
    {
      id: "sess-1",
      title: "获客成本过高",
      status: "filling",
      updated_at: "2026-06-03T00:00:00Z",
    },
  ],
  brainstorm_sessions: [
    {
      id: "brain-1",
      title: "低成本获客动作",
      updated_at: "2026-06-04T00:00:00Z",
      is_pinned: false,
      use_project_context: true,
    },
  ],
  records: [
    {
      id: "rec-1",
      created_at: "2026-06-02T00:00:00Z",
      module_count: 3,
      has_war_room_plan: true,
      review_status: "approved",
    },
  ],
  archive: {
    profile: [
      { label: "公司名称", value: "睿策视界" },
      { label: "所属行业", value: "直播电商" },
      { label: "主营业务", value: "直播间增长诊断" },
      { label: "规模", value: "50 人" },
    ],
    modules: [
      {
        module: "market",
        label: "市场与客户",
        has_data: true,
        facts: [
          { label: "投放渠道", value: "抖音、小红书" },
          { label: "近 30 天线索", value: "1200 条" },
          { label: "获客成本", value: "180 元" },
          { label: "转化率", value: "8%" },
        ],
      },
      { module: "product", label: "产品与服务", has_data: false, facts: [] },
      { module: "sales", label: "销售与增长", has_data: false, facts: [] },
      { module: "ops", label: "运营与供应链", has_data: false, facts: [] },
      { module: "org", label: "组织与人才", has_data: false, facts: [] },
      { module: "finance", label: "财务与资本", has_data: false, facts: [] },
    ],
    files: [],
    last_updated: "2026-06-02T00:00:00Z",
  },
  delivery_status: {
    state: "approved",
    approved_count: 1,
    pending_review_count: 0,
    rejected_count: 0,
    latest_review_status: "approved",
  },
  war_room_plan: {
    id: "wr-1",
    record_id: "rec-1",
    project_id: "proj-1",
    source_record_ids: ["rec-1"],
    iteration_count: 1,
    iterations: [
      {
        record_id: "rec-1",
        created_at: "2026-06-02T00:00:00Z",
        summary: "本轮经营会先围绕获客成本过高定动作。",
        primary_battlefield: "market",
        objective: "把 CAC 降下来",
        confidence: 0.7,
        changes: ["建立项目作战室"],
      },
    ],
    summary: "本轮经营会先围绕获客成本过高定动作。",
    primary_battlefield: "market",
    secondary_battlefield: "",
    objective: "把 CAC 降下来",
    confidence: 0.7,
    decision_items: [],
    battle_chain: [],
    department_actions: [],
    priority_board: { now: [], soon: [], later: [] },
    evidence_summary: [],
    risk_summary: [],
    data_gaps: [],
    checkpoints: [],
  },
};

vi.mock("../src/api/client", () => ({
  listProjects: vi.fn(async () => [
    {
      id: "proj-1",
      name: "星麦直播",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-02T00:00:00Z",
      status: "active",
      memory_summary: "[2026-06-02] 诊断：market（需关注）：获客成本过高",
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `extra-${index + 1}`,
      name: `补充项目 ${index + 1}`,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      status: "active",
      memory_summary: "",
    })),
  ]),
  patchProject: vi.fn(async (_id: string, body: { name?: string; status?: string }) => ({
    id: _id,
    name: body.name ?? "星麦直播",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    status: body.status ?? "active",
    memory_summary: "",
  })),
  getProjectEvidence: vi.fn(async () => [
    {
      id: "ev-1",
      job_id: "job-1",
      project_id: "proj-1",
      record_id: "rec-1",
      module: "market",
      source_stage: "expert_supplemental_research",
      provider: "perplexity",
      query: "电火灶 招商加盟 回本周期",
      title: "电火灶招商加盟页",
      url: "https://example.com/franchise",
      snippet: "公开招商页强调回本周期，需要结合资质与合同审查。",
      source_type: "web",
      credibility: 0.7,
      retrieved_at: "2026-06-03T00:00:00Z",
    },
  ]),
  createDiagnosisJob: vi.fn(async () => ({ job_id: "job-1", status: "queued" })),
  sendBrainstormMessage: vi.fn(async () => ({
    message: "好的，先看两个关键点： 1. **你现在卖的是什么？** 要给谁？ 2. **当前获客卡在哪里？** 是没人知道，还是来了不转化？",
    brainstorm_session_id: "brain-1",
  })),
  getBrainstormSession: vi.fn(async () => ({
    id: "brain-1",
    project_id: "proj-1",
    created_at: "2026-06-04T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    title: "低成本获客动作",
    is_pinned: false,
    use_project_context: true,
    messages: [
      { role: "user", content: "基于当前项目，帮我推演一个低成本获客动作。" },
      { role: "assistant", content: "可以先从渠道承接链路做验证。" },
    ],
  })),
  updateBrainstormSession: vi.fn(async (id: string, body: { title?: string; is_pinned?: boolean }) => ({
    id,
    project_id: "proj-1",
    created_at: "2026-06-04T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    title: body.title ?? "低成本获客动作",
    is_pinned: body.is_pinned ?? false,
    use_project_context: true,
  })),
  deleteBrainstormSession: vi.fn(async () => {}),
  startSession: vi.fn(async () => "sess-new"),
  sessionChat: vi.fn(async () => ({
    message: "我先把问题拆成目标、约束和可验证数据。",
    phase: "intake",
    problem_map: null,
  })),
  getSessionDetail: vi.fn(async () => ({
    id: "sess-1",
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-03T00:00:00Z",
    title: "获客成本过高",
    status: "filling",
    messages: [
      { role: "assistant", content: "你好，我是你的诊断顾问。" },
      { role: "user", content: "获客成本过高" },
    ],
    problem_map: null,
    diagnosis_record_id: null,
    draft_json: null,
  })),
  updateSession: vi.fn(async (id: string, body: { title?: string; is_pinned?: boolean }) => ({
    id,
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    title: body.title ?? "获客成本过高",
    status: "filling",
    is_pinned: body.is_pinned ?? false,
  })),
  deleteSession: vi.fn(async () => {}),
  generateFromSummary: vi.fn(async () => ({ modules: [] })),
  saveSessionDraft: vi.fn(async () => {}),
  uploadSessionFile: vi.fn(async (_sessionId: string, moduleKey: string, fieldKey: string, file: File) => ({
    id: "file-brainstorm-1",
    module_key: moduleKey,
    field_key: fieldKey,
    original_name: file.name,
    parsed_summary: "{}",
    summary_text: `资料《${file.name}》解析摘要。`,
  })),
  extractArchiveFile: vi.fn(async () => ({
    file_id: "file-1",
    module: "market",
    field: "archive_upload",
    file_name: "渠道调研纪要.pdf",
    summary: "材料里已经明确了渠道结构和目标客群，可直接沉淀。",
    status: "pending_confirm",
    highlights: [
      { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
      { label: "渠道结构", value: "当前重点依赖短视频获客、招商页承接和线索回访。" },
    ],
  })),
  confirmArchiveFileExtraction: vi.fn(async () => ({
    ...baseProjectDetail.archive,
    modules: [
      {
        module: "market",
        label: "市场与客户",
        has_data: true,
        facts: [
          { label: "投放渠道", value: "抖音、小红书" },
          { label: "近 30 天线索", value: "1200 条" },
          { label: "获客成本", value: "180 元" },
          { label: "转化率", value: "8%" },
          { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
        ],
      },
      { module: "product", label: "产品与服务", has_data: false, facts: [] },
      { module: "sales", label: "销售与增长", has_data: false, facts: [] },
      { module: "ops", label: "运营与供应链", has_data: false, facts: [] },
      { module: "org", label: "组织与人才", has_data: false, facts: [] },
      { module: "finance", label: "财务与资本", has_data: false, facts: [] },
    ],
    files: [
      {
        id: "file-1",
        name: "渠道调研纪要.pdf",
        module: "market",
        field: "archive_upload",
        uploaded_at: "2026-06-02T00:00:00Z",
        extraction_status: "confirmed",
        extracted_highlights: [
          { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
          { label: "渠道结构", value: "当前重点依赖短视频获客、招商页承接和线索回访。" },
        ],
      },
    ],
  })),
  listSessionFiles: vi.fn(async () => []),
  deleteSessionFile: vi.fn(async () => {}),
  getProject: vi.fn(async () => structuredClone(baseProjectDetail)),
}));

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  try {
    window.localStorage?.removeItem?.("ruice:pinned-projects");
  } catch {
    // localStorage may be partially stubbed in the test runner.
  }
});

describe("ProjectDetailPage memory timeline", () => {
  it("renders structured project memory entries", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("今天，你想解决什么？"));
    expect(screen.getByText("今天，你想解决什么？")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "帮我梳理当前最核心的问题" })).toBeNull();
    expect(screen.queryByRole("button", { name: "这件事应该先看哪些数据" })).toBeNull();
    expect(screen.queryByRole("button", { name: "把问题拆成可执行动作" })).toBeNull();
    expect(screen.getByRole("button", { name: /新对话/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /企业档案/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /作战室/ })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "项目功能" })).queryByRole("button", { name: /头脑风暴/ })).toBeNull();
    expect(screen.getByText("对话记录")).toBeTruthy();
    expect(screen.getByText("风暴记录")).toBeTruthy();
    expect(screen.getByText("获客成本过高")).toBeTruthy();
    expect(screen.queryByText("低成本获客动作")).toBeNull();
    await waitFor(() => expect(screen.getByRole("tab", { name: "风暴记录 1" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "风暴记录 1" }));
    expect(screen.getByText("低成本获客动作")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "对话记录 1" }));
    expect(screen.getByText("获客成本过高")).toBeTruthy();
    expect(screen.getByText("项目工作台")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "返回项目组合" })).toBeNull();
    expect(screen.queryByText("当前状态")).toBeNull();
    expect(screen.queryByText("推进路径")).toBeNull();
    expect(screen.queryByText("下一步")).toBeNull();
    expect(screen.queryByText("证据分析报告")).toBeNull();
    expect(screen.queryByText("查看交付")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /企业档案/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "经营板块" })).toBeTruthy());
    expect(screen.getAllByText("企业档案").length).toBeGreaterThan(0);
    expect(screen.getAllByText("直播电商").length).toBeGreaterThan(0);
    const completeness = screen.getByLabelText(/档案完整度/).getAttribute("aria-label") ?? "";
    expect(Number(completeness.match(/\d+/)?.[0] ?? 100)).toBeLessThan(100);
    expect(screen.queryByRole("button", { name: /企业概况/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "关联数据" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "诊断迭代" })).toBeNull();
    expect(screen.queryByText("证据分析报告")).toBeNull();
    expect(screen.queryByText("关联证据参考")).toBeNull();

    expect(screen.getAllByText("市场与客户").length).toBeGreaterThan(0);
    expect(screen.getByText("获客成本")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /关联数据/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "关联数据" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "资料资产" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "关联证据参考" })).toBeNull();
    expect(screen.queryByRole("button", { name: "上传资料" })).toBeNull();
    expect(screen.queryByText("电火灶招商加盟页")).toBeNull();
    expect(screen.queryByText(/公开招商页强调回本周期/)).toBeNull();
    expect(screen.getByText(/1 条原始证据已归档/)).toBeTruthy();

    await waitFor(() => expect(screen.getByText("关联证据内容")).toBeTruthy());
    expect(screen.getByText("证据分析报告")).toBeTruthy();
    expect(screen.getByText("核心结论")).toBeTruthy();
    expect(screen.getByText(/招商承诺需要先证据化核验/)).toBeTruthy();
    expect(screen.getByText(/不能直接证明代理可复制赚钱/)).toBeTruthy();
    expect(screen.getByText(/需要补充的数据/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "查看来源 1" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /诊断迭代/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "诊断迭代" })).toBeTruthy());
    expect(screen.getByText("查看归档更新记录")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /新对话/ }));
    fireEvent.click(within(screen.getByLabelText("对话模式")).getByRole("button", { name: "头脑风暴" }));
    await waitFor(() => expect(screen.getAllByText("头脑风暴").length).toBeGreaterThan(0));
    expect(screen.getByText("来来，我们碰撞一下！")).toBeTruthy();
    expect(screen.queryByText("把这个项目里的新想法、假设或经营动作丢给我，我会帮你做推演。")).toBeNull();
    expect(screen.getByPlaceholderText("输入消息...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /问题地图/ })).toBeNull();
    expect(screen.getByRole("button", { name: "帮我推演一个低成本获客动作" })).toBeTruthy();
  });

  it("expands archived facts when requested", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getAllByText("企业档案").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /经营板块/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "经营板块" })).toBeTruthy());
    fireEvent.click(screen.getByText("展开其余 1 项"));

    expect(screen.getByText("转化率")).toBeTruthy();
  });

  it("closes the sidebar three-dot menu when clicking outside", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText("管理对话：获客成本过高")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("管理对话：获客成本过高"));
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeTruthy();

    fireEvent.pointerDown(screen.getByText("今天，你想解决什么？"));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "重命名" })).toBeNull());
  });

  it("lets project brainstorm examples fill the draft and toggles project context", async () => {
    const brainstormMock = vi.mocked(sendBrainstormMessage);
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=brainstorm"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(within(screen.getByLabelText("对话模式")).getByRole("button", { name: "头脑风暴" })).toBeTruthy();
    });
    expect(screen.getByText("来来，我们碰撞一下！")).toBeTruthy();
    const prompt = "帮我推演一个低成本获客动作";
    fireEvent.click(screen.getByRole("button", { name: prompt }));
    expect((screen.getByPlaceholderText("输入消息...") as HTMLTextAreaElement).value).toBe(prompt);
    expect(brainstormMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("更多输入选项"));
    fireEvent.click(screen.getByRole("menuitem", { name: /上传资料/ }));
    const fileInput = document.querySelector(".chat-file-input") as HTMLInputElement;
    const file = new File(["渠道假设"], "头脑风暴资料.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("头脑风暴资料.pdf")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(brainstormMock).toHaveBeenCalledTimes(1));
    expect(brainstormMock.mock.calls[0][1]).toEqual({
      projectId: "proj-1",
      useProjectContext: true,
      attachmentFileIds: ["file-brainstorm-1"],
      brainstormSessionId: undefined,
    });
    expect(await screen.findByText(/你现在卖的是什么/)).toBeTruthy();
    expect(screen.getByText(/当前获客卡在哪里/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("更多输入选项"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /带入项目信息/ }));
    fireEvent.change(screen.getByPlaceholderText("输入消息..."), {
      target: { value: "只按通用逻辑推演一个招商话术。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(brainstormMock).toHaveBeenCalledTimes(2));
    expect(brainstormMock.mock.calls[1][1]).toEqual({
      projectId: "proj-1",
      useProjectContext: false,
      attachmentFileIds: [],
      brainstormSessionId: "brain-1",
    });
  });

  it("restores project brainstorm records from the sidebar", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "风暴记录 1" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "风暴记录 1" }));
    await waitFor(() => expect(screen.getByText("低成本获客动作")).toBeTruthy());
    fireEvent.click(screen.getByText("低成本获客动作"));

    await waitFor(() => expect(getBrainstormSession).toHaveBeenCalledWith("brain-1"));
    expect(await screen.findByText("可以先从渠道承接链路做验证。")).toBeTruthy();
  });

  it("sends project brainstorm on Enter but ignores composing Enter", async () => {
    const brainstormMock = vi.mocked(sendBrainstormMessage);
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=brainstorm"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText("输入消息...");
    fireEvent.change(input, { target: { value: "先不要发送" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(brainstormMock).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "现在发送" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(brainstormMock).toHaveBeenCalledTimes(1));
  });

  it("opens the project-level war room", async () => {
    function LocationProbe() {
      return <span data-testid="location">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route
            path="/projects/:id"
            element={
              <>
                <ProjectDetailPage />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="/projects/:projectId/war-room"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByRole("button", { name: /作战室/ }));
    fireEvent.click(screen.getByRole("button", { name: /作战室/ }));

    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj-1/war-room"
    );
  });

  it("uploads operating data directly from missing archive sections", async () => {
    const uploadSessionFileMock = vi.mocked(uploadSessionFile);
    function LocationProbe() {
      return <span data-testid="location">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive"]}>
        <Routes>
          <Route
            path="/projects/:id"
            element={
              <>
                <ProjectDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByRole("button", { name: /经营板块/ }));
    fireEvent.click(screen.getByRole("button", { name: /经营板块/ }));
    await waitFor(() => screen.getByRole("button", { name: /产品与服务/ }));
    fireEvent.click(screen.getByRole("button", { name: /产品与服务/ }));
    await waitFor(() => screen.getAllByRole("button", { name: "补充经营数据" }));
    fireEvent.click(screen.getAllByRole("button", { name: "补充经营数据" })[0]);

    const fileInput = document.querySelector(".project-archive-file-input") as HTMLInputElement;
    const file = new File(["sku,revenue\nA,10"], "产品经营数据.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(uploadSessionFileMock).toHaveBeenCalledWith(
        "sess-new",
        "product",
        "operating_data",
        file
      )
    );
    expect(screen.getByTestId("location").textContent).toBe("/projects/proj-1");
  });

  it("keeps associated data focused on evidence instead of file uploads", async () => {
    function LocationProbe() {
      return <span data-testid="location">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive"]}>
        <Routes>
          <Route
            path="/projects/:id"
            element={
              <>
                <ProjectDetailPage />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="/projects/:projectId/diagnose"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByRole("button", { name: /关联数据/ }));
    fireEvent.click(screen.getByRole("button", { name: /关联数据/ }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "关联数据" })).toBeTruthy());
    expect(screen.getByText("关联证据内容")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "上传资料" })).toBeNull();
    expect(uploadSessionFile).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/projects/proj-1");
  });

  it("uploads files into the selected business domain", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByRole("button", { name: /市场与客户/ }));
    fireEvent.click(screen.getByRole("button", { name: /市场与客户/ }));
    await waitFor(() => screen.getByRole("button", { name: "上传资料" }));

    const input = document.querySelector(".project-archive-file-input") as HTMLInputElement;
    const file = new File(["产品资料"], "产品手册.pdf", { type: "application/pdf" });
    fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadSessionFile).toHaveBeenCalledWith("sess-new", "market", "archive_upload", file));
  });

  it("extracts archive highlights and confirms before updating the archive", async () => {
    const getProjectMock = vi.mocked(getProject);
    const extractArchiveFileMock = vi.mocked(extractArchiveFile);
    const confirmArchiveFileExtractionMock = vi.mocked(confirmArchiveFileExtraction);
    const projectState = structuredClone(baseProjectDetail);
    projectState.archive.files = [
      {
        id: "file-1",
        name: "渠道调研纪要.pdf",
        module: "market",
        field: "archive_upload",
        uploaded_at: "2026-06-02T00:00:00Z",
        extraction_status: "none",
        extracted_highlights: [],
      },
    ];
    getProjectMock.mockImplementation(async () => structuredClone(projectState));

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "经营板块" })).toBeTruthy());
    expect(screen.getByText("渠道调研纪要.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "沉淀" }));
    await waitFor(() => expect(extractArchiveFileMock).toHaveBeenCalledWith("proj-1", "file-1"));
    expect(screen.getByRole("dialog", { name: "确认资料沉淀" })).toBeTruthy();
    expect(screen.getByDisplayValue("目标客群")).toBeTruthy();
    expect(screen.getByDisplayValue("加盟创业者和三四线餐饮门店老板是核心沟通对象。")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("材料里已经明确了渠道结构和目标客群，可直接沉淀。"), {
      target: { value: "这份资料已提炼出目标客群与渠道打法，可并入市场与客户档案。" },
    });
    fireEvent.change(screen.getByDisplayValue("渠道结构"), {
      target: { value: "渠道打法" },
    });

    fireEvent.click(screen.getByRole("button", { name: "确认沉淀" }));

    await waitFor(() =>
      expect(confirmArchiveFileExtractionMock).toHaveBeenCalledWith("proj-1", "file-1", {
        highlights: [
          { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
          { label: "渠道打法", value: "当前重点依赖短视频获客、招商页承接和线索回访。" },
        ],
        summary: "这份资料已提炼出目标客群与渠道打法，可并入市场与客户档案。",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认资料沉淀" })).toBeNull());
  });

  it("deletes uploaded archive files without removing confirmed archive facts", async () => {
    const getProjectMock = vi.mocked(getProject);
    const deleteSessionFileMock = vi.mocked(deleteSessionFile);
    const projectWithFile = structuredClone(baseProjectDetail);
    projectWithFile.archive.modules = projectWithFile.archive.modules.map((module) =>
      module.module === "market"
        ? {
            ...module,
            has_data: true,
            facts: [
              ...module.facts,
              { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
            ],
          }
        : module
    );
    projectWithFile.archive.files = [
      {
        id: "file-1",
        name: "渠道调研纪要.pdf",
        module: "market",
        field: "archive_upload",
        uploaded_at: "2026-06-02T00:00:00Z",
        extraction_status: "confirmed",
        extracted_highlights: [
          { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
        ],
      },
    ];
    const projectAfterDelete = structuredClone(projectWithFile);
    projectAfterDelete.archive.files = [];
    getProjectMock
      .mockResolvedValueOnce(structuredClone(projectWithFile))
      .mockResolvedValueOnce(structuredClone(projectAfterDelete));

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("渠道调研纪要.pdf")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteSessionFileMock).toHaveBeenCalledWith("file-1"));
    await waitFor(() => expect(screen.queryByText("渠道调研纪要.pdf")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /经营板块/ }));
    fireEvent.click(screen.getByRole("button", { name: /展开其余/ }));
    await waitFor(() => expect(screen.getByText("目标客群")).toBeTruthy());
    expect(screen.getByText("加盟创业者和三四线餐饮门店老板是核心沟通对象。")).toBeTruthy();
  });

  it("resumes a project conversation from the problem entry history rail", async () => {
    function LocationProbe() {
      return <span data-testid="location">{useLocation().pathname}</span>;
    }

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route
            path="/projects/:id"
            element={
              <>
                <ProjectDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("对话记录"));
    fireEvent.click(screen.getByRole("button", { name: /^获客成本过高/ }));

    expect(screen.getByTestId("location").textContent).toBe("/projects/proj-1");
    expect(await screen.findByText("你好，我是你的诊断顾问。")).toBeTruthy();
  });

  it("manages conversation records with a lightweight sidebar popover", async () => {
    const updateSessionMock = vi.mocked(updateSession);
    const deleteSessionMock = vi.mocked(deleteSession);

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("获客成本过高"));

    fireEvent.click(screen.getByRole("button", { name: /管理对话：获客成本过高/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶对话" }));
    await waitFor(() => expect(updateSessionMock).toHaveBeenCalledWith("sess-1", { is_pinned: true }));
    expect(screen.getByText("置顶")).toBeTruthy();

    updateSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-05T00:00:00Z",
      title: "直播获客成本复盘",
      status: "filling",
      is_pinned: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /管理对话：获客成本过高/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const renameInput = screen.getByLabelText("重命名对话");
    fireEvent.change(renameInput, { target: { value: "直播获客成本复盘" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("直播获客成本复盘")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /管理对话：直播获客成本复盘/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByText("删除这条对话？")).toBeTruthy();
    expect(screen.getByText("删除后会从本项目侧栏隐藏，关联诊断和文件不会被删除。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteSessionMock).toHaveBeenCalledWith("sess-1"));
    expect(screen.queryByText("直播获客成本复盘")).toBeNull();
  });

  it("keeps project management outside the project workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("今天，你想解决什么？"));
    expect(screen.getByText("返回项目列表")).toBeTruthy();
    expect(screen.queryByText(/检测到上次未完成的填写/)).toBeNull();
    expect(screen.queryByText(/你好，我是你的诊断顾问/)).toBeNull();
    expect(screen.queryByText(/查看全部/)).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "置顶会话" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "重命名" })).toBeNull();
    expect(screen.queryByText("归档后会从左侧默认列表隐藏，数据不会删除。")).toBeNull();
  });
});
