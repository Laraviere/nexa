import type { ReactNode } from "react";
type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type Entry = { label: string; tone: Tone };
// These are intentionally separate business domains, sharing only appearance.
const mappings: Record<string, Record<string, Entry>> = {
  invoiceWorkflow: {draft:{label:"Draft",tone:"neutral"},ready:{label:"Ready",tone:"info"},sent:{label:"Sent",tone:"info"},void:{label:"Void",tone:"danger"}},
  invoicePayment: {unpaid:{label:"Unpaid",tone:"neutral"},partially_paid:{label:"Partially Paid",tone:"warning"},paid:{label:"Paid",tone:"success"}},
  quote: {draft:{label:"Draft",tone:"neutral"},sent:{label:"Sent",tone:"info"},accepted:{label:"Accepted",tone:"success"},declined:{label:"Declined",tone:"danger"},expired:{label:"Expired",tone:"warning"}},
  customer: {active:{label:"Active",tone:"success"},archived:{label:"Archived",tone:"neutral"}},
  paymentRecord: {active:{label:"Active",tone:"info"},voided:{label:"Voided",tone:"danger"}},
};
export function StatusBadge({domain, status, children}: {domain: "invoiceWorkflow" | "invoicePayment" | "quote" | "customer" | "paymentRecord"; status: string; children?: ReactNode}) {
  const entry = mappings[domain][status];
  return <span className={`nexa-badge nexa-tone--${entry?.tone ?? "neutral"}`}>{children ?? entry?.label ?? status}</span>;
}
