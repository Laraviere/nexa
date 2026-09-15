import type { ReactNode } from "react";

// An inline group, not a dialog: native Tab order is preserved and existing
// form ownership, confirmation fields and focus behavior remain with callers.
export function ConfirmationPanel({title, description, children, actions, destructive = false}: {
  title: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode; destructive?: boolean;
}) {
  return <div role="group" aria-label={typeof title === "string" ? title : undefined} className={`nexa-confirmation ${destructive ? "nexa-confirmation--destructive" : ""}`}>
    <h3 className="text-sm font-semibold text-ink">{title}</h3>
    {description && <p className="mt-2 text-sm text-secondary">{description}</p>}
    {children}
    {actions && <div className="mt-4 flex flex-wrap justify-end gap-3">{actions}</div>}
  </div>;
}
