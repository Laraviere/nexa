"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { voidPayment } from "@/actions/payments";
import type { PaymentState } from "@/lib/payments/model";
export function VoidPayment({paymentId}:{paymentId:string}){
  const [open,setOpen]=useState(false);const router=useRouter();
  const [state,action,pending]=useActionState(async(previous:PaymentState,form:FormData)=>{const result=await voidPayment(previous,form);if(result.success){setOpen(false);router.refresh();}return result;},{});
  return <div className="mt-3">{!open?<button onClick={()=>setOpen(true)} className="text-sm font-medium text-slate-600 underline underline-offset-4">Void payment</button>:<form action={action} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
    <h4 className="text-sm font-semibold">Void this payment?</h4><p className="mt-1 text-xs text-slate-500">This corrects the recorded payment and preserves its history. It does not issue a refund.</p>
    <input type="hidden" name="payment_id" value={paymentId}/><input type="hidden" name="confirmed" value="yes"/>
    <label className="mt-3 block text-sm font-medium">Reason<textarea autoFocus required disabled={pending} name="reason" maxLength={2000} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label>
    {state.message&&<p role="status" className="mt-3 text-sm">{state.message}</p>}
    <div className="mt-3 flex flex-wrap justify-end gap-3"><button type="button" disabled={pending} onClick={()=>setOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Cancel</button><button disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending?"Voiding…":"Confirm void"}</button></div>
  </form>}</div>;
}
