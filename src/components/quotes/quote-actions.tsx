"use client";
import { ConfirmationPanel } from "@/components/ui/confirmation-panel";
import { InlineNotice } from "@/components/ui/feedback";
import { surfaceStyles } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateQuoteStatus, convertQuote } from "@/actions/quotes";
import { quoteStatuses, type Quote, type QuoteState } from "@/lib/quotes/model";
export function QuoteActions({quote:q,today}:{quote:Quote;today:string}) {
 const router=useRouter();
 const [state,action,pending]=useActionState<QuoteState,FormData>(updateQuoteStatus,{});
 const [conversion,convert,converting]=useActionState<QuoteState,FormData>(convertQuote,{});
 useEffect(()=>{if(conversion.invoiceId){router.replace(`/invoices/${conversion.invoiceId}`);router.refresh();}},[conversion.invoiceId,router]);
 if(q.converted_invoice_id)return null;
 const options=["accepted","declined","expired"].includes(q.status)?["draft"]:["draft","sent","accepted","declined"].filter(s=>s!==q.status);
 return <section className="mt-6 space-y-5">
  <form action={action} className={surfaceStyles()}>
   <input type="hidden" name="quote_id" value={q.id}/><input type="hidden" name="revision" value={q.revision}/>
   <fieldset disabled={pending||converting} className="flex flex-col gap-3 sm:flex-row sm:items-end">
    <label className="text-sm font-medium">Quote status<Select name="status" className="mt-1 block w-full">{options.map(s=><option key={s} value={s}>{quoteStatuses[s as keyof typeof quoteStatuses]}</option>)}</Select></label>
    <Button variant="secondary">{pending?"Saving…":"Update status"}</Button>
   </fieldset><p className="mt-3 text-xs text-slate-500">Sent records delivery handled outside Nexa; no email is sent here. Acceptance does not create an invoice.</p>
   {state.message&&<InlineNotice tone="info" role="status" className="mt-3">{state.message}</InlineNotice>}
  </form>
  {q.status==="accepted"&&<form action={convert} className={surfaceStyles()}>
   <input type="hidden" name="quote_id" value={q.id}/><input type="hidden" name="revision" value={q.revision}/>
   <ConfirmationPanel title="Convert to Invoice" description="Create one editable draft invoice with a normal invoice number. This accepted quote remains in history.">
   <fieldset disabled={pending||converting||!!conversion.invoiceId} className="mt-4 space-y-4">
    <label className="block text-sm font-medium">Invoice date<Input required name="issue_date" type="date" defaultValue={today} className="mt-1 block"/></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="yes" required className="mt-1"/>Create an invoice from this accepted quote.</label>
    <Button variant="primary">{converting?"Converting…":"Convert to Invoice"}</Button>
   </fieldset>{conversion.message&&<InlineNotice tone="error" role="alert" className="mt-3">{conversion.message}</InlineNotice>}
  </ConfirmationPanel></form>}
 </section>;
}
