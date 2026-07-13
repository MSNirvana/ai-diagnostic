import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { AuthProvider } from "../src/auth/useAuth";
import { AuthCallbackPage } from "../src/components/Auth/AuthCallbackPage";

describe("GGOO SSO callback", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("stores the GGOO token and returns to the original Build route", async () => {
    sessionStorage.setItem("build:ggoo-sso:return-to", "/projects/project-1");
    window.history.replaceState({}, "", "/auth/callback#access_token=ggoo-jwt");

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <AuthProvider>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/projects/:id" element={<div>项目已打开</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("项目已打开")).toBeTruthy());
    expect(localStorage.getItem("auth_token")).toBe("ggoo-jwt");
    expect(window.location.hash).toBe("");
  });
});
