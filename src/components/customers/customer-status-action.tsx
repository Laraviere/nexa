"use client";

import { useActionState, useState } from "react";
import { setCustomerActive } from "@/actions/customers";
import type { CustomerFormState } from "@/lib/customers/validation";

export function CustomerStatusAction({ id, active }: { id: string; active: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(setCustomerActive.bind(null, id, !active), {} as CustomerFormState);
  const buttonClass = "rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60";
  return <div className="mt-8 border-t border-slate-200 pt-6">
    <h2 className="font-semibold">Customer status</h2>
    <p className="mt-2 mb-4 text-sm text-slate-600">{active ? "Archive customers you no longer work with. Their information stays available and they can be reactivated anytime." : "This customer is archived and hidden from the default active list."}</p>
    {active && !confirming ? <button type="button" className={buttonClass} onClick={() => setConfirming(true)}>Archive customer</button> : <form action={action} className="space-y-3">
      {active && <p className="text-sm font-medium text-slate-800">Archive this customer? They will be removed from the active list.</p>}
      {active && <input type="hidden" name="confirm_archive" value="yes" />}
      <div className="flex gap-3"><button disabled={pending} className={buttonClass}>{pending ? "Updating…" : active ? "Confirm archive" : "Reactivate customer"}</button>{active && <button type="button" disabled={pending} className={buttonClass} onClick={() => setConfirming(false)}>Cancel</button>}</div>
    </form>}
    {state.message && <p role="status" className="mt-3 text-sm text-slate-700">{state.message}</p>}
  </div>;
}
