import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import App from "../src/App";
import {
  createDataSupplementRequest,
  deleteDataSupplementFile,
  downloadSessionFile,
  getPublicDataSupplementRequest,
  getProjectWarRoom,
  listDataSupplementRequests,
  submitPublicDataSupplement,
  viewSessionFile,
} from "../src/api/client";
import { ProjectWarRoomPage } from "../src/components/Project/ProjectWarRoomPage";
import type { WarRoomPlan } from "../src/types";

const warRoomPlan: WarRoomPlan = {
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
  data_gaps: [
    {
      key: "crm_conversion",
      label: "CRM 阶段转化率",
      reason: "验证线索在哪个阶段流失",
      source_hint: "CRM",
      required: true,
      typical_owner: "销售负责人",
    },
  ],
  checkpoints: [],
};

vi.mock("../src/api/client", () => {
  let publicSupplementRequest = {
    id: "supp-public",
    token: "token-1",
    project_id: "proj-1",
    created_at: "2026-06-23T00:00:00Z",
    updated_at: "2026-06-23T00:00:00Z",
    war_room_plan_id: "wr-1",
    data_key: "crm_conversion",
    label: "CRM 阶段转化率",
    reason: "验证线索在哪个阶段流失",
    source_hint: "CRM",
    typical_owner: "销售负责人",
    status: "open",
    public_url: "/supplement/token-1",
    submissions: [
      {
        id: "sub-old",
        created_at: "2026-06-22T10:00:00Z",
        submitter_name: "销售负责人",
        note: "先补充上周数据。",
        files: [{
          id: "file-old",
          original_name: "上周CRM.csv",
          summary_text: "",
          is_deleted: false,
          preview_text: "上周 CRM 转化率说明。",
          preview_blocks: [{ type: "paragraph" as const, text: "上周 CRM 转化率说明。" }],
        }],
      },
    ],
  };
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
  listWarRoomFeedback: vi.fn(async () => []),
  submitWarRoomFeedback: vi.fn(async (projectId: string, body: any) => ({
    id: "fb-1",
    project_id: projectId,
    created_at: "2026-06-23T00:00:00Z",
    ...body,
    note: body.note ?? "",
    owner: body.owner ?? "",
    attachments: body.attachments ?? [],
  })),
  listDataSupplementRequests: vi.fn(async () => []),
  createDataSupplementRequest: vi.fn(async (_projectId: string, warRoomPlanId: string, dataRequest: any) => ({
    id: "supp-1",
    token: "token-1",
    project_id: "proj-1",
    created_at: "2026-06-23T00:00:00Z",
    updated_at: "2026-06-23T00:00:00Z",
    war_room_plan_id: warRoomPlanId,
    data_key: dataRequest.key,
    label: dataRequest.label,
    reason: dataRequest.reason,
    source_hint: dataRequest.source_hint,
    typical_owner: dataRequest.typical_owner,
    status: "open",
    public_url: "/supplement/token-1",
    submissions: [],
  })),
  getPublicDataSupplementRequest: vi.fn(async () => publicSupplementRequest),
  submitPublicDataSupplement: vi.fn(async (_token: string, body: any) => {
    const submission = {
      id: "sub-new",
      created_at: "2026-06-23T12:00:00Z",
      submitter_name: body.submitterName ?? "",
      note: body.note ?? "",
    files: (body.files ?? []).map((file: File, index: number) => ({
        id: `file-new-${index}`,
        original_name: file.name,
        summary_text: "",
        is_deleted: false,
        preview_text: "",
        preview_blocks: [],
      })),
    };
    publicSupplementRequest = {
      ...publicSupplementRequest,
      submissions: [submission, ...publicSupplementRequest.submissions],
    };
    return submission;
  }),
  deleteDataSupplementFile: vi.fn(async (_projectId: string, requestId: string, submissionId: string, fileId: string) => {
    publicSupplementRequest = {
      ...publicSupplementRequest,
      submissions: publicSupplementRequest.submissions.map((submission) => (
        submission.id === submissionId
          ? {
              ...submission,
              files: submission.files.map((file) => (
                file.id === fileId ? { ...file, is_deleted: true } : file
              )),
            }
          : submission
      )),
    };
    return publicSupplementRequest;
  }),
  viewSessionFile: vi.fn(async () => {}),
  downloadSessionFile: vi.fn(async () => {}),
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
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
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

    await waitFor(() => screen.getByText("项目总览"));
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

    await waitFor(() => screen.getByText("项目总览"));
    fireEvent.click(screen.getByText("查看全部建议"));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj-1/war-room/view/recommendations?recommendation=action%3Asales-action-1"
      )
    );
    expect(screen.getByText("问题是什么？")).toBeTruthy();
    expect(screen.getByText("行动建议")).toBeTruthy();
    expect(screen.getAllByText("线索响应提速").length).toBeGreaterThan(0);
    expect(screen.getByText(/重分线索池/)).toBeTruthy();
  });

  it("turns verbose recommendation actions into short navigation titles", async () => {
    const verbosePlan: WarRoomPlan = {
      ...warRoomPlan,
      department_actions: [
        {
          ...warRoomPlan.department_actions[0],
          id: "market-action-1",
          department: "market",
          department_label: "市场与客户",
          battle_goal: "推广账号和近 30/90 天投放报表缺失，无法判断真实获客成本。",
          action_title: "连接或上传真实推广账号与近30/90天投放报表",
          action_detail: "先接入投放后台和渠道消耗，再判断是否加码。",
        },
        {
          ...warRoomPlan.department_actions[0],
          id: "sales-action-2",
          battle_goal: "销售漏斗各环节数据缺失，线索到成交无法闭环。",
          action_title: "补销售漏斗：上传近30/90天线索→咨询→报价→成交各环节人数与转化率",
          action_detail: "用销售漏斗定位最先流失的环节。",
        },
        {
          ...warRoomPlan.department_actions[0],
          id: "legal-action-1",
          department: "legal_compliance",
          department_label: "法务合规",
          battle_goal: "招商放量前缺合规闸门，可能放大合同和宣传风险。",
          action_title: "招商放量前做合规闸门：核验已完成商业特许经营备案、电火灶产品3C/能效证明与招商宣传口径",
          action_detail: "先核验备案、资质和宣传口径，再决定是否放量招商。",
        },
      ],
    };
    vi.mocked(getProjectWarRoom).mockResolvedValueOnce(verbosePlan);

    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room/view/recommendations"]}>
        <Routes>
          <Route path="/projects/:projectId/war-room/view/:section" element={<ProjectWarRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getAllByText("投放数据接入").length).toBeGreaterThan(0));
    expect(screen.getAllByText("销售漏斗复核").length).toBeGreaterThan(0);
    expect(screen.getAllByText("招商合规闸门").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("高优先级").textContent).toContain("3");
    expect(screen.getByLabelText("中优先级").textContent).toContain("0");
    expect(screen.getByLabelText("低优先级").textContent).toContain("0");
    const tabs = document.querySelectorAll(".consulting-recommendation-tab");
    expect(Array.from(tabs).some((tab) => tab.textContent?.includes("连接或上传真实推广账号"))).toBe(false);
    expect(Array.from(tabs).every((tab) => !tab.textContent?.includes("优先级"))).toBe(true);
    expect(Array.from(tabs).every((tab) => !tab.textContent?.includes("数据待补"))).toBe(true);
    expect(screen.getByText(/连接或上传真实推广账号与近30\/90天投放报表/)).toBeTruthy();
  });

  it("copies a public supplement link from the data page", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room/view/recommendations?recommendation=action%3Asales-action-1"]}>
        <Routes>
          <Route path="/projects/:projectId/war-room/view/:section" element={<ProjectWarRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("CRM 阶段转化率")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制补资料链接" }));

    await waitFor(() => expect(createDataSupplementRequest).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("请打开这个链接上传文件或填写说明：http://localhost:3000/supplement/token-1"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("这个链接不需要登录，可以多次补充，历史提交会保留。"));
    expect(await screen.findByText("已复制链接")).toBeTruthy();
  });

  it("shows supplement files as actionable rows and keeps deletion trace", async () => {
    const ownerRequest = {
      id: "supp-owner",
      token: "token-1",
      project_id: "proj-1",
      created_at: "2026-06-23T00:00:00Z",
      updated_at: "2026-06-23T00:00:00Z",
      war_room_plan_id: "wr-1",
      data_key: "crm_conversion",
      label: "CRM 阶段转化率",
      reason: "验证线索在哪个阶段流失",
      source_hint: "CRM",
      typical_owner: "销售负责人",
      status: "open",
      public_url: "/supplement/token-1",
      submissions: [
        {
          id: "sub-owner",
          created_at: "2026-06-22T10:00:00Z",
          submitter_name: "gavin2",
          note: "这个也是gavin提交的，测试",
          files: [{
            id: "file-owner",
            original_name: "上周CRM.csv",
            summary_text: "",
            is_deleted: false,
            preview_text: "这是 CRM 文件的在线预览内容。",
            preview_blocks: [{ type: "paragraph" as const, text: "这是 CRM 文件的在线预览内容。" }],
          }],
        },
      ],
    };
    vi.mocked(listDataSupplementRequests).mockResolvedValueOnce([ownerRequest]);
    vi.mocked(deleteDataSupplementFile).mockResolvedValueOnce({
      ...ownerRequest,
      submissions: [
        {
          ...ownerRequest.submissions[0],
          files: [{ ...ownerRequest.submissions[0].files[0], is_deleted: true }],
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/projects/proj-1/war-room/view/recommendations?recommendation=action%3Asales-action-1"]}>
        <Routes>
          <Route path="/projects/:projectId/war-room/view/:section" element={<ProjectWarRoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("已提交 1 次")).toBeTruthy();
    expect(screen.queryByText(/1 个文件：上周CRM.csv/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "上周CRM.csv" }));
    expect(await screen.findByRole("dialog", { name: "资料在线预览" })).toBeTruthy();
    expect(screen.getByText("这是 CRM 文件的在线预览内容。")).toBeTruthy();
    expect(viewSessionFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开原文件" }));
    await waitFor(() => expect(viewSessionFile).toHaveBeenCalledWith("file-owner", "上周CRM.csv"));
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
    expect(screen.getByRole("button", { name: "下载" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载原件" }));
    await waitFor(() => expect(downloadSessionFile).toHaveBeenCalledWith("file-owner", "上周CRM.csv"));

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteDataSupplementFile).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "已删除" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "上周CRM.csv" }).closest(".data-needs-card__file")?.className).toContain("is-deleted");
  });

  it("lets an external owner submit files and see previous supplement history without login", async () => {
    render(
      <MemoryRouter initialEntries={["/supplement/token-1"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "CRM 阶段转化率" })).toBeTruthy();
    expect(screen.getByText("通常由 销售负责人 提供")).toBeTruthy();
    expect(screen.getByText("先补充上周数据。")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/你的姓名/), { target: { value: "销售负责人" } });
    fireEvent.change(screen.getByLabelText(/补充说明/), { target: { value: "补充近 30 天完整 CRM 导出。" } });
    fireEvent.change(screen.getByLabelText(/选择文件/), {
      target: {
        files: [new File(["stage,rate\nMQL,0.2"], "CRM完整导出.csv", { type: "text/csv" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交资料" }));

    await waitFor(() => expect(submitPublicDataSupplement).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getPublicDataSupplementRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("已提交，项目负责人可以在作战室里看到这次补充。")).toBeTruthy();
    expect(screen.getByText("补充近 30 天完整 CRM 导出。")).toBeTruthy();
    expect(screen.getByText("CRM完整导出.csv")).toBeTruthy();
    expect(screen.getByText("上周CRM.csv")).toBeTruthy();
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
