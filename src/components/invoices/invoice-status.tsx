"use client";
import { useActionState,useState } from "react";
import { useRouter } from "next/navigation";
import { changeInvoiceStatus } from "@/actions/invoices";
export function InvoiceStatus({id,status,updatedAt}:{id:string;status:string;updatedAt:string}) {
 const [open,setOpen]=useState(false);const router=useRouter();
 const [state,action,pending]=useActionState(async(previous:Awaited<ReturnType<typeof changeInvoiceStatus>>,form:FormData)=>{const result=await changeInvoiceStatus(previous,form);router.refresh();return result;},{});
 if(status!=='draft'&&status!=='ready')return null;
 const label=status==='draft'?'Mark Ready':'Move to Draft';
 return <section className="mt-6 flex min-w-0 justify-end" aria-label="Invoice workflow">
  {!open?<button onClick={()=>setOpen(true)} className="w-full rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold sm:w-auto">{label}</button>:<form action={action} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white p-5">
   <input type="hidden" name="invoice_id" value={id}/><input type="hidden" name="updated_at" value={updatedAt}/><input type="hidden" name="target" value={status==='draft'?'ready':'draft'}/><input type="hidden" name="confirmed" value="yes"/>
   <h2 className="font-semibold">{status==='draft'?'Mark invoice ready?':'Move invoice to Draft?'}</h2><p className="mt-2 text-sm text-slate-600">{status==='draft'?'This marks the invoice as ready for sending, but it remains editable.':'The invoice remains editable. This does not change its financial details.'}</p>
   {state.message&&<p role="status" className="mt-3 text-sm">{state.message}</p>}
   <div className="mt-4 flex flex-wrap justify-end gap-3"><button type="button" disabled={pending} onClick={()=>setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">Cancel</button><button disabled={pending} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{pending?'Saving…':label}</button></div>
  </form>}
 </section>;
}
