import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../../auth/useAuth";
import { useIsAdmin } from "../../auth/useIsAdmin";

// 运营后台守卫：先认证、再校验 is_admin。后端 require_admin 才是真防线，
// 这里只是别把非管理员引到一个会满屏 403 的页面。
export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const isAdmin = useIsAdmin();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin === null) {
    return <div style={{ padding: 40, color: "var(--ink-soft)" }}>校验权限中…</div>;
  }
  if (!isAdmin) return <Navigate to="/projects" replace />;
  return <>{children}</>;
}
