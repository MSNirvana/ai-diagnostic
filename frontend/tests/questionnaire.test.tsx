import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Questionnaire } from "../src/components/Questionnaire/Questionnaire";
import { sessionChat, startSession, uploadSessionFile } from "../src/api/client";
import { formatChatBlocks } from "../src/components/Questionnaire/ChatStep";

const fakeModule = {
  key: "market",
  label: "市场与客户",
  subtitle: "x",
  free_text_label: "补充",
  fields: [{ key: "f1", label: "字段一", placeholder: "ph1", accept_file: false }],
  pains: ["痛点A"],
};

const fakeProblemMap = {
  company_name: "",
  industry: "直播电商",
  main_business: "带货",
  business_model: "撮合",
  scale: "85人",
  stage: "成长期",
  core_problem: "获客成本翻倍",
  sub_problems: [],
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
};

vi.mock("../src/api/client", () => ({
  startSession: vi.fn(async () => "sess-1"),
  sessionChat: vi.fn(async () => ({
    message: "我这样理解你的情况……这样对吗？",
    done: false,
    phase: "confirm",
    problem_map: fakeProblemMap,
    summary: null,
  })),
  uploadSessionFile: vi.fn(async (_sessionId: string, _moduleKey: string, _fieldKey: string, file: File) => ({
    id: "file-1",
    module_key: "conversation",
    field_key: "uploaded_context",
    original_name: file.name,
    parsed_summary: "{}",
    summary_text: `资料《${file.name}》解析摘要：表格共 2 行；字段：日期、消耗、成交。`,
  })),
  deleteSessionFile: vi.fn(async () => {}),
  getSessionDetail: vi.fn(),
  generateFromSummary: vi.fn(async () => ({
    modules: [fakeModule],
  })),
  recordPreference: vi.fn(async () => {}),
  runDiagnose: vi.fn(),
}));

// Questionnaire 现在用 useAuth 和草稿持久化，mock 掉
vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../src/utils/draft", () => ({
  loadDraft: vi.fn(() => null),
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  clearLegacyDraft: vi.fn(),
}));

