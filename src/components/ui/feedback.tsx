import type { ComponentProps, ReactNode } from "react";

export function InlineNotice({tone = "info", title, children, className = "", role, ...props}: Omit<ComponentProps<"div">,"title"> & {tone?: "info" | "success" | "warning" | "error"; title?: ReactNode}) {
  return <div {...props} role={role ?? (tone === "error" ? "alert" : "status")} className={`nexa-notice nexa-tone--${tone === "error" ? "danger" : tone} ${className}`}>
    {title && <p className="mb-1 font-semibold">{title}</p>}{children}
  </div>;
}
export function EmptyState({title, description, action}: {title: ReactNode; description?: ReactNode; action?: ReactNode}) {
  return <div className="py-5 text-sm"><p className="font-medium text-ink">{title}</p>{description && <p className="mt-1 text-secondary">{description}</p>}{action && <div className="mt-3 flex flex-wrap gap-3">{action}</div>}</div>;
}
export function LoadingState({children}: {children: ReactNode}) {
  return <p role="status" aria-live="polite" className="py-6 text-sm text-secondary">{children}</p>;
}
