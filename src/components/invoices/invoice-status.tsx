"use client";
import { ConfirmationPanel } from "@/components/ui/confirmation-panel";
import { InlineNotice } from "@/components/ui/feedback";
import { surfaceStyles } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { useActionState,useState } from "react";
import { useRouter } from "next/navigation";
import { changeInvoiceStatus } from "@/actions/invoices";
export function InvoiceStatus({id,status,updatedAt}:{id:string;status:string;updatedAt:string}) {
 const [open,setOpen]=useState(false);const router=useRouter();
 const [state,action,pending]=useActionState(async(previous:Awaited<ReturnType<typeof changeInvoiceStatus>>,form:FormData)=>{const result=await changeInvoiceStatus(previous,form);router.refresh();return result;},{});
 if(status!=='draft'&&status!=='ready')return null;
 const label=status==='draft'?'Mark Ready':'Move to Draft';
 return <section className="mt-6 flex min-w-0 justify-end" aria-label="Invoice workflow">
  {!open?<Button variant="primary" onClick={()=>setOpen(true)} className="w-full sm:w-auto">{label}</Button>:<form action={action} className={surfaceStyles("standard", "w-full min-w-0")}>
   <input type="hidden" name="invoice_id" value={id}/><input type="hidden" name="updated_at" value={updatedAt}/><input type="hidden" name="target" value={status==='draft'?'ready':'draft'}/><input type="hidden" name="confirmed" value="yes"/>
   <ConfirmationPanel title={status==='draft'?'Mark invoice ready?':'Move invoice to Draft?'} description={status==='draft'?'This marks the invoice as ready for sending, but it remains editable.':'The invoice remains editable. This does not change its financial details.'}>
   {state.message&&<InlineNotice tone="info" role="status" className="mt-3">{state.message}</InlineNotice>}
   <div className="mt-4 flex flex-wrap justify-end gap-3"><Button variant="secondary" type="button" disabled={pending} onClick={()=>setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending}>{pending?'Saving…':label}</Button></div>
  </ConfirmationPanel></form>}
 </section>;
}
