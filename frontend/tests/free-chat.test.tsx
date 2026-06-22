import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FreeChatPage } from "../src/components/FreeChat/FreeChatPage";
import { saveIdeaCard, sendBrainstormMessage } from "../src/api/client";

vi.mock("../src/api/client", () => ({
  listProjects: vi.fn(async () => []),
  patchProject: vi.fn(),
  sendBrainstormMessage: vi.fn(async () => ({ message: "当然，可以这么拆。" })),
  saveIdeaCard: vi.fn(async (card) => ({ ...card, id: "idea-1", status: "saved" })),
}));

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => ({ token: "test-token", isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

const storage = new Map<string, string>();

describe("FreeChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
  });

  it("does not send while the user is confirming IME composition", () => {
    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/直接输入/);
    fireEvent.change(input, { target: { value: "学校食" } });
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      keyCode: 229,
      nativeEvent: { isComposing: true },
    });

    expect(sendBrainstormMessage).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("学校食");
  });

  it("sends a brainstorm message and renders the reply", async () => {
    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "头脑风暴" })).toBeTruthy();
    expect(screen.getByText("逻辑自证")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: { value: "我有一个营销点子，帮我判断逻辑站不站得住" },
    });
    fireEvent.click(screen.getByText("开始风暴"));

    await waitFor(() => expect(sendBrainstormMessage).toHaveBeenCalled());
    expect(screen.getByText("当然，可以这么拆。")).toBeTruthy();
  });

  it("keeps the input editable while the assistant is replying", async () => {
    let resolveReply: ((value: { message: string }) => void) | undefined;
    vi.mocked(sendBrainstormMessage).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReply = resolve;
      })
    );

    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/直接输入/);
    fireEvent.change(input, {
      target: { value: "我想继续聊学校食堂电火灶改造" },
    });
    fireEvent.click(screen.getByText("开始风暴"));

    await waitFor(() => expect(sendBrainstormMessage).toHaveBeenCalledTimes(1));
    expect((input as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.change(input, {
      target: { value: "我还想补充：学校后厨安全检查频率很高" },
    });
    expect((input as HTMLTextAreaElement).value).toBe("我还想补充：学校后厨安全检查频率很高");

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(sendBrainstormMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "思考中" })).toBeTruthy();

    resolveReply?.({ message: "当然，可以这么拆。" });
    await screen.findByText("当然，可以这么拆。");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((input as HTMLTextAreaElement).value).toBe("我还想补充：学校后厨安全检查频率很高");
  });

  it("renders structured assistant replies with headings and lists", async () => {
    vi.mocked(sendBrainstormMessage).mockResolvedValueOnce({
      message: "核心判断：这个点子可以先小范围验证。\n- 目标客户：**学校食堂**\n- 关键风险：采购周期长\n下一步：先约 `3 个` 后勤负责人访谈。",
    });

    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: { value: "我想做学校食堂电火灶改造" },
    });
    fireEvent.click(screen.getByText("开始风暴"));

    expect(await screen.findByRole("heading", { name: "核心判断" })).toBeTruthy();
    expect(await screen.findByText("这个点子可以先小范围验证。")).toBeTruthy();
    expect(screen.queryByText(/目标客户：\*\*学校食堂\*\*/)).toBeNull();
    expect(screen.getByText("学校食堂").tagName).toBe("STRONG");
    expect(screen.getByText("关键风险：采购周期长")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "下一步" })).toBeTruthy();
    expect(screen.getByText("3 个").tagName).toBe("CODE");
    expect(screen.getByText(/后勤负责人访谈/)).toBeTruthy();
  });

  it("still sends with Enter after composition has ended", async () => {
    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/直接输入/);
    fireEvent.change(input, { target: { value: "学校食堂电火灶改造" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(sendBrainstormMessage).toHaveBeenCalled());
  });

  it("updates the idea card from the conversation and saves it", async () => {
    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: {
        value: "我想给学校食堂做电火灶安全改造方案，解决明火和燃气安全问题，先做7天试点验证",
      },
    });
    fireEvent.click(screen.getByText("开始风暴"));

    const card = screen.getByLabelText("点子卡草稿");
    await waitFor(() => expect(within(card).getByText("学校食堂")).toBeTruthy());
    expect(within(card).getByText("明火和燃气安全问题")).toBeTruthy();
    expect(within(card).getByText(/学校食堂确实存在/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存点子" }));

    await waitFor(() => expect(saveIdeaCard).toHaveBeenCalled());
    expect(saveIdeaCard).toHaveBeenCalledWith(
      expect.objectContaining({
        target_customer: "学校食堂",
        pain_point: expect.stringContaining("明火和燃气安全"),
      }),
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: expect.stringContaining("电火灶") }),
      ])
    );
    expect(await screen.findByText(/点子已保存/)).toBeTruthy();
  });

  it("shows a concise idea brief instead of empty fixed fields", async () => {
    render(
      <MemoryRouter>
        <FreeChatPage />
      </MemoryRouter>
    );

    const card = screen.getByLabelText("点子卡草稿");
    expect(within(card).getByText("等待一个值得推敲的点子")).toBeTruthy();
    expect(within(card).queryByText("来源场景")).toBeNull();
    expect(within(card).queryByText("反证风险")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: {
        value: "我想给学校食堂做电火灶安全改造方案，解决明火和燃气安全问题，先做7天试点验证",
      },
    });
    fireEvent.click(screen.getByText("开始风暴"));

    await waitFor(() => expect(within(card).getByText("学校食堂")).toBeTruthy());
    expect(within(card).getByText("明火和燃气安全问题")).toBeTruthy();
    expect(within(card).getByText("验证动作")).toBeTruthy();
    expect(within(card).getByText(/试点验证/)).toBeTruthy();
    expect(within(card).queryByText("来源场景")).toBeNull();
    expect(within(card).queryByText("反证风险")).toBeNull();
  });

  it("restores the active brainstorm window after leaving and returning", async () => {
    const first = render(
      <MemoryRouter initialEntries={["/brainstorm"]}>
        <FreeChatPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: {
        value: "我想给学校食堂做电火灶安全改造方案，解决明火和燃气安全问题",
      },
    });
    fireEvent.click(screen.getByText("开始风暴"));

    await screen.findByText("当然，可以这么拆。");
    expect(screen.getAllByText(/学校食堂做电火灶安全改造方案/).length).toBeGreaterThan(0);
    first.unmount();

    render(
      <MemoryRouter initialEntries={["/brainstorm"]}>
        <FreeChatPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/学校食堂做电火灶安全改造方案/).length).toBeGreaterThan(0);
    expect(screen.getByText("当然，可以这么拆。")).toBeTruthy();
    const card = screen.getByLabelText("点子卡草稿");
    expect(within(card).getByText("学校食堂")).toBeTruthy();
  });

  it("opens a new independent brainstorm window and keeps the old one", async () => {
    render(
      <MemoryRouter initialEntries={["/brainstorm"]}>
        <FreeChatPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: { value: "我想给学校食堂做电火灶安全改造方案" },
    });
    fireEvent.click(screen.getByText("开始风暴"));
    await screen.findByText("当然，可以这么拆。");

    fireEvent.click(screen.getByRole("button", { name: "新建窗口" }));
    expect(within(screen.getByLabelText("风暴对话记录")).queryByText(/学校食堂做电火灶安全改造方案/)).toBeNull();
    expect(screen.getByText("等待一个值得推敲的点子")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/直接输入/), {
      target: { value: "我想做社区团购早餐项目" },
    });
    fireEvent.click(screen.getByText("开始风暴"));
    await waitFor(() => expect(sendBrainstormMessage).toHaveBeenCalledTimes(2));
    expect(within(screen.getByLabelText("风暴对话记录")).getByText(/社区团购早餐项目/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /切换到风暴窗口.*电火灶/ }));
    expect(within(screen.getByLabelText("风暴对话记录")).getByText(/学校食堂做电火灶安全改造方案/)).toBeTruthy();
    expect(within(screen.getByLabelText("风暴对话记录")).queryByText(/社区团购早餐项目/)).toBeNull();
  });

  it("preserves unsent drafts for each brainstorm window", () => {
    render(
      <MemoryRouter initialEntries={["/brainstorm"]}>
        <FreeChatPage />
      </MemoryRouter>
    );

    const firstInput = screen.getByPlaceholderText(/直接输入/);
    fireEvent.change(firstInput, {
      target: { value: "先记录一下：电火灶可以从校园安全切入" },
    });

    fireEvent.click(screen.getByRole("button", { name: "新建窗口" }));
    const secondInput = screen.getByPlaceholderText(/直接输入/);
    expect((secondInput as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(secondInput, {
      target: { value: "另一个点子：社区早餐预售" },
    });

    fireEvent.click(screen.getByRole("button", { name: /切换到风暴窗口.*电火灶/ }));
    expect((screen.getByPlaceholderText(/直接输入/) as HTMLTextAreaElement).value).toBe(
      "先记录一下：电火灶可以从校园安全切入"
    );
  });
});
