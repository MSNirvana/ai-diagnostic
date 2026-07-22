import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AUTH_TOKEN_CHANGED, getToken, setToken, clearToken } from "./authStore";
import { DEV_AUTH_BYPASS } from "./devAuth";

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());

  useEffect(() => {
    const syncToken = () => setTokenState(getToken());
    window.addEventListener(AUTH_TOKEN_CHANGED, syncToken);
    window.addEventListener("storage", syncToken);
    return () => {
      window.removeEventListener(AUTH_TOKEN_CHANGED, syncToken);
      window.removeEventListener("storage", syncToken);
    };
  }, []);

  const login = (t: string) => {
    setToken(t);
    setTokenState(t);
  };

  const logout = () => {
    clearToken();
    setTokenState(null);
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token || DEV_AUTH_BYPASS, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
