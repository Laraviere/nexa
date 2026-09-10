"use client";
import { useActionState } from "react";
import { finalizeInvoice } from "@/actions/invoices";
export function FinalizeInvoice({id}:{id:string}) {
  const [state,action,pending] = useActionState(finalizeInvoice,{});
  return <details className="mt-6 rounded-xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-cyan-800">Finalize invoice</summary><form action={action} className="mt-4 space-y-4"><input type="hidden" name="invoice_id" value={id}/><p className="text-sm text-slate-600">Finalization records this invoice as issued. It does not send an email.</p><label className="flex items-start gap-3 text-sm"><input required disabled={pending} type="checkbox" name="confirmed" value="yes" className="mt-1"/>Finalized invoices cannot be edited.</label>{state.message&&<p role="status" className="text-sm text-slate-700">{state.message}</p>}<button disabled={pending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending?"Finalizing…":"Confirm finalization"}</button></form></details>;
}
