import type { ReactNode } from "react";
import "./AppShell.css";

interface AppShellProps {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
}

export function AppShell({ children, eyebrow, title, description, actions }: AppShellProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__content">
        {(title || description || actions) && (
          <section className="page-hero">
            <div>
              {eyebrow && <span className="page-hero__eyebrow">{eyebrow}</span>}
              {title && <h1>{title}</h1>}
              {description && <p>{description}</p>}
            </div>
            {actions && <div className="page-hero__actions">{actions}</div>}
          </section>
        )}

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
