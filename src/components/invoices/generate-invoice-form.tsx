"use client";
import { useActionState,useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { generateInvoice } from "@/actions/generate-invoice";
import { generationInput,type GenerationDraft,type GenerationState } from "@/lib/invoices/generation";
import type { generationCustomers } from "@/lib/invoices/server";
import { formatMoney,formatBillingCycle,formatIncludedHours } from "@/lib/billing/model";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50";
export function GenerateInvoiceForm({customers,today,initialRequestId,owner,initialCustomer=""}:{customers:Awaited<ReturnType<typeof generationCustomers>>["customers"];today:string;initialRequestId:string;owner:string;initialCustomer?:string}) {
  const router = useRouter();
  const storageKey = `nexa.generate-invoice.pending.${owner}`;
  const [draft,setDraft] = useState<GenerationDraft>({customer_id:initialCustomer,issue_date:today,as_of_date:today,notes:"",terms:""});
  const [requestId,setRequestId] = useState(initialRequestId);
  const [ready,setReady] = useState(false);
  const [restored,setRestored] = useState(false);
  const inFlight = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(()=>{
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const saved = JSON.parse(stored);
        if (generationInput(saved.draft,saved.requestId).args) { setDraft(saved.draft);setRequestId(saved.requestId);setRestored(true); }
      }
    } catch { /* Storage must work before a submission can proceed. */ }
    setReady(true);
  },[storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [state,action,pending] = useActionState<GenerationState,FormData>(async(previous,form)=>{
    const check = generationInput(draft,requestId);
    if (!check.args) { inFlight.current = false;return {message:check.message}; }
    try { sessionStorage.setItem(storageKey,JSON.stringify({draft,requestId})); }
    catch { inFlight.current = false;return {message:"Your browser could not retain retry details. Allow session storage and try again."}; }
    try {
      const result = await generateInvoice(previous,form);
      if (!result.uncertain) {
        sessionStorage.removeItem(storageKey);setRestored(false);
        // A terminal empty result owns its key too. Further edits start a new request.
        if (!result.invoiceId) setRequestId(crypto.randomUUID());
      }
      return result;
    } catch { return {message:"We could not confirm the result. Retry this same submission safely.",uncertain:true}; }
    finally { inFlight.current = false; }
  },{});
  useEffect(()=>{
    if (state.invoiceId) { router.replace(`/invoices/${state.invoiceId}`);router.refresh(); }
  },[state.invoiceId,router]);
  const frozen = pending || restored || !!state.uncertain || !!state.invoiceId;
  const customer = customers.find(c=>c.id===draft.customer_id);
  const agreement = customer?.agreement;
  return <form action={action} onSubmit={event=>{
    if (inFlight.current || pending || state.invoiceId) event.preventDefault();
    else inFlight.current = true;
  }} className="space-y-5">
    <input type="hidden" name="request_id" value={requestId}/><input type="hidden" name="payload" value={JSON.stringify(draft)}/>
    {(state.message||restored)&&<p role={state.empty?"status":"alert"} className={`rounded-lg border p-3 text-sm ${state.empty?"border-slate-200 bg-slate-50 text-slate-700":"border-amber-200 bg-amber-50 text-amber-950"}`}>{state.message||"A previous submission may have completed. Retry to retrieve that same result."}</p>}
    <fieldset disabled={!ready||frozen} className="min-w-0 space-y-5">
      <legend className="sr-only">Invoice details</legend>
      <label className="block text-sm font-medium">Customer<select required className={input} value={draft.customer_id} onChange={e=>setDraft({...draft,customer_id:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}{!c.is_active?" (Archived)":""}</option>)}</select></label>
      {customer&&<section aria-label="Current billing context" className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Current billing model · today in New York</p><h2 className="mt-1 text-sm font-semibold">{agreement?"Monthly retainer":"No retainer"}</h2>{agreement?<div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600"><span>{formatMoney(agreement.monthly_fee)} / month</span><span>{formatBillingCycle(agreement.billing_cycle_day)}</span><span>{formatIncludedHours(agreement.included_hours)}</span><span>Overage {formatMoney(agreement.overage_hourly_rate)} / hour</span></div>:<p className="mt-1 text-sm text-slate-600">Eligible hourly time may be included.</p>}</section>}
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">Issue date<input required type="date" className={input} value={draft.issue_date} onChange={e=>setDraft({...draft,issue_date:e.target.value})}/></label>
        <label className="min-w-0 text-sm font-medium">As-of date <span className="font-normal text-slate-500">(optional)</span><input type="date" max={today} aria-describedby="as-of-help" className={input} value={draft.as_of_date} onChange={e=>setDraft({...draft,as_of_date:e.target.value})}/><span id="as-of-help" className="mt-2 block text-xs font-normal text-slate-500">Include eligible billing activity through this date. Leave blank to use today in New York.</span></label>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">{(["notes","terms"] as const).map(key=><label key={key} className="min-w-0 text-sm font-medium">{key==="notes"?"Notes":"Terms"} <span className="font-normal text-slate-500">(optional)</span><textarea rows={3} maxLength={10000} className={input} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div>
    </fieldset>
    <p className="border-t border-slate-200 pt-4 text-sm text-slate-500">May include the relevant retainer fee, completed prior-period overage, and eligible hourly time. Older missed retainer periods are not included. Review and edit the saved invoice anytime.</p>
    <button disabled={!ready||pending||!!state.invoiceId} className="w-full rounded-lg bg-cyan-400 px-5 py-3 font-semibold disabled:opacity-50 sm:w-auto">{pending?"Saving…":state.invoiceId?"Opening invoice…":restored||state.uncertain?"Retry same submission":"Save Draft"}</button>
  </form>;
}