describe("Questionnaire conversation flow", () => {
  it("把长段 AI 回复拆成更易读的段落和追问", () => {
    const blocks = formatChatBlocks(
      "这里我得跟你点做一个硬矛盾，否则30天会白跑：按刚才的账，每月烧5万，代理毛利约240元/台，不亏钱意味着月销要冲到约208台。所以「不亏钱」其实有两条路：一条是砍成本，另一条是维持投入。你更倾向哪一条？",
      "assistant"
    );

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[blocks.length - 1]?.kind).toBe("question");
  });

  it("对话→确认问题地图→生成动态问卷→填写→提交", async () => {
    const onSubmit = vi.fn();
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={onSubmit} />
      </MemoryRouter>
    );
    const input = screen.getByPlaceholderText(/描述|问题|输入|补充/);
    expect(startSession).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "获客成本越来越高" } });
    // 首条真实消息发送时才创建会话，避免用户只点进诊断页产生空历史。
    await waitFor(
      () => {
        fireEvent.click(screen.getByText("发送"));
        return screen.getByText("确认无误，开始诊断");
      },
      { timeout: 2000 }
    );
    expect(startSession).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("确认无误，开始诊断"));
    // 进入动态问卷
    await waitFor(() => screen.getByText("字段一"));
    fireEvent.change(screen.getByPlaceholderText("ph1"), {
      target: { value: "测试值" },
    });
    fireEvent.click(screen.getByText("痛点A"));
    fireEvent.click(screen.getByText("开始诊断"));
    expect(onSubmit).toHaveBeenCalled();
    const [answers] = onSubmit.mock.calls[0];
    expect(answers[0].facts["f1"]).toBe("测试值");
    expect(onSubmit.mock.calls[0][4]).toEqual(fakeProblemMap);
  });

  it("项目内对话把问题地图收进输入框上方浮窗", async () => {
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={vi.fn()} projectId="proj-1" variant="project-inline" />
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: /问题地图/ })).toBeTruthy();
    expect(screen.queryByText("生成中")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /问题地图/ }));
    expect(screen.getByRole("dialog", { name: "问题地图" })).toBeTruthy();
    expect(screen.getByText(/问题地图会在这里逐步成形/)).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "问题地图" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /问题地图/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    const input = screen.getByPlaceholderText("输入消息...");
    fireEvent.change(input, { target: { value: "获客成本越来越高" } });
    fireEvent.click(screen.getByLabelText("发送消息"));

    await waitFor(() => expect(screen.getByRole("button", { name: /问题地图/ })).toBeTruthy());
    expect(screen.queryByText("核心问题")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /问题地图/ }));
    expect(screen.getByRole("dialog", { name: "问题地图" })).toBeTruthy();
    expect(screen.getAllByText("92/100").length).toBeGreaterThan(0);
    expect(screen.getByText("核心问题")).toBeTruthy();
    expect(screen.getByText("获客成本翻倍")).toBeTruthy();
  });

  it("项目内新对话默认沉淀，也可以关闭后再发送", async () => {
    const startSessionMock = vi.mocked(startSession);
    const sessionChatMock = vi.mocked(sessionChat);
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={vi.fn()} projectId="proj-1" variant="project-inline" />
      </MemoryRouter>
    );

    expect(screen.queryByText("沉淀到企业档案")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更多输入选项" }));
    expect(screen.getByText("沉淀到企业档案")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("沉淀到企业档案")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更多输入选项" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /沉淀到企业档案/ }));
    expect(screen.getByText("本次不沉淀")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("输入消息..."), {
      target: { value: "这次先不沉淀" },
    });
    fireEvent.click(screen.getByLabelText("发送消息"));

    await waitFor(() => expect(startSessionMock).toHaveBeenCalledWith("proj-1", false));
    expect(sessionChatMock).toHaveBeenCalledWith("sess-1", "这次先不沉淀", false);
  });

  it("AI 回复中仍允许继续编辑下一条输入", async () => {
    vi.mocked(sessionChat).mockImplementationOnce(
      () => new Promise(() => {})
    );
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={vi.fn()} projectId="proj-1" variant="project-inline" />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText("输入消息...");
    fireEvent.change(input, { target: { value: "第一条" } });
    fireEvent.click(screen.getByLabelText("发送消息"));

    await waitFor(() => expect(screen.getByText("第一条")).toBeTruthy());
    const activeInput = screen.getByPlaceholderText("输入消息...") as HTMLTextAreaElement;
    expect(activeInput.disabled).toBe(false);
    fireEvent.change(activeInput, { target: { value: "我先补充下一句" } });
    expect(activeInput.value).toBe("我先补充下一句");
    expect((screen.getByLabelText("发送消息") as HTMLButtonElement).disabled).toBe(true);
  });

  it("项目内加号菜单可以上传资料并只展示附件卡", async () => {
    const uploadMock = vi.mocked(uploadSessionFile);
    const startSessionMock = vi.mocked(startSession);
    render(
      <MemoryRouter>
        <Questionnaire onSubmit={vi.fn()} projectId="proj-1" variant="project-inline" />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "更多输入选项" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /上传资料/ }));

    const fileInput = document.querySelector(".chat-file-input") as HTMLInputElement;
    const file = new File(["date,cost,orders\n2026-01,100,2"], "投放报表.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(startSessionMock).toHaveBeenCalledWith("proj-1", true));
    expect(uploadMock).toHaveBeenCalledWith("sess-1", "conversation", "uploaded_context", file);
    expect(await screen.findByText("投放报表.csv")).toBeTruthy();
    expect(screen.getByText("发送后沉淀")).toBeTruthy();
    expect(screen.queryByText(/字段：日期、消耗、成交/)).toBeNull();
    expect(screen.queryByText(/资料《投放报表.csv》解析摘要/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("输入消息..."), {
      target: { value: "这个文档写的什么" },
    });
    fireEvent.click(screen.getByLabelText("发送消息"));

    await waitFor(() => expect(screen.queryByText("发送后沉淀")).toBeNull());
    expect(screen.getByLabelText("附件：投放报表.csv")).toBeTruthy();
    expect(screen.getByText("文档")).toBeTruthy();
    expect(screen.getByText("这个文档写的什么")).toBeTruthy();
    expect(screen.queryByText(/附件：/)).toBeNull();
  });

  it("头脑风暴模式复用同一套资料上传和附件发送能力", async () => {
    const onBrainstormSend = vi.fn();
    const uploadMock = vi.mocked(uploadSessionFile);
    render(
      <MemoryRouter>
        <Questionnaire
          onSubmit={vi.fn()}
          projectId="proj-1"
          variant="project-inline"
          projectMode="brainstorm"
          brainstormDraft="结合这份资料推演"
          brainstormMessages={[]}
          onBrainstormSend={onBrainstormSend}
          onBrainstormDraftChange={vi.fn()}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "更多输入选项" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /上传资料/ }));

    const fileInput = document.querySelector(".chat-file-input") as HTMLInputElement;
    const file = new File(["产品资料"], "项目资料.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("sess-1", "conversation", "uploaded_context", file));
    expect(await screen.findByText("项目资料.pdf")).toBeTruthy();
    expect(screen.getByText("发送后沉淀")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("发送消息"));
    expect(onBrainstormSend).toHaveBeenCalledWith([
      { id: "file-1", name: "项目资料.pdf", memoryEnabled: true },
    ]);
  });
});
