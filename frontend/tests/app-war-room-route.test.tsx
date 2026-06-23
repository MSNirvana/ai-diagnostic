import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import App from "../src/App";
import { ProjectWarRoomPage } from "../src/components/Project/ProjectWarRoomPage";

const warRoomPlan = {
  id: "wr-1",
  record_id: "rec-1",
  project_id: "proj-1",
  summary: "未来 30 天优先打销售承接战。",
  primary_battlefield: "sales",
  secondary_battlefield: "market",
  objective: "提升高质量线索成交率",
  confidence: 0.8,
  decision_items: [],
  battle_chain: [],
  department_actions: [
    {
      id: "sales-action-1",
      department: "sales",
      department_label: "销售与增长",
      battle_goal: "高意向线索响应过慢",
      priority: "now",
      action_title: "重分线索池",
      action_detail: "A 类线索 10 分钟内首响",
      owner_role: "销售负责人",
      start_window: "本周启动",
      acceptance_rule: "两周后复盘首响时长。",
      required_data: [],
      metrics: [
        {
          name: "高质量线索成交率",
          target: "30 天内改善",
          direction: "up",
        },
      ],
      confidence: 0.8,
      evidence_refs: [],
    },
  ],
  priority_board: { now: [], soon: [], later: [] },
  evidence_summary: [],
  risk_summary: [],
  data_gaps: [],
  checkpoints: [],
};

