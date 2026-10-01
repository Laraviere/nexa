"use client";

import { useEffect, useState } from "react";
import { loadInvoiceRetainerContext } from "@/actions/invoice-retainer-context";
import { formatBusinessDate } from "@/lib/billing/model";
import { formatDuration } from "@/lib/time/model";
import { inclusivePeriodEnd, type RetainerContext } from "@/lib/invoices/retainer-context";

export function RetainerContextSummary({ context }: { context: RetainerContext }) {
  if (context.status === "none") return null;
  if (context.status === "error") return <p role="status" className="mt-4 text-xs text-secondary">Current retainer usage is unavailable.</p>;
  const s = context.summary;
  const overage = s.overage_minutes > 0;
  return <section aria-label="Retainer usage" className="mt-2 px-1 py-2">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h3 className="text-xs font-medium text-secondary">Retainer usage</h3><p className="sr-only">{formatBusinessDate(s.period_start)} – {formatBusinessDate(inclusivePeriodEnd(s.period_end))}</p></div>
    <p className="mt-1 text-xs text-secondary"><span className="tabular-nums">{formatDuration(s.included_minutes_available)}</span> included · <span className="tabular-nums">{formatDuration(s.rounded_minutes_used)}</span> used · {overage?<><span className="tabular-nums">{formatDuration(s.overage_minutes)}</span> overage</>:<><span className="tabular-nums">{formatDuration(s.remaining_included_minutes)}</span> remaining · Covered by retainer{s.remaining_included_minutes===0&&" · Included allowance exhausted"}</>}</p>
    {overage&&<p className="sr-only">Usage includes invoiced time. Billing available shows eligible, unclaimed charges.</p>}
  </section>;
}

// Deliberately separate from preview state and the invoice payload: no candidates,
// selections or financial mutations originate from this supplemental read.
export function CurrentRetainerContext({ customerId, asOf, refreshVersion }: { customerId: string; asOf: string; refreshVersion: number }) {
  const key = `${customerId}:${asOf}:${refreshVersion}`;
  const [loaded, setLoaded] = useState<{ key: string; context: RetainerContext } | null>(null);
  useEffect(() => {
    let active = true;
    if (customerId && asOf) {
      loadInvoiceRetainerContext(customerId, asOf).then(context => {
        if (active) setLoaded({ key, context });
      }).catch(() => {
        if (active) setLoaded({ key, context: { status: "error" } });
      });
    }
    return () => { active = false; };
  }, [customerId, asOf, key]);
  if (!customerId || !asOf || loaded?.key !== key) return null;
  return <RetainerContextSummary context={loaded.context} />;
}
