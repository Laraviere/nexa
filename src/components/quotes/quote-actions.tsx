"use client";
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
  <form action={action} className="rounded-xl border border-slate-200 bg-white p-5">
   <input type="hidden" name="quote_id" value={q.id}/><input type="hidden" name="revision" value={q.revision}/>
   <fieldset disabled={pending||converting} className="flex flex-col gap-3 sm:flex-row sm:items-end">
    <label className="text-sm font-medium">Quote status<select name="status" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2">{options.map(s=><option key={s} value={s}>{quoteStatuses[s as keyof typeof quoteStatuses]}</option>)}</select></label>
    <button className="rounded-lg border border-slate-300 px-4 py-2 font-semibold">{pending?"Saving…":"Update status"}</button>
   </fieldset><p className="mt-3 text-xs text-slate-500">Sent records delivery handled outside Nexa; no email is sent here. Acceptance does not create an invoice.</p>
   {state.message&&<p role="status" className="mt-3 text-sm">{state.message}</p>}
  </form>
  {q.status==="accepted"&&<form action={convert} className="rounded-xl border border-cyan-200 bg-cyan-50 p-5">
   <input type="hidden" name="quote_id" value={q.id}/><input type="hidden" name="revision" value={q.revision}/>
   <h2 className="font-semibold">Convert to Invoice</h2><p className="mt-2 text-sm text-slate-600">Create one editable draft invoice with a normal invoice number. This accepted quote remains in history.</p>
   <fieldset disabled={pending||converting||!!conversion.invoiceId} className="mt-4 space-y-4">
    <label className="block text-sm font-medium">Invoice date<input required name="issue_date" type="date" defaultValue={today} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"/></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="yes" required className="mt-1"/>Create an invoice from this accepted quote.</label>
    <button className="rounded-lg bg-cyan-400 px-5 py-3 font-semibold">{converting?"Converting…":"Convert to Invoice"}</button>
   </fieldset>{conversion.message&&<p role="alert" className="mt-3 text-sm">{conversion.message}</p>}
  </form>}
 </section>;
}