vi.mock("../src/api/client", () => {
  const rejectedRecord = {
    id: "rec-rejected",
    created_at: "2026-06-13T00:00:00Z",
    answers: {
      problem_map: {
        company_name: "华火新能源",
        industry: "新能源厨电",
        main_business: "电火灶招商加盟",
        core_problem: "招商获客成本高，合规证据不足",
      },
      answers: [
        {
          module: "market",
          facts: { "推广渠道": "抖音、小红书" },
          pains: ["招商获客成本高"],
        },
      ],
    },
    results: [
      {
        module: "market",
        signal: "red",
        conclusion: "缺少推广账号和渠道转化数据。",
        evidence: [],
        actions: ["补充推广账号和线索转化数据"],
        drilldown: null,
        evidence_package: null,
        data_requests: [
          {
            key: "ad_account",
            label: "推广账号后台截图或导出数据",
            reason: "需要核验真实获客成本。",
            source_hint: "抖音/小红书/百度投放后台",
            required: true,
          },
        ],
      },
    ],
    war_room_plan: null,
    profile: null,
    review_status: "rejected",
    consultant_notes: ["证据包混入无关来源，请补充真实推广账号、渠道消耗和线索转化数据。"],
  };
  return ({
  listProjects: vi.fn(async () => [
    {
      id: "proj-1",
      name: "待审核项目",
      created_at: "2026-06-13T00:00:00Z",
      updated_at: "2026-06-13T00:00:00Z",
      status: "active",
      memory_summary: "",
    },
  ]),
  patchProject: vi.fn(async (projectId: string, body: { status?: string }) => ({
    id: projectId,
    name: "待审核项目",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-14T00:00:00Z",
    status: body.status ?? "active",
    memory_summary: "",
  })),
  getProjectWarRoom: vi.fn(async (projectId: string) => {
    if (projectId === "proj-empty") {
      throw new Error("获取项目作战室失败: 404");
    }
    if (projectId === "proj-pending") {
      throw new Error("获取项目作战室失败: 403");
    }
    if (projectId === "proj-rejected") {
      throw new Error("获取项目作战室失败: 409");
    }
    return warRoomPlan;
  }),
  getProjectEvidence: vi.fn(async () => []),
  fetchRecord: vi.fn(async (recordId: string) => (
    recordId === "rec-rejected"
      ? rejectedRecord
      : {
          id: "rec-1",
          created_at: "2026-06-13T00:00:00Z",
          answers: { answers: [] },
          results: [],
          war_room_plan: warRoomPlan,
          profile: null,
        }
  )),
  createDiagnosisJob: vi.fn(async () => ({ job_id: "job-1", status: "queued" })),
  runDiagnose: vi.fn(async () => ({
    results: [],
    record_id: "rec-1",
    skill_version_ids: {},
    triage: {
      primary_module: "sales",
      selected_experts: [],
      conflicts: [],
      dependencies: [],
      priority_actions: [],
    },
    war_room_plan: warRoomPlan,
    review_status: "pending_review",
  })),
  runDiagnoseWithFiles: vi.fn(),
  sendBrainstormMessage: vi.fn(async () => ({ message: "我们先拆核心假设。" })),
  getProject: vi.fn(async (projectId: string) => ({
    ...(projectId === "proj-empty" ? {
    id: "proj-empty",
    name: "未诊断项目",
    created_at: "2026-06-23T00:00:00Z",
    updated_at: "2026-06-23T00:00:00Z",
    status: "active",
    memory_summary: "",
    memory_entries: [],
    sessions: [],
    records: [],
    archive: {
      profile: [],
      modules: [
        { module: "market", label: "市场与客户", facts: [], has_data: false },
        { module: "product", label: "产品与服务", facts: [], has_data: false },
        { module: "sales", label: "销售与增长", facts: [], has_data: false },
        { module: "ops", label: "运营与供应链", facts: [], has_data: false },
        { module: "org", label: "组织与人才", facts: [], has_data: false },
        { module: "finance", label: "财务与资本", facts: [], has_data: false },
      ],
      files: [],
      last_updated: null,
    },
    delivery_status: {
      state: "empty",
      approved_count: 0,
      pending_review_count: 0,
      rejected_count: 0,
      latest_review_status: null,
    },
    war_room_plan: null,
  } : projectId === "proj-pending" ? {
    id: "proj-pending",
    name: "顾问审核中项目",
    created_at: "2026-06-23T00:00:00Z",
    updated_at: "2026-06-23T00:00:00Z",
    status: "active",
    memory_summary: "",
    memory_entries: [],
    sessions: [],
    records: [
      {
        id: "rec-pending",
        created_at: "2026-06-23T00:00:00Z",
        module_count: 1,
        has_war_room_plan: false,
        review_status: "pending_review",
      },
    ],
    archive: {
      profile: [],
      modules: [],
      files: [],
      last_updated: null,
    },
    delivery_status: {
      state: "pending_review",
      approved_count: 0,
      pending_review_count: 1,
      rejected_count: 0,
      latest_review_status: "pending_review",
    },
    war_room_plan: null,
  } : projectId === "proj-rejected" ? {
    id: "proj-rejected",
    name: "被打回项目",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
    status: "active",
    memory_summary: "",
    memory_entries: [],
    sessions: [],
    records: [
      {
        id: "rec-rejected",
        created_at: "2026-06-14T00:00:00Z",
        module_count: 1,
        has_war_room_plan: false,
        review_status: "rejected",
      },
    ],
    archive: {
      profile: [],
      modules: [
        { module: "market", label: "市场与客户", facts: [], has_data: false },
        { module: "product", label: "产品与服务", facts: [], has_data: false },
        { module: "sales", label: "销售与增长", facts: [], has_data: false },
        { module: "ops", label: "运营与供应链", facts: [], has_data: false },
        { module: "org", label: "组织与人才", facts: [], has_data: false },
        { module: "finance", label: "财务与资本", facts: [], has_data: false },
      ],
      files: [],
      last_updated: null,
    },
    delivery_status: {
      state: "rejected",
      approved_count: 0,
      pending_review_count: 0,
      rejected_count: 1,
      latest_review_status: "rejected",
    },
    war_room_plan: null,
  } : {
    id: "proj-1",
    name: "待审核项目",
    created_at: "2026-06-13T00:00:00Z",
    updated_at: "2026-06-13T00:00:00Z",
    status: "active",
    memory_summary: "",
    memory_entries: [],
    sessions: [],
    records: [
      {
        id: "rec-1",
        created_at: "2026-06-13T00:00:00Z",
        module_count: 1,
        has_war_room_plan: false,
        review_status: "pending_review",
      },
    ],
    archive: {
      profile: [],
      modules: [
        { module: "market", label: "市场与客户", facts: [], has_data: false },
        { module: "product", label: "产品与服务", facts: [], has_data: false },
        { module: "sales", label: "销售与增长", facts: [], has_data: false },
        { module: "ops", label: "运营与供应链", facts: [], has_data: false },
        { module: "org", label: "组织与人才", facts: [], has_data: false },
        { module: "finance", label: "财务与资本", facts: [], has_data: false },
      ],
      files: [],
      last_updated: null,
    },
    delivery_status: {
      state: "pending_review",
      approved_count: 0,
      pending_review_count: 1,
      rejected_count: 0,
      latest_review_status: "pending_review",
    },
    war_room_plan: null,
  }),
  })),
})});

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({
    token: "test-token",
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../src/components/Questionnaire/Questionnaire", () => ({
  Questionnaire: ({ onSubmit, projectId, supplementRecord }: { onSubmit: Function; projectId?: string; supplementRecord?: any }) => (
    supplementRecord ? (
      <section>
        <h2>顾问打回补充</h2>
        <p>{supplementRecord.consultant_notes?.[0]}</p>
        <p>{supplementRecord.results?.[0]?.data_requests?.[0]?.label}</p>
      </section>
    ) : (
      <button
        type="button"
        onClick={() => onSubmit([{ module: "sales", facts: {}, pains: [] }], [], undefined, projectId)}
      >
        模拟完成诊断
      </button>
    )
  ),
}));

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

