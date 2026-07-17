import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { fetchCreditsBalance, listProjects } from "../src/api/client";

const authState = {
  token: null as string | null,
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock("../src/auth/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("../src/auth/ggooSso", () => ({
  beginGGOOSSO: vi.fn(),
}));

vi.mock("../src/api/client", () => ({
  listProjects: vi.fn(async () => []),
  fetchCreditsBalance: vi.fn(async () => ({ available: false, points: null })),
}));

const fetchCreditsBalanceMock = vi.mocked(fetchCreditsBalance);
const listProjectsMock = vi.mocked(listProjects);

beforeEach(() => {
  authState.token = null;
  authState.isAuthenticated = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe("platform nav credits chip", () => {
  it("shows the formatted credits chip when logged in and GGOO reports an available balance", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    fetchCreditsBalanceMock.mockResolvedValueOnce({ available: true, points: 12345 });

    renderAt("/tools");

    const chip = await screen.findByRole("link", { name: /12,345/ });
    expect(chip.getAttribute("href")).toBe("https://ggoo.ai");
  });

  it("hides the chip when GGOO has no known balance field", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    fetchCreditsBalanceMock.mockResolvedValueOnce({ available: false, points: null });

    renderAt("/tools");

    await waitFor(() => expect(fetchCreditsBalanceMock).toHaveBeenCalled());
    expect(screen.queryByText(/积分/)).toBeNull();
  });

  it("hides the chip instead of erroring when the balance lookup rejects", async () => {
    authState.token = "test-token";
    authState.isAuthenticated = true;
    fetchCreditsBalanceMock.mockRejectedValueOnce(new Error("获取积分余额失败"));

    renderAt("/tools");

    await waitFor(() => expect(fetchCreditsBalanceMock).toHaveBeenCalled());
    expect(screen.queryByText(/积分/)).toBeNull();
  });

  it("never calls fetchCreditsBalance when logged out", () => {
    renderAt("/tools");

    expect(fetchCreditsBalanceMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/积分/)).toBeNull();
    expect(listProjectsMock).not.toHaveBeenCalled();
  });
});
