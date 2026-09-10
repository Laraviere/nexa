"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "@/actions/invoices";
import { invoiceInput,previewTotal,units,type Draft,type InvoiceState,type Line } from "@/lib/invoices/model";
import { formatMoney } from "@/lib/billing/model";
const blank = (): Line => ({ description:"",quantity:"1",unit:"each",unit_rate:"" });
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50";
export function CreateInvoiceForm({customers,today,initialRequestId,owner}:{customers:{id:string;company_name:string;is_active:boolean}[];today:string;initialRequestId:string;owner:string}) {
  const router = useRouter();
  const storageKey = `nexa.manual-invoice.pending.${owner}`;
  const [draft,setDraft] = useState<Draft>({customer_id:"",issue_date:today,notes:"",terms:"",items:[blank()]});
  const [requestId,setRequestId] = useState(initialRequestId);
  const [ready,setReady] = useState(false);
  const [restored,setRestored] = useState(false);
  // Restore tab storage after hydration; it is unavailable during server rendering.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(()=>{
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const saved = JSON.parse(stored);
        if (invoiceInput(saved.draft,saved.requestId).args) { setDraft(saved.draft); setRequestId(saved.requestId); setRestored(true); }
      }
    } catch { /* Saving is blocked below if retry details cannot be retained. */ }
    setReady(true);
  },[storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [state,action,pending] = useActionState<InvoiceState,FormData>(async (previous,form)=>{
    const check = invoiceInput(draft,requestId);
    if (!check.args) return {message:check.message};
    try { sessionStorage.setItem(storageKey,JSON.stringify({draft,requestId})); }
    catch { return {message:"Your browser could not retain retry details. Allow session storage and try again."}; }
    try {
      const result = await createInvoice(previous,form);
      if (!result.uncertain) { sessionStorage.removeItem(storageKey); setRestored(false); }
      return result;
    } catch { return {message:"We could not confirm the result. Retry this same submission safely.",uncertain:true}; }
  },{});
  useEffect(()=>{
    if (state.invoiceId) { router.replace(`/invoices/${state.invoiceId}`); router.refresh(); }
  },[state.invoiceId,router]);
  const frozen = pending || restored || !!state.uncertain || !!state.invoiceId;
  const preview = previewTotal(draft.items);
  function updateLine(index:number,key:keyof Line,value:string) { setDraft(d=>({...d,items:d.items.map((l,i)=>i===index?{...l,[key]:value}:l)})); }
  return <form action={action} className="space-y-6">
    <input type="hidden" name="request_id" value={requestId}/><input type="hidden" name="payload" value={JSON.stringify(draft)}/>
    {(state.message||restored)&&<div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{state.message||"A previous submission may have saved. Retry to retrieve or complete that same invoice."}</div>}
    <fieldset disabled={!ready||frozen} className="min-w-0 space-y-6">
      <legend className="sr-only">Manual invoice details</legend>
      <div className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[2fr_1fr]">
        <label className="min-w-0 text-sm font-medium">Customer<select required className={input} value={draft.customer_id} onChange={e=>setDraft({...draft,customer_id:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}{!c.is_active?" (Archived)":""}</option>)}</select></label>
        <label className="text-sm font-medium">Issue date<input required type="date" className={input} value={draft.issue_date} onChange={e=>setDraft({...draft,issue_date:e.target.value})}/></label>
        <p className="text-sm text-slate-500 sm:col-span-2">Invoice number and due date are assigned when saved. Customer billing details are captured automatically.</p>
      </div>
      <section aria-labelledby="invoice-lines-title" className="space-y-3"><h2 id="invoice-lines-title" className="text-lg font-semibold">Line items</h2>
        {draft.items.map((line,index)=><div key={index} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Line {index+1}</h3><button type="button" onClick={()=>setDraft({...draft,items:draft.items.filter((_,i)=>i!==index)})} aria-label={`Remove unsaved line ${index+1}`} className="text-sm font-medium text-slate-500 hover:text-red-700">Remove</button></div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
            <label className="min-w-0 text-sm font-medium sm:col-span-3 lg:col-span-1">Description<input required maxLength={2000} className={input} value={line.description} onChange={e=>updateLine(index,"description",e.target.value)}/></label>
            <label className="min-w-0 text-sm font-medium">Quantity<input required inputMode="decimal" className={input} value={line.quantity} onChange={e=>updateLine(index,"quantity",e.target.value)}/></label>
            <label className="min-w-0 text-sm font-medium">Unit<select className={input} value={line.unit} onChange={e=>updateLine(index,"unit",e.target.value)}>{Object.entries(units).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label className="min-w-0 text-sm font-medium">Unit rate (USD)<input required inputMode="decimal" className={input} value={line.unit_rate} onChange={e=>updateLine(index,"unit_rate",e.target.value)}/></label>
          </div></div>)}
        {!draft.items.length&&<p className="text-sm text-slate-600">Add at least one line item.</p>}
        <button type="button" disabled={draft.items.length>=1000} onClick={()=>setDraft({...draft,items:[...draft.items,blank()]})} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">Add line</button>
      </section>
      <div className="grid gap-5 sm:grid-cols-2">{(["notes","terms"] as const).map(key=><label key={key} className="text-sm font-medium">{key==="notes"?"Notes":"Terms"} <span className="font-normal text-slate-500">(optional)</span><textarea rows={3} maxLength={10000} className={input} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div>
    </fieldset>
    <div className="flex flex-wrap items-end justify-between gap-5 border-t border-slate-200 pt-5"><p className="max-w-sm text-sm text-slate-500">Manual lines save in the order shown. Draft editing will be available in a later milestone.</p><div className="min-w-0 max-w-full text-right"><p className="text-sm text-slate-500">Subtotal / total preview</p><p aria-live="polite" className="mt-1 break-all text-2xl font-semibold tabular-nums">{preview===null?"—":formatMoney(preview)}</p><p className="mt-1 text-xs text-slate-500">Preview only. Saved totals come from the database.</p></div></div>
    <button disabled={!ready||pending||!!state.invoiceId} className="rounded-lg bg-cyan-400 px-5 py-3 font-semibold disabled:opacity-50">{pending?"Saving…":state.invoiceId?"Opening invoice…":restored||state.uncertain?"Retry same submission":"Create draft invoice"}</button>
  </form>;
}
