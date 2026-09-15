import type { ComponentProps, ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

export function ListHeader({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return <header className="nexa-list-header"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function FilterToolbar({ className = "", ...props }: ComponentProps<"form">) {
  return <form {...props} className={`nexa-filter-toolbar ${className}`} />;
}

export function ListPagination({ label, children, previousHref, nextHref }: { label: string; children: ReactNode; previousHref?: string; nextHref?: string }) {
  return <nav aria-label={label} className="nexa-pagination"><p>{children}</p><div>{previousHref ? <ButtonLink href={previousHref}>Previous</ButtonLink> : <Button variant="secondary" type="button" disabled>Previous</Button>}{nextHref ? <ButtonLink href={nextHref}>Next</ButtonLink> : <Button variant="secondary" type="button" disabled>Next</Button>}</div></nav>;
}
