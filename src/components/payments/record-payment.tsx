"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/actions/payments";
import { enabledMethods, paymentMethods, type PaymentSettings, type PaymentState } from "@/lib/payments/model";
const input = "mt-1.5 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-50";
export function RecordPayment({invoiceId,owner,balance,today,settings,canRecord}:{invoiceId:string;owner:string;balance:number;today:string;settings:PaymentSettings;canRecord:boolean}) {
  const router=useRouter();const [open,setOpen]=useState(false);const [ready,setReady]=useState(false);const [pending,setPending]=useState(false);const [state,setState]=useState<PaymentState>({});const [key,setKey]=useState("");
  const [saved,setSaved]=useState<Record<string,string>|null>(null);
  const submission=useRef<Record<string,string>|null>(null);const busy=useRef(false);
  const storageKey=`nexa:payment:${owner}:${invoiceId}`;
  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{
      if(!active)return;
      try {const raw=sessionStorage.getItem(storageKey);if(raw){const saved=JSON.parse(raw);if(saved.invoice_id===invoiceId&&typeof saved.request_id==='string'){submission.current=saved;setSaved(saved);setKey(saved.request_id);setOpen(true);setState({uncertain:true,message:"A payment submission needs confirmation. Retry the same payment safely."});}}setReady(true);}
      catch {setState({message:"Enable session storage and reload before recording a payment."});}
    });return()=>{active=false;};
  },[storageKey,invoiceId]);
  const options=enabledMethods(state.settings??settings);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy.current)return;
    const payload=submission.current??Object.fromEntries([...new FormData(event.currentTarget)].map(([name,value])=>[name,String(value)]));
    try {sessionStorage.setItem(storageKey,JSON.stringify(payload));}catch{setState({message:"Unable to protect this submission for retry. Enable session storage and try again."});return;}
    submission.current=payload;busy.current=true;setPending(true);
    try {
      const form=new FormData();Object.entries(payload).forEach(([name,value])=>form.set(name,value));
      const result=await recordPayment({},form);setState(result);
      if(result.success){sessionStorage.removeItem(storageKey);submission.current=null;setOpen(false);router.refresh();}
      else if(!result.uncertain){sessionStorage.removeItem(storageKey);submission.current=null;router.refresh();}
    }catch{setState({uncertain:true,message:"Connection interrupted. Retry this same payment to confirm its result."});}
    finally{busy.current=false;setPending(false);}
  }
  // An uncertain submission may still confirm an existing payment after status changes.
  const showForm=open&&(canRecord||state.uncertain);
  return <div className="mt-4 min-w-0">
    {!showForm&&canRecord&&<button disabled={!ready} onClick={()=>{setSaved(null);setKey(crypto.randomUUID());setState({});setOpen(true);}} className="block w-full rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold disabled:opacity-50 sm:ml-auto sm:w-auto">Mark as Paid</button>}
    {!showForm&&state.message&&<p role="status" className="mt-3 text-sm">{state.message}</p>}
    {showForm&&<form onSubmit={submit} aria-label="Record invoice payment" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
      <h3 className="font-semibold">Record payment</h3><p className="mt-1 text-xs text-slate-500">Record the full balance or a partial payment.</p>
      <fieldset disabled={pending||state.uncertain} className="mt-4 min-w-0 space-y-4">
        <legend className="sr-only">Payment details</legend><input type="hidden" name="invoice_id" value={invoiceId}/><input type="hidden" name="request_id" value={key}/>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="min-w-0 text-sm font-medium">Amount<input className={input} name="amount" autoFocus required inputMode="decimal" type="text" pattern="[0-9]+([.][0-9]{1,2})?" defaultValue={saved?.amount??balance.toFixed(2)}/></label><label className="min-w-0 text-sm font-medium">Payment date<input className={input} name="payment_date" type="date" required defaultValue={saved?.payment_date??today}/></label></div>
        <fieldset><legend className="mb-2 text-sm font-medium">Payment method</legend><div className="flex flex-wrap gap-2">{options.map(method=><label key={method} className="min-w-20 flex-1 cursor-pointer"><input className="peer sr-only" name="payment_method" type="radio" value={method} required defaultChecked={(saved?.payment_method??options[0])===method}/><span className="block rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-medium peer-checked:border-cyan-700 peer-checked:bg-cyan-50 peer-checked:text-cyan-900 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-700">{paymentMethods[method]}</span></label>)}</div></fieldset>
        <label className="block text-sm font-medium">Reference <span className="font-normal text-slate-500">(optional)</span><input className={input} name="reference" maxLength={500} defaultValue={saved?.reference??""} placeholder="Check, transaction or receipt number"/></label>
        <label className="block text-sm font-medium">Notes <span className="font-normal text-slate-500">(optional)</span><textarea className={input} name="notes" rows={2} maxLength={10000} defaultValue={saved?.notes??""}/></label>
      </fieldset>
      {state.message&&<p role="status" className="mt-3 text-sm">{state.message}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-3"><button type="button" disabled={pending||state.uncertain} onClick={()=>{setOpen(false);setState({});}} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm disabled:opacity-50">Cancel</button><button disabled={pending} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{pending?"Recording…":state.uncertain?"Retry same payment":"Record Payment"}</button></div>
    </form>}
  </div>;
}
