"use client";
import { ConfirmationPanel } from "@/components/ui/confirmation-panel";
import { InlineNotice } from "@/components/ui/feedback";
import { surfaceStyles } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { voidPayment } from "@/actions/payments";
import type { PaymentState } from "@/lib/payments/model";
export function VoidPayment({paymentId}:{paymentId:string}){
  const [open,setOpen]=useState(false);const router=useRouter();
  const [state,action,pending]=useActionState(async(previous:PaymentState,form:FormData)=>{const result=await voidPayment(previous,form);if(result.success){setOpen(false);router.refresh();}return result;},{});
  return <div className="mt-3">{!open?<Button variant="quiet" onClick={()=>setOpen(true)} className="underline underline-offset-4">Void payment</Button>:<form action={action} className={surfaceStyles()}>
    <ConfirmationPanel destructive title="Void this payment?" description="This corrects the recorded payment and preserves its history. It does not issue a refund.">
    <input type="hidden" name="payment_id" value={paymentId}/><input type="hidden" name="confirmed" value="yes"/>
    <label className="mt-3 block text-sm font-medium">Reason<Textarea autoFocus required disabled={pending} name="reason" maxLength={2000} rows={2} className="mt-1 block w-full"/></label>
    {state.message&&<InlineNotice tone="info" role="status" className="mt-3">{state.message}</InlineNotice>}
    <div className="mt-3 flex flex-wrap justify-end gap-3"><Button variant="secondary" type="button" disabled={pending} onClick={()=>setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={pending}>{pending?"Voiding…":"Confirm void"}</Button></div>
  </ConfirmationPanel></form>}</div>;
}
