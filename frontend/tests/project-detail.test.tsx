import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import {
  addArchiveModule,
  confirmArchiveFileExtraction,
  createDiagnosisJob,
  deleteSessionFile,
  deleteSession,
  downloadSessionFile,
  extractArchiveFile,
  getBrainstormSession,
  getDiagnosisJob,
  getSessionDetail,
  getLatestDiagnosisJobForSession,
  getProject,
  hideArchiveModule,
  getSessionFileBlob,
  sendBrainstormMessage,
  saveSessionDraft,
  sessionChat,
  startSession,
  updateSession,
  uploadSessionFile,
  viewSessionFile,
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
    recommended_modules: [
      { module: "legal_compliance", label: "法务合规", reason: "项目涉及合同与宣传承诺。" },
      { module: "channel_franchise", label: "渠道与加盟", reason: "项目涉及招商加盟。" },
    ],
    hidden_modules: [],
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
  getDiagnosisJob: vi.fn(async () => ({
    id: "job-1",
    status: "pending_review",
    current_step: "顾问审核中",
    progress: 1,
    record_id: "rec-2",
    project_id: "proj-1",
    error: null,
    result_summary: null,
  })),
  getLatestDiagnosisJobForSession: vi.fn(async () => null),
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
  generateFromSummary: vi.fn(async () => ({
    modules: [
      {
        key: "market",
        label: "市场与客户",
        subtitle: "先补齐渠道、投放和转化数据，再进入深度尽调。",
        fields: [
          {
            key: "channel_cost",
            label: "近 30 天渠道花费",
            placeholder: "例如：抖音 8 万，小红书 2 万。",
            hint: "用于判断获客成本上升来自渠道价格、素材效率还是承接转化。",
            accept_file: true,
          },
        ],
        pains: ["投放 ROI 下滑"],
        free_text_label: "还有哪些市场与客户侧资料需要补充？",
      },
    ],
  })),
  saveSessionDraft: vi.fn(async () => {}),
  viewSessionFile: vi.fn(async () => {}),
  getSessionFileBlob: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
  downloadSessionFile: vi.fn(async () => {}),
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
        preview_text: "目标客群：加盟创业者和三四线餐饮门店老板。",
        extracted_highlights: [
          { label: "目标客群", value: "加盟创业者和三四线餐饮门店老板是核心沟通对象。" },
          { label: "渠道结构", value: "当前重点依赖短视频获客、招商页承接和线索回访。" },
        ],
      },
    ],
  })),
  addArchiveModule: vi.fn(async (_projectId: string, body: { module: string; label?: string }) => ({
    ...baseProjectDetail.archive,
    modules: [
      ...baseProjectDetail.archive.modules,
      { module: body.module, label: body.label ?? body.module, has_data: false, facts: [] },
    ],
    recommended_modules: baseProjectDetail.archive.recommended_modules?.filter((item) => item.module !== body.module) ?? [],
    hidden_modules: baseProjectDetail.archive.hidden_modules?.filter((item) => item.module !== body.module) ?? [],
  })),
  hideArchiveModule: vi.fn(async (_projectId: string, module: string) => ({
    ...baseProjectDetail.archive,
    modules: baseProjectDetail.archive.modules.filter((item) => item.module !== module),
    hidden_modules: [
      ...(baseProjectDetail.archive.hidden_modules ?? []),
      {
        module,
        label: baseProjectDetail.archive.modules.find((item) => item.module === module)?.label ?? module,
        reason: "已隐藏，可随时恢复。",
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

const testStorage = new Map<string, string>();

beforeEach(() => {
  testStorage.clear();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:preview-image"),
    revokeObjectURL: vi.fn(),
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => testStorage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        testStorage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        testStorage.delete(key);
      }),
      clear: vi.fn(() => {
        testStorage.clear();
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  try {
    window.localStorage?.removeItem?.("ruice:pinned-projects");
    window.localStorage?.removeItem?.("ruice:inline-diagnosis:proj-1");
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
    expect(screen.getByRole("button", { name: /项目档案/ })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "更换项目 Logo" }).textContent).toBe("星");
    expect(screen.queryByText("返回工作台")).toBeNull();
    expect(screen.queryByRole("button", { name: "返回项目组合" })).toBeNull();
    expect(screen.queryByText("当前状态")).toBeNull();
    expect(screen.queryByText("推进路径")).toBeNull();
    expect(screen.queryByText("下一步")).toBeNull();
    expect(screen.queryByText("证据分析报告")).toBeNull();
    expect(screen.queryByText("查看交付")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /项目档案/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据板块" })).toBeTruthy());
    expect(screen.getAllByText("项目档案").length).toBeGreaterThan(0);
    expect(screen.getAllByText("直播电商").length).toBeGreaterThan(0);
    const completeness = screen.getByLabelText(/档案完整度/).getAttribute("aria-label") ?? "";
    expect(Number(completeness.match(/\d+/)?.[0] ?? 100)).toBeLessThan(100);
    expect(screen.queryByRole("button", { name: /项目概况/ })).toBeNull();
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
    expect(screen.getByText("本次沉淀")).toBeTruthy();
    expect(screen.getByText("后续动作")).toBeTruthy();
    expect(screen.getByText(/核心判断：获客成本过高但没有被拆到渠道/)).toBeTruthy();
    expect(screen.getByText(/先补齐近 30 天渠道花费/)).toBeTruthy();
    expect(screen.getByText("作战目标：把 CAC 降下来")).toBeTruthy();
    expect(screen.getByText("主战场：市场与客户")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /新对话/ }));
    fireEvent.click(within(screen.getByLabelText("对话模式")).getByRole("button", { name: "头脑风暴" }));
    await waitFor(() => expect(screen.getAllByText("头脑风暴").length).toBeGreaterThan(0));
    expect(screen.getByText("来来，我们碰撞一下！")).toBeTruthy();
    expect(screen.queryByText("把这个项目里的新想法、假设或经营动作丢给我，我会帮你做推演。")).toBeNull();
    expect(screen.getByPlaceholderText("输入消息...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开问题地图" })).toBeNull();
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

    await waitFor(() => expect(screen.getAllByText("项目档案").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /^数据板块/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据板块" })).toBeTruthy());
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

  it("locks the mode switch after restoring an AI consulting conversation", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByText("获客成本过高"));

    expect(await screen.findByText("你好，我是你的诊断顾问。")).toBeTruthy();
    const modeTabs = screen.getByLabelText("对话模式");
    expect(within(modeTabs).getByText("AI咨询")).toBeTruthy();
    expect(within(modeTabs).queryByRole("button", { name: "头脑风暴" })).toBeNull();
    expect(within(modeTabs).queryByText("头脑风暴")).toBeNull();
  });

  it("opens a true new conversation instead of restoring the previous session", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const historyRegion = await screen.findByRole("region", { name: "项目记录" });
    fireEvent.click(within(historyRegion).getAllByRole("button", { name: /获客成本过高/ })[0]);
    expect(await screen.findByText("你好，我是你的诊断顾问。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /新对话/ }));

    await waitFor(() => expect(screen.getByText("今天，你想解决什么？")).toBeTruthy());
    expect(screen.queryByText("你好，我是你的诊断顾问。")).toBeNull();
  });

  it("adds the current chat to the sidebar conversation history as soon as it starts", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText("输入消息...");
    fireEvent.change(input, { target: { value: "我想测试当前对话记录是否出现" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByRole("tab", { name: "对话记录 2" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "项目记录" })).getByText("我想测试当前对话记录是否出现")).toBeTruthy();
  });

  it("requires data collection before starting deep diagnosis from the confirmed problem map", async () => {
    vi.mocked(sessionChat).mockResolvedValueOnce({
      message: "我已经整理出问题地图，请确认是否开始诊断。",
      done: false,
      phase: "confirm",
      summary: null,
      problem_map: {
        company_name: "星麦直播",
        industry: "直播电商",
        main_business: "直播带货",
        business_model: "投流获客后直播转化",
        scale: "",
        stage: "",
        core_problem: "获客成本过高",
        sub_problems: ["投放 ROI 下滑"],
        goal: "降低获客成本",
        constraints: "预算不能继续翻倍",
        success_criteria: "ROI 回到 1.5 以上",
        impact: "近半年预算翻倍但 ROI 下降",
        context: "直播电商项目",
        suspected_cause: "",
        tried: "",
        data_readiness: "有投放后台数据",
        diagnosis_focus: "market",
        information_score: 82,
        missing_fields: [],
        next_question_reason: "",
      },
    });

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/war-room" element={<span>作战室页面</span>} />
        </Routes>
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText("输入消息...");
    fireEvent.change(input, { target: { value: "获客成本过高，ROI 下滑。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "确认问题地图并开始诊断" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "确认问题地图并开始诊断" }));

    expect(await screen.findByText("诊断方案已定制完成，请先补充关键数据。")).toBeTruthy();
    expect(screen.getByText("补充数据")).toBeTruthy();
    expect(createDiagnosisJob).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("还有要补充或纠正的吗？直接说…")).toBeTruthy();
    expect(screen.queryByLabelText("诊断流程")).toBeNull();

    fireEvent.click(screen.getByText("补充数据"));
    expect(await screen.findByRole("heading", { name: "市场与客户" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("近 30 天渠道花费"), {
      target: { value: "抖音 8 万，小红书 2 万" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始诊断" }));

    await waitFor(() => expect(createDiagnosisJob).toHaveBeenCalledTimes(1));
    expect(createDiagnosisJob).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          module: "market",
          facts: expect.objectContaining({ channel_cost: "抖音 8 万，小红书 2 万" }),
        }),
      ],
      "sess-new",
      "proj-1",
      expect.objectContaining({ core_problem: "获客成本过高" })
    );
    expect(screen.getByLabelText("诊断流程")).toBeTruthy();
    expect(getDiagnosisJob).not.toHaveBeenCalled();
  });

  it("restores pending review progress inside data collection instead of opening the war room", async () => {
    window.localStorage.setItem("ruice:inline-diagnosis:proj-1", JSON.stringify({
      sessionId: "sess-new",
      jobId: "job-1",
    }));
    vi.mocked(getSessionDetail).mockImplementation(async () => ({
      id: "sess-new",
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
      title: "GGOO 获客效率不稳定",
      status: "filling",
      messages: [
        { role: "user", content: "GGOO 获客效率不稳定，需要诊断。" },
      ],
      problem_map: null,
      diagnosis_record_id: null,
      draft_json: JSON.stringify({
        activeModules: [
          {
            key: "market",
            label: "市场与客户",
            subtitle: "先补齐渠道、投放和转化数据，再进入深度尽调。",
            fields: [
              {
                key: "channel_cost",
                label: "近 30 天渠道花费",
                placeholder: "例如：抖音 8 万，小红书 2 万。",
                hint: "用于判断获客成本上升来自渠道价格、素材效率还是承接转化。",
                accept_file: true,
              },
            ],
            pains: ["投放 ROI 下滑"],
            free_text_label: "还有哪些市场与客户侧资料需要补充？",
          },
        ],
        current: 0,
        facts: { market: { channel_cost: "搜索广告 5 万，内容投放 3 万" } },
        pains: {},
        freeText: {},
        fileNames: {},
        chatSummary: null,
        problemMap: null,
      }),
    }));

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
          <Route path="/projects/:id/war-room" element={<span>作战室页面</span>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("location").textContent).toBe("/projects/proj-1");
    expect(screen.queryByText("作战室页面")).toBeNull();
    expect(await screen.findByRole("heading", { name: "市场与客户" })).toBeTruthy();
    expect(screen.getByDisplayValue("搜索广告 5 万，内容投放 3 万")).toBeTruthy();
  });

  it("restores the session-bound diagnosis planning task after remount", async () => {
    window.localStorage.setItem("ruice:inline-diagnosis:proj-1", JSON.stringify({
      sessionId: "sess-new",
      jobId: "job-1",
    }));

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(getDiagnosisJob).toHaveBeenCalledWith("job-1"));
    expect(await screen.findByText("资料与证据已整理完成，顾问正在深度判断中。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看进度" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新诊断" })).toBeTruthy();
    const toolbar = document.querySelector(".chat-input-toolbar");
    expect(toolbar?.textContent).toContain("AI咨询");
    expect(toolbar?.textContent).toContain("资料与证据已整理完成，顾问正在深度判断中。");
    expect(screen.getByPlaceholderText("输入消息...")).toBeTruthy();
  });

  it("blocks re-diagnosis when the problem map has not changed", async () => {
    const diagnosedProblemMap = {
      company_name: "星麦直播",
      industry: "直播电商",
      main_business: "直播带货",
      business_model: "投流获客后直播转化",
      scale: "",
      stage: "",
      core_problem: "获客成本过高",
      sub_problems: ["投放 ROI 下滑"],
      goal: "降低获客成本",
      constraints: "预算不能继续翻倍",
      success_criteria: "ROI 回到 1.5 以上",
      impact: "近半年预算翻倍但 ROI 下降",
      context: "直播电商项目",
      suspected_cause: "",
      tried: "",
      data_readiness: "有投放后台数据",
      diagnosis_focus: "market",
      information_score: 82,
      missing_fields: [],
      next_question_reason: "",
    };
    window.localStorage.setItem("ruice:inline-diagnosis:proj-1", JSON.stringify({
      sessionId: "sess-1",
      jobId: "job-1",
      problemMapSignature: JSON.stringify(Object.keys(diagnosedProblemMap).sort().reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = diagnosedProblemMap[key as keyof typeof diagnosedProblemMap];
        return acc;
      }, {})),
    }));
    vi.mocked(getSessionDetail).mockResolvedValueOnce({
      id: "sess-1",
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
      title: "获客成本过高",
      status: "filling",
      messages: [{ role: "user", content: "获客成本过高" }],
      problem_map: diagnosedProblemMap,
      diagnosis_record_id: null,
      draft_json: null,
    });

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("资料与证据已整理完成，顾问正在深度判断中。");
    fireEvent.click(screen.getByRole("button", { name: "重新诊断" }));
    expect(await screen.findByText("问题地图未更新，无需重新诊断。")).toBeTruthy();
    expect(createDiagnosisJob).not.toHaveBeenCalled();
  });

  it("keeps the problem map visible while the diagnosis plan keeps progressing", async () => {
    vi.mocked(sessionChat).mockResolvedValueOnce({
      message: "问题地图已成型，我会在后台继续推进诊断方案。",
      done: true,
      phase: "done",
      summary: null,
      problem_map: {
        company_name: "星麦直播",
        industry: "直播电商",
        main_business: "直播带货",
        business_model: "投流获客后直播转化",
        scale: "",
        stage: "",
        core_problem: "获客成本翻倍",
        sub_problems: ["投放 ROI 下滑"],
        goal: "降低获客成本",
        constraints: "预算不能继续翻倍",
        success_criteria: "ROI 回到 1.5 以上",
        impact: "近半年预算翻倍但 ROI 下降",
        context: "直播电商项目",
        suspected_cause: "",
        tried: "",
        data_readiness: "有投放后台数据",
        diagnosis_focus: "market",
        information_score: 88,
        missing_fields: [],
        next_question_reason: "",
      },
    });

    render(
      <MemoryRouter initialEntries={["/projects/proj-1"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText("输入消息...");
    fireEvent.change(input, { target: { value: "获客成本越来越高" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("诊断方案已定制完成，请先补充关键数据。")).toBeTruthy();
    expect(createDiagnosisJob).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "确认问题地图并开始诊断" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开问题地图" }));
    expect(await screen.findByRole("dialog", { name: "问题地图" })).toBeTruthy();
    expect(screen.getByText("获客成本翻倍")).toBeTruthy();
    expect(screen.queryByLabelText("诊断流程")).toBeNull();
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

    await waitFor(() => screen.getByRole("button", { name: /^数据板块/ }));
    fireEvent.click(screen.getByRole("button", { name: /^数据板块/ }));
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

  it("enables a recommended business domain from the archive", async () => {
    const addArchiveModuleMock = vi.mocked(addArchiveModule);
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByLabelText("建议新增数据板块")).toBeTruthy());
    fireEvent.click(within(screen.getByLabelText("建议新增数据板块")).getByRole("button", { name: "法务合规" }));

    await waitFor(() =>
      expect(addArchiveModuleMock).toHaveBeenCalledWith("proj-1", {
        module: "legal_compliance",
        label: "法务合规",
      })
    );
    await waitFor(() => expect(screen.getAllByText("法务合规").length).toBeGreaterThan(0));
    expect(screen.getByText("这个领域还没有形成可复用的项目档案。")).toBeTruthy();
  });

  it("creates a custom data module from the archive suggestions", async () => {
    const addArchiveModuleMock = vi.mocked(addArchiveModule);
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const suggestions = await screen.findByLabelText("建议新增数据板块");
    fireEvent.click(within(suggestions).getByRole("button", { name: "自定义" }));
    const customForm = await screen.findByLabelText("自定义数据板块");
    fireEvent.change(within(customForm).getByPlaceholderText("例如：区域渠道、售后服务、生产制造"), {
      target: { value: "售后服务" },
    });
    fireEvent.click(within(customForm).getByRole("button", { name: "创建板块" }));

    await waitFor(() =>
      expect(addArchiveModuleMock).toHaveBeenCalledWith("proj-1", {
        module: expect.stringMatching(/^custom_/),
        label: "售后服务",
      })
    );
  });

  it("lets users customize the project logo image locally", async () => {
    const originalFileReader = window.FileReader;
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      readAsDataURL() {
        this.result = "data:image/png;base64,ZmFrZS1sb2dv";
        this.onload?.();
      }
    }
    Object.defineProperty(window, "FileReader", {
      configurable: true,
      value: MockFileReader,
    });

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const logoButton = await screen.findByRole("button", { name: "更换项目 Logo" });
    expect(logoButton.textContent).toBe("星");
    const input = document.querySelector<HTMLInputElement>(".project-workspace-logo-input");
    expect(input).toBeTruthy();
    const file = new File(["fake"], "logo.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    expect(window.localStorage.getItem("ruice:project-logo:proj-1")).toBe("data:image/png;base64,ZmFrZS1sb2dv");
    expect(logoButton.querySelector("img")).toBeTruthy();

    Object.defineProperty(window, "FileReader", {
      configurable: true,
      value: originalFileReader,
    });
  });

  it("collapses the project sidebar into an icon rail and persists the state", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    const collapseButton = await screen.findByRole("button", { name: "收起侧栏" });
    fireEvent.click(collapseButton);

    const sidebar = screen.getByLabelText("星麦直播 项目导航");
    expect(sidebar.className).toContain("is-collapsed");
    expect(window.localStorage.getItem("ruice:project-sidebar-collapsed")).toBe("1");
    expect(within(sidebar).queryByText("对话记录")).toBeNull();
    expect(within(sidebar).queryByText("风暴记录")).toBeNull();
    expect(within(sidebar).queryByText("项目档案")).toBeNull();
    expect(screen.getByRole("button", { name: "展开侧栏" })).toBeTruthy();
  });

  it("hides an enabled archive domain without deleting archive data", async () => {
    const hideArchiveModuleMock = vi.mocked(hideArchiveModule);
    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /产品与服务/ })).toBeTruthy());
    const productDomain = screen.getByRole("button", { name: /产品与服务/ }).closest(".project-archive-domain-chip");
    expect(productDomain).toBeTruthy();
    fireEvent.click(within(productDomain as HTMLElement).getByRole("button", { name: "隐藏此数据板块" }));

    await waitFor(() => expect(hideArchiveModuleMock).toHaveBeenCalledWith("proj-1", "product"));
    const hiddenDomains = await screen.findByLabelText("已隐藏数据板块");
    expect(within(hiddenDomains).getByRole("button", { name: "产品与服务" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /产品与服务.*数据/ })).toBeNull();
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
        preview_text: "这是一份渠道调研纪要的预览摘要。",
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

    await waitFor(() => expect(screen.getByRole("heading", { name: "数据板块" })).toBeTruthy());
    expect(screen.getByText("渠道调研纪要.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "提炼入档" }));
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
        preview_text: "这是一份渠道调研纪要的预览摘要。",
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
    fireEvent.click(screen.getByRole("button", { name: /渠道调研纪要\.pdf 更多选项/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));

    await waitFor(() => expect(deleteSessionFileMock).toHaveBeenCalledWith("file-1"));
    await waitFor(() => expect(screen.queryByText("渠道调研纪要.pdf")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /^数据板块/ }));
    fireEvent.click(screen.getByRole("button", { name: /展开其余/ }));
    await waitFor(() => expect(screen.getByText("目标客群")).toBeTruthy());
    expect(screen.getByText("加盟创业者和三四线餐饮门店老板是核心沟通对象。")).toBeTruthy();
  });

  it("opens archive preview from the file name and downloads from the more menu", async () => {
    const projectWithFile = structuredClone(baseProjectDetail);
    projectWithFile.archive.files = [
      {
        id: "file-1",
        name: "渠道调研纪要.pdf",
        module: "market",
        field: "archive_upload",
        uploaded_at: "2026-06-02T00:00:00Z",
        extraction_status: "none",
        preview_text: "这是一份渠道调研纪要的预览摘要。",
        extracted_highlights: [],
      },
    ];
    vi.mocked(getProject).mockResolvedValue(projectWithFile);

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "预览资料：渠道调研纪要.pdf" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "预览资料：渠道调研纪要.pdf" }));
    expect(await screen.findByRole("dialog", { name: "资料在线预览" })).toBeTruthy();
    expect(screen.getByText("这是一份渠道调研纪要的预览摘要。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /渠道调研纪要\.pdf 更多选项/ }));
    expect(screen.queryByRole("menuitem", { name: "在线观看" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开原文件" }));
    await waitFor(() => expect(viewSessionFile).toHaveBeenCalledWith("file-1", "渠道调研纪要.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "下载原件" }));
    await waitFor(() => expect(downloadSessionFile).toHaveBeenCalledWith("file-1", "渠道调研纪要.pdf"));
  });

  it("previews image archive files as images instead of OCR text", async () => {
    const projectWithImage = structuredClone(baseProjectDetail);
    projectWithImage.archive.files = [
      {
        id: "image-1",
        name: "截图 2026-06-23 14.48.33.png",
        module: "market",
        field: "archive_upload",
        uploaded_at: "2026-06-02T00:00:00Z",
        content_type: "image",
        media_type: "image/png",
        extraction_status: "none",
        preview_text: "这段 OCR 文本不应该作为图片在线预览展示。",
        extracted_highlights: [],
      },
    ];
    vi.mocked(getProject).mockResolvedValue(projectWithImage);

    render(
      <MemoryRouter initialEntries={["/projects/proj-1?page=archive&section=modules"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "预览资料：截图 2026-06-23 14.48.33.png" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "预览资料：截图 2026-06-23 14.48.33.png" }));

    await waitFor(() => expect(getSessionFileBlob).toHaveBeenCalledWith("image-1"));
    const image = await screen.findByRole("img", { name: "截图 2026-06-23 14.48.33.png" });
    expect(image).toBeTruthy();
    expect(screen.queryByText("这段 OCR 文本不应该作为图片在线预览展示。")).toBeNull();
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
