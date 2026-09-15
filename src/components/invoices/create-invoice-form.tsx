"use client";
import { InlineNotice } from "@/components/ui/feedback";
import { surfaceStyles } from "@/components/ui/surface";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { useActionState,useEffect,useRef,useState } from "react";
import type { generationCustomers } from "@/lib/invoices/server";
import { useRouter } from "next/navigation";
import { previewInvoice,saveComposedInvoice,previewInvoiceEdit,updateComposedInvoice } from "@/actions/invoice-composer";
import { composerInput,readCharges,chargeLabels,type ComposerDraft,type ComposerPayload,type ComposerState,type PreviewResult } from "@/lib/invoices/composer";
import { previewTotal,previewDueDate,units,type Line } from "@/lib/invoices/model";
import { formatMoney,formatBusinessDate,formatBillingCycle,formatIncludedHours } from "@/lib/billing/model";
const blank = (): Line => ({ description:"",quantity:"1",unit:"each",unit_rate:"" });
const input = "mt-1 w-full min-w-0";
export function CreateInvoiceForm({customers,today,initialRequestId,owner,editing}:{customers:Awaited<ReturnType<typeof generationCustomers>>["customers"];today:string;initialRequestId:string;owner:string;editing?:{invoiceId:string;draft:ComposerDraft}}) {
  const router = useRouter();
  const storageKey = `nexa.composed-invoice.pending.${owner}${editing?`.edit.${editing.invoiceId}`:""}`;
  const [draft,setDraft] = useState<ComposerDraft>(editing?.draft??{customer_id:"",issue_date:today,as_of_date:today,notes:"",terms:"",items:[]});
  const [requestId,setRequestId] = useState(initialRequestId);
  const [ready,setReady] = useState(false);
  const [restored,setRestored] = useState(false);
  const [loaded,setLoaded] = useState<{key:string;preview:PreviewResult}|null>(null);
  const [descriptions,setDescriptions]=useState<Record<string,string>>({});
  const [selected,setSelected] = useState<string[]>([]);
  const [loading,setLoading] = useState(false);
  const [previewError,setPreviewError] = useState("");
  const [refreshVersion,setRefreshVersion] = useState(0);
  const [mustRefresh,setMustRefresh] = useState(false);
  const recovery = useRef(false);
  const inFlight = useRef(false);
  const contextKey = `${draft.customer_id}:${draft.as_of_date}`;
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(()=>{
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const saved = JSON.parse(stored);
        if (composerInput(saved.payload,saved.requestId).args && saved.preview && readCharges(saved.preview.candidates)!==null && saved.preview.revision===saved.payload.revision && saved.preview.as_of_date===saved.payload.as_of_date) {
          recovery.current=true;setDraft(saved.payload);setRequestId(saved.requestId);setSelected(saved.payload.selected_candidate_ids);setDescriptions(saved.payload.descriptions??{});
          setLoaded({key:`${saved.payload.customer_id}:${saved.payload.as_of_date}`,preview:saved.preview});setRestored(true);
        }
      }
    } catch { /* Submission requires working recovery storage below. */ }
    setReady(true);
  },[storageKey]);
  useEffect(()=>{
    if (!ready || recovery.current) return;
    let active=true;
    setLoaded(null);setSelected([]);setPreviewError("");setMustRefresh(false);
    if (!draft.customer_id || !draft.as_of_date) {setLoading(false);return;}
    setLoading(true);
    const request=editing?previewInvoiceEdit({p_invoice_id:editing.invoiceId,p_as_of_date:draft.as_of_date}):previewInvoice({p_customer_id:draft.customer_id,p_as_of_date:draft.as_of_date});
    request.then(result=>{
      if (!active) return;
      if (result.preview) {
        setLoaded({key:`${draft.customer_id}:${draft.as_of_date}`,preview:result.preview});
        const candidates=readCharges(result.preview.candidates)!;
        setSelected(candidates.filter(c=>!editing||c.retained).map(c=>c.candidate_id));
        setDescriptions(Object.fromEntries(candidates.map(c=>[c.candidate_id,c.description])));
      } else setPreviewError(result.message??"Unable to load charges.");
      setLoading(false);
    }).catch(()=>{if(active){setPreviewError("Unable to load charges. Please try again.");setLoading(false);}});
    return ()=>{active=false;};
  },[ready,draft.customer_id,draft.as_of_date,refreshVersion,editing]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const snapshot = loaded?.key===contextKey?loaded.preview:null;
  const charges = snapshot?readCharges(snapshot.candidates)??[]:[];
  const chosen = charges.filter(c=>selected.includes(c.candidate_id));
  const payload:ComposerPayload={...draft,as_of_date:snapshot?.as_of_date??draft.as_of_date,revision:snapshot?.revision??"",selected_candidate_ids:selected,...(editing?{invoice_id:editing.invoiceId,descriptions:Object.fromEntries(selected.filter(id=>descriptions[id]!==undefined).map(id=>[id,descriptions[id]]))}:{})};
  const [state,action,pending] = useActionState<ComposerState,FormData>(async(previous,form)=>{
    const check=composerInput(payload,requestId);
    if (!check.args || !snapshot || mustRefresh) {inFlight.current=false;return {message:check.message??"Refresh charges before saving."};}
    try {sessionStorage.setItem(storageKey,JSON.stringify({payload,requestId,preview:snapshot}));}
    catch {inFlight.current=false;return {message:"Your browser could not retain retry details. Allow session storage and try again."};}
    try {
      const result=await (editing?updateComposedInvoice:saveComposedInvoice)(previous,form);
      if (!result.uncertain) {
        sessionStorage.removeItem(storageKey);recovery.current=false;setRestored(false);
        if (!result.invoiceId) setRequestId(crypto.randomUUID());
        if (result.stale) setMustRefresh(true);
      } else recovery.current=true;
      return result;
    } catch {recovery.current=true;return {message:"We could not confirm the result. Retry this same submission safely.",uncertain:true};}
    finally {inFlight.current=false;}
  },{});
  useEffect(()=>{if(state.invoiceId){router.replace(`/invoices/${state.invoiceId}`);router.refresh();}},[state.invoiceId,router]);
  const frozen=pending||restored||!!state.uncertain||!!state.invoiceId;
  const customTotal=previewTotal(draft.items);
  const taxTotal=draft.items.reduce((sum,line)=>sum+Number(line.tax_amount??0),0)+chosen.reduce((sum,c)=>sum+(c.tax_amount??0),0);
  const preview=customTotal===null?null:customTotal+chosen.reduce((sum,c)=>sum+c.amount,0);
  function updateLine(index:number,key:keyof Line,value:string){setDraft(d=>({...d,items:d.items.map((l,i)=>i===index?{...l,[key]:value}:l)}));}
  const customer=customers.find(c=>c.id===draft.customer_id);
  const agreement=customer?.agreement;
  const due=customer?previewDueDate(draft.issue_date,customer.default_payment_terms_days):null;
  return <form action={action} onSubmit={event=>{if(inFlight.current||pending||state.invoiceId)event.preventDefault();else inFlight.current=true;}} className="nexa-form-page">
    <input type="hidden" name="request_id" value={requestId}/><input type="hidden" name="payload" value={JSON.stringify(payload)}/>
    {((state.message&&(!state.stale||mustRefresh))||restored)&&<InlineNotice tone="warning" role="alert" className="mb-5">{state.message||"A previous submission may have saved. Retry to retrieve or complete that same invoice."}</InlineNotice>}
    <fieldset disabled={!ready||frozen} className={surfaceStyles("standard", "min-w-0")}>
      <legend className="sr-only">Invoice details</legend>
      <h2 className="mb-4 text-base font-semibold">Invoice details</h2><div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0"><label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to<Select required disabled={!!editing} className={`${input} mt-2 normal-case tracking-normal`} value={draft.customer_id} onChange={e=>setDraft({...draft,customer_id:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}{!c.is_active?" (Archived)":""}</option>)}</Select></label>
          {editing&&<p className="mt-2 text-xs text-slate-500">Customer and captured payment terms remain fixed.</p>}{customer&&<div aria-label="Customer billing context" className="mt-3 text-sm text-slate-500"><p className="font-medium text-slate-700">{agreement?"Monthly retainer":"No retainer"}</p>{agreement?<><p>{formatMoney(agreement.monthly_fee)} / month · {formatBillingCycle(agreement.billing_cycle_day)}</p><p>{formatIncludedHours(agreement.included_hours)} · Overage {formatMoney(agreement.overage_hourly_rate)} / hr</p><p className="mt-1 text-xs">Current terms</p></>:<p>Eligible hourly work may be available.</p>}</div>}
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><FormField id="invoice-date" label="Invoice date"><Input required type="date" className={input} value={draft.issue_date} onChange={e=>setDraft({...draft,issue_date:e.target.value})}/></FormField><div className="min-w-0 text-sm"><p className="font-medium">Due date</p><p className="mt-3 text-slate-800">{due?formatBusinessDate(due):"—"}</p><p className="mt-1 text-xs text-slate-500">{customer?`${customer.default_payment_terms_days===0?"Due on receipt":`Net ${customer.default_payment_terms_days}`} · Estimated until saved`:"Select a customer"}</p></div></div>
      </div>
      <section aria-labelledby="suggested-title" aria-busy={loading} className="my-7 border-y border-slate-200 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 id="suggested-title" className="text-sm font-semibold">Suggested charges</h2><p className="mt-1 text-xs text-slate-500">{editing?"Removing a billing charge makes that activity available for invoicing again. Hours and rates follow captured billing data.":"Select the billing activity to include."}</p></div><label className="min-w-0 text-xs font-medium text-slate-500">As-of date<Input required type="date" max={today} className={input} value={draft.as_of_date} onChange={e=>setDraft({...draft,as_of_date:e.target.value})}/></label></div>
        {!customer?<p className="mt-4 text-sm text-slate-500">Choose a customer to load billing activity.</p>:!draft.as_of_date?<p className="mt-4 text-sm text-slate-500">Choose an as-of date to load charges.</p>:loading||(!snapshot&&!previewError&&!mustRefresh)?<p role="status" className="mt-4 text-sm text-slate-500">Loading charges…</p>:previewError?<p role="alert" className="mt-4 text-sm text-slate-600">{previewError}</p>:snapshot&&<>
          {!charges.length?<p role="status" className="mt-4 text-sm text-slate-500">No billing activity is ready to invoice.</p>:<div className="mt-4 divide-y divide-slate-100">{charges.map(c=><label key={c.candidate_id} className="flex min-w-0 cursor-pointer items-start gap-3 py-3"><input type="checkbox" checked={selected.includes(c.candidate_id)} disabled={mustRefresh} onChange={e=>setSelected(ids=>e.target.checked?[...ids,c.candidate_id]:ids.filter(id=>id!==c.candidate_id))} className="mt-1 size-4 shrink-0 accent-cyan-600"/><span className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><span className="min-w-0"><span className="text-xs font-medium text-slate-500">{chargeLabels[c.source_type]}</span><span className="mt-1 block break-words text-sm font-medium">{c.description}</span>{c.billed_minutes!==undefined&&<span className="mt-1 block text-xs text-slate-500">{Math.floor(c.billed_minutes/60)} hr {c.billed_minutes%60} min · {formatMoney(c.unit_rate)}/hr</span>}</span><span className="whitespace-nowrap text-sm font-semibold tabular-nums sm:text-right">{formatMoney(c.amount)}</span></span></label>)}</div>}
        </>}
        {customer&&<Button variant="quiet" type="button" disabled={loading||!draft.as_of_date} onClick={()=>setRefreshVersion(v=>v+1)} className="mt-3">Refresh charges</Button>}
      </section>
      <section aria-labelledby="invoice-lines-title"><h2 id="invoice-lines-title" className="mb-4 text-base font-semibold">Invoice items</h2><h3 className="mb-3 text-sm font-semibold">Selected charges</h3><div className="nexa-selected-charges">{!chosen.length&&<p className="py-3 text-sm text-secondary">No suggested charges selected.</p>}

        {chosen.map(c=><div key={c.candidate_id} className="grid min-w-0 gap-3 border-b border-slate-100 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><div className="min-w-0">{editing?<label className="block text-sm"><span className="sr-only">Charge description</span><Input required maxLength={2000} value={descriptions[c.candidate_id]??c.description} onChange={e=>setDescriptions({...descriptions,[c.candidate_id]:e.target.value})} className={input}/></label>:<p className="break-words text-sm font-medium">{c.description}</p>}<p className="mt-1 text-xs text-slate-500">{chargeLabels[c.source_type]}</p></div><p className="text-sm text-slate-500">{c.quantity} × {formatMoney(c.unit_rate)}</p><p className="whitespace-nowrap text-sm font-medium tabular-nums sm:text-right">{formatMoney(c.amount)}</p></div>)}
        </div><h3 className="mb-2 mt-6 text-sm font-semibold">Manual line items</h3>
        {draft.items.map((line,index)=><div key={index} className="nexa-edit-line">
          <label className="min-w-0 text-sm"><span >Description</span><Input required maxLength={2000} placeholder="Describe the item" className={input} value={line.description} onChange={e=>updateLine(index,"description",e.target.value)}/></label>
          <label className="min-w-0 text-sm"><span >Quantity</span><Input required inputMode="decimal" className={input} value={line.quantity} onChange={e=>updateLine(index,"quantity",e.target.value)}/></label>
          <label className="min-w-0 text-sm"><span >Unit</span><Select className={input} value={line.unit} onChange={e=>updateLine(index,"unit",e.target.value)}>{Object.entries(units).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
          <label className="min-w-0 text-sm"><span >Rate (USD)</span><Input required inputMode="decimal" className={input} value={line.unit_rate} onChange={e=>updateLine(index,"unit_rate",e.target.value)}/></label>
          <div className="min-w-0 text-right text-sm"><span className="text-slate-500">Amount</span><p className="mt-3 whitespace-nowrap font-medium tabular-nums">{previewTotal([line])===null?"—":formatMoney(previewTotal([line])!)}</p></div>
          <Button variant="quiet" type="button" onClick={()=>setDraft({...draft,items:draft.items.filter((_,i)=>i!==index)})} aria-label={`Remove unsaved line ${index+1}`} className="justify-self-start"><span aria-hidden="true">×</span><span className="ml-1">Remove</span></Button>
        </div>)}
        {!draft.items.length&&!chosen.length&&<p className="py-5 text-sm text-slate-500">Add an item to begin your invoice.</p>}
        <Button variant="quiet" type="button" disabled={draft.items.length>=1000} onClick={()=>setDraft({...draft,items:[...draft.items,blank()]})} className="mt-3">+ Add custom item</Button>
      </section>
      <div className="mt-7 grid min-w-0 gap-8 border-t border-slate-200 pt-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4"><h2 className="text-base font-semibold">Notes &amp; terms</h2>{(["notes","terms"] as const).map(key=><label key={key} className="block text-sm font-medium">{key==="notes"?"Notes":"Terms"} <span className="font-normal text-secondary">(optional)</span><Textarea rows={2} maxLength={10000} className={input} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</div>
        <div className="nexa-form-summary min-w-0"><h2 className="mb-4 text-base font-semibold">Financial summary</h2><dl className="space-y-3 text-sm">{[["Subtotal",preview],["Tax",taxTotal],["Total",preview===null?null:preview+taxTotal]].map(([label,value])=><div key={label} className={`flex justify-between gap-4 ${label==="Total"?"border-t border-slate-200 pt-4 text-xl font-semibold":"text-slate-600"}`}><dt>{label}</dt><dd className="min-w-0 whitespace-nowrap text-right tabular-nums">{value===null?"—":formatMoney(value as number)}</dd></div>)}</dl><p className="mt-3 text-right text-xs text-secondary">Estimated total · USD</p></div>
      </div>
    </fieldset>
    <div className="nexa-form-actions"><p className="text-sm text-slate-500">You can edit this invoice after saving.</p>{editing&&!frozen&&<ButtonLink variant="secondary" href={`/invoices/${editing.invoiceId}`}>Cancel</ButtonLink>}<Button variant="primary" disabled={!ready||pending||!!state.invoiceId||!snapshot||loading||mustRefresh} className="w-full sm:w-auto">{pending?"Saving…":state.invoiceId?"Opening invoice…":restored||state.uncertain?"Retry same submission":editing?"Save Changes":"Save Draft"}</Button></div>
  </form>;
}
