"use client";
import { InlineNotice } from "@/components/ui/feedback";
import { SectionHeading, surfaceStyles } from "@/components/ui/surface";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveQuote } from "@/actions/quotes";
import { quoteInput, type QuoteDraft, type QuoteState } from "@/lib/quotes/model";
import { units, previewTotal, type Line } from "@/lib/invoices/model";
import { formatMoney } from "@/lib/billing/model";
const input="mt-1 w-full min-w-0";
const blank=():Line=>({description:"",quantity:"1",unit:"each",unit_rate:""});
export function QuoteForm({customers,initial,today,requestId:initialRequestId,owner}:{customers:{id:string;company_name:string}[];initial?:QuoteDraft;today:string;requestId:string;owner:string}) {
 const router=useRouter();
 const key=`nexa.quote.pending.${owner}.${initial?.quote_id??"new"}`;
 const [draft,setDraft]=useState<QuoteDraft>(initial??{customer_id:"",issue_date:today,expiration_date:"",notes:"",terms:"",items:[blank()]});
 const [requestId,setRequestId]=useState(initialRequestId);
 const [ready,setReady]=useState(false);const [restored,setRestored]=useState(false);const inFlight=useRef(false);
 // Restore only a previously submitted request, so retries retain their identity.
 /* eslint-disable react-hooks/set-state-in-effect */
 useEffect(()=>{
  try{const stored=sessionStorage.getItem(key);if(stored){const value=JSON.parse(stored);if(quoteInput(value.draft,value.requestId).args){setDraft(value.draft);setRequestId(value.requestId);setRestored(true);}}}catch{/* Saving below requires recovery storage. */}
  setReady(true);
 },[key]);
 /* eslint-enable react-hooks/set-state-in-effect */
 const [state,action,pending]=useActionState<QuoteState,FormData>(async(previous,form)=>{
  const check=quoteInput(draft,requestId);
  if(!check.args){inFlight.current=false;return {message:check.message};}
  try{sessionStorage.setItem(key,JSON.stringify({draft,requestId}));}catch{inFlight.current=false;return {message:"Allow browser session storage to safely save this quote."};}
  try{
   const result=await saveQuote(previous,form);
   if(!result.uncertain){sessionStorage.removeItem(key);setRestored(false);if(!result.quoteId)setRequestId(crypto.randomUUID());}
   return result;
  }catch{return {message:"Connection interrupted. Retry this same submission.",uncertain:true};}
  finally{inFlight.current=false;}
 },{});
 useEffect(()=>{if(state.quoteId){router.replace(`/quotes/${state.quoteId}`);router.refresh();}},[state.quoteId,router]);
 const frozen=pending||restored||!!state.uncertain||!!state.quoteId;
 const total=previewTotal(draft.items);
 function line(index:number,field:keyof Line,value:string){setDraft(d=>({...d,items:d.items.map((l,i)=>i===index?{...l,[field]:value}:l)}));}
 return <form action={action} onSubmit={e=>{if(inFlight.current)e.preventDefault();else inFlight.current=true;}} className="nexa-form-page mt-6">
  <input type="hidden" name="request_id" value={requestId}/><input type="hidden" name="payload" value={JSON.stringify(draft)}/>
  <fieldset disabled={!ready||frozen} className={surfaceStyles("standard", "min-w-0 space-y-6")}>
   <section className="nexa-form-section"><SectionHeading>Quote details</SectionHeading><div className="nexa-form-grid"><label className="text-sm font-medium">Customer<Select required disabled={!!initial} className={input} value={draft.customer_id} onChange={e=>setDraft({...draft,customer_id:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</Select></label>
   <FormField id="quote-date" label="Quote date"><Input required type="date" className={input} value={draft.issue_date} onChange={e=>setDraft({...draft,issue_date:e.target.value})}/></FormField>
   <label className="text-sm font-medium">Expiration date <span className="font-normal text-slate-500">(optional)</span><Input type="date" min={draft.issue_date} className={input} value={draft.expiration_date} onChange={e=>setDraft({...draft,expiration_date:e.target.value})}/><span className="mt-1 block text-xs text-slate-500">Leave blank for no expiration. Valid through the selected date.</span></label></div></section>
   <section className="nexa-form-section"><SectionHeading>Line items</SectionHeading>{draft.items.map((item,index)=><div key={index} className="nexa-edit-line">
    <label className="text-sm font-medium">Description<Textarea required className={input} value={item.description} onChange={e=>line(index,"description",e.target.value)}/></label>
    <label className="text-sm font-medium">Quantity<Input required inputMode="decimal" className={input} value={item.quantity} onChange={e=>line(index,"quantity",e.target.value)}/></label>
    <label className="text-sm font-medium">Unit<Select className={input} value={item.unit} onChange={e=>line(index,"unit",e.target.value)}>{Object.entries(units).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select></label>
    <label className="text-sm font-medium">Rate<Input required inputMode="decimal" className={input} value={item.unit_rate} onChange={e=>line(index,"unit_rate",e.target.value)}/></label>
    <div className="text-sm"><p className="font-medium">Line total</p><p className="mt-3 tabular-nums">{previewTotal([item])===null?"—":formatMoney(previewTotal([item])!)}</p></div>
    <Button variant="quiet" type="button" aria-label={`Remove line ${index+1}`} disabled={draft.items.length===1} onClick={()=>setDraft({...draft,items:draft.items.filter((_,i)=>i!==index)})} className="justify-self-start">Remove line</Button>
   </div>)}<Button variant="quiet" type="button" disabled={draft.items.length>=1000} onClick={()=>setDraft({...draft,items:[...draft.items,blank()]})} className="mt-4">+ Add line item</Button></section>
   <div className="nexa-form-summary"><p className="text-sm text-slate-500">Estimated total</p><p className="mt-1 text-xl font-semibold tabular-nums">{total===null?"—":formatMoney(total)}</p></div>
   <section className="nexa-form-section"><SectionHeading>Notes &amp; terms</SectionHeading><div className="nexa-form-grid"><label className="text-sm font-medium">Notes<Textarea className={input} rows={4} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><label className="text-sm font-medium">Terms<Textarea className={input} rows={4} value={draft.terms} onChange={e=>setDraft({...draft,terms:e.target.value})}/></label></div></section>
  </fieldset>
  {state.message&&<InlineNotice tone="error" role="alert" className="mt-4">{state.message}</InlineNotice>}
  {restored&&<p role="status" className="mt-4 text-sm text-slate-600">A previous submission needs confirmation. Retry it to retrieve or save the same quote.</p>}
  <div className="nexa-form-actions"><ButtonLink variant="secondary" href={initial?`/quotes/${initial.quote_id}`:"/quotes"} className="text-center">Cancel</ButtonLink><Button variant="primary" disabled={!ready||pending||!!state.quoteId}>{pending?"Saving…":restored||state.uncertain?"Retry same submission":initial?"Save Changes":"Save Draft"}</Button></div>
 </form>;
}
