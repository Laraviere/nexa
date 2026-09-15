import type { ReactNode } from "react";

const widths = { workspace: "max-w-6xl", form: "max-w-3xl", document: "max-w-4xl" };

// The shell owns gutters. Nested form/document containers only constrain width.
export function PageContainer({ children, width = "workspace", gutters = false }: {
  children: ReactNode;
  width?: keyof typeof widths;
  gutters?: boolean;
}) {
  return <div className={`mx-auto w-full min-w-0 ${widths[width]} ${gutters ? "px-4 py-6 sm:px-6 lg:px-8 lg:py-8" : ""}`}>{children}</div>;
}
