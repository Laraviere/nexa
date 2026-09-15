import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Appearance = { variant?: "primary" | "secondary" | "quiet" | "destructive"; size?: "standard" | "compact"; className?: string };
export function buttonStyles({variant = "primary", size = "standard", className = ""}: Appearance = {}) {
  return `nexa-button nexa-button--${variant} nexa-button--${size} ${className}`;
}
export function Button({variant, size, className, pending = false, pendingLabel, disabled, children, ...props}: ComponentProps<"button"> & Appearance & {pending?: boolean; pendingLabel?: ReactNode}) {
  return <button {...props} disabled={disabled || pending} aria-busy={pending || props["aria-busy"]} className={buttonStyles({variant,size,className})}>{pending && pendingLabel ? pendingLabel : children}</button>;
}
export function ButtonLink({variant = "secondary", size, className, ...props}: ComponentProps<typeof Link> & Appearance) {
  return <Link {...props} className={buttonStyles({variant,size,className})}/>;
}
export function ButtonAnchor({variant = "secondary", size, className, ...props}: ComponentProps<"a"> & Appearance) {
  return <a {...props} className={buttonStyles({variant,size,className})}/>;
}