describe("project diagnosis war room routing", () => {
  it("redirects legacy diagnosis URLs into the project workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/diagnose"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1"
      )
    );
    expect(await screen.findByText("模拟完成诊断")).toBeTruthy();
    expect(screen.getByText("对话记录")).toBeTruthy();
    expect(screen.queryByText("推进路径")).toBeNull();
    expect(screen.queryByText("深度尽调任务已启动")).toBeNull();
    expect(screen.queryByText(/系统正在进行外部预研、多专家诊断和证据整理/)).toBeNull();
    expect(screen.queryByText("当前状态")).toBeNull();
  });

  it("opens a fresh project conversation from the war room iteration button", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room"]}>
        <Routes>
          <Route path="/projects/:projectId/war-room" element={<ProjectWarRoomPage />} />
          <Route path="/projects/:projectId" element={<p>项目主工作区</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("本次会议先处理"));
    fireEvent.click(screen.getByRole("button", { name: "新增诊断迭代" }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1"
      )
    );
  });

  it("routes from the project war room overview into a functional section", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room"]}>
        <Routes>
          <Route path="/projects/:projectId/war-room" element={<ProjectWarRoomPage />} />
          <Route path="/projects/:projectId/war-room/view/:section" element={<ProjectWarRoomPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("本次会议先处理"));
    fireEvent.click(screen.getByText("查看拍板事项"));
    fireEvent.click(await screen.findByText("02 · 动作"));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1/war-room/view/actions"
      )
    );
    expect(screen.getByText("分配执行动作")).toBeTruthy();
    expect(screen.getByText("重分线索池")).toBeTruthy();
  });

  it("shows a friendly prompt when a project has not created its first war room", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-empty/war-room"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<p>项目主工作区</p>} />
          <Route path="/projects/:projectId/war-room" element={<ProjectWarRoomPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );

    expect(await screen.findByText("请先进行对话，完成初次咨询。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始新对话" })).toBeTruthy();
    expect(screen.queryByText(/获取项目作战室失败/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "开始新对话" }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-empty"
      )
    );
  });

  it("shows consultant review progress instead of a 403 error for pending war rooms", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-pending/war-room"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<p>项目主工作区</p>} />
          <Route path="/projects/:projectId/war-room" element={<ProjectWarRoomPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    );

    expect(await screen.findByText("顾问深度判断中")).toBeTruthy();
    expect(screen.getByText(/系统已完成资料整理、外部预研和多专家诊断/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "回到对话继续补充" })).toBeTruthy();
    expect(screen.queryByText(/获取项目作战室失败/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "回到对话继续补充" }));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-pending"
      )
    );
  });

  it("opens the brainstorm route from the main app", async () => {
    render(
      <MemoryRouter initialEntries={["/brainstorm"]}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "头脑风暴" })).toBeTruthy();
    expect(screen.getByText("逻辑自证")).toBeTruthy();
    expect(screen.queryByText("随便聊聊")).toBeNull();
  });

  it("opens rejected diagnoses in supplement mode instead of a cold-start chat", async () => {
    render(
      <MemoryRouter initialEntries={[{
        pathname: "/projects/proj-1/diagnose",
        state: { rejectedRecordId: "rec-rejected", projectId: "proj-1" },
      }]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1"
      )
    );
    expect(await screen.findByText("顾问打回补充")).toBeTruthy();
    expect(screen.getByText("证据包混入无关来源，请补充真实推广账号、渠道消耗和线索转化数据。")).toBeTruthy();
    expect(screen.getByText("推广账号后台截图或导出数据")).toBeTruthy();
    expect(screen.queryByText("先聊聊你的问题")).toBeNull();
  });

  it("carries the rejected record when supplementing from the project workspace", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj-rejected"]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: /补充资料再诊断/ }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-rejected"
      )
    );
    expect(await screen.findByText("顾问打回补充")).toBeTruthy();
    expect(screen.getByText("推广账号后台截图或导出数据")).toBeTruthy();
    expect(screen.queryByText("模拟完成诊断")).toBeNull();
  });
});
