import type { ComponentProps } from "react";
export function surfaceStyles(padding: "none" | "compact" | "standard" = "standard", className = "") {
  return `nexa-surface nexa-surface--${padding} ${className}`;
}
export function Surface({padding, className, ...props}: ComponentProps<"section"> & {padding?: "none" | "compact" | "standard"}) {
  return <section {...props} className={surfaceStyles(padding,className)}/>;
}
export function SectionHeading({className = "", ...props}: ComponentProps<"h2">) {
  return <h2 {...props} className={`text-base font-semibold text-ink ${className}`}/>;
}
// Forms can use surfaceStyles without adding an unnecessary nested card.
