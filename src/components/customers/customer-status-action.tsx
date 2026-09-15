"use client";
import { ConfirmationPanel } from "@/components/ui/confirmation-panel";
import { InlineNotice } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";

import { useActionState, useState } from "react";
import { setCustomerActive } from "@/actions/customers";
import type { CustomerFormState } from "@/lib/customers/validation";

export function CustomerStatusAction({ id, active }: { id: string; active: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(setCustomerActive.bind(null, id, !active), {} as CustomerFormState);
  return <div className="mt-8 border-t border-slate-200 pt-6">
    <h2 className="font-semibold">Customer status</h2>
    <p className="mt-2 mb-4 text-sm text-slate-600">{active ? "Archive customers you no longer work with. Their information stays available and they can be reactivated anytime." : "This customer is archived and hidden from the default active list."}</p>
    {active && !confirming ? <Button variant="secondary" type="button" onClick={() => setConfirming(true)}>Archive customer</Button> : <form action={action} className="space-y-3">
      <ConfirmationPanel destructive={active} title={active ? "Archive customer" : "Reactivate customer"}>
      {active && <p className="text-sm text-secondary">Archive this customer? They will be removed from the active list.</p>}
      {active && <input type="hidden" name="confirm_archive" value="yes" />}
      <div className="flex flex-wrap gap-3"><Button variant={active ? "destructive" : "primary"} disabled={pending}>{pending ? "Updating…" : active ? "Confirm archive" : "Reactivate customer"}</Button>{active && <Button variant="secondary" type="button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>}</div>
    </ConfirmationPanel></form>}
    {state.message && <InlineNotice tone="info" role="status" className="mt-3">{state.message}</InlineNotice>}
  </div>;
}
