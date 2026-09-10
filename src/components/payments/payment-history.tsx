import { formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { paymentMethods, type Payment } from "@/lib/payments/model";
import { VoidPayment } from "./void-payment";
export function PaymentHistory({payments}:{payments:Payment[]}){
  return <section aria-labelledby="payment-history" className="mt-8"><h2 id="payment-history" className="text-lg font-semibold">Payment History</h2>
    {!payments.length?<p className="mt-3 text-sm text-slate-500">No payments recorded.</p>:<div className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-5">{payments.map(payment=><article key={payment.id} className="min-w-0 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{formatBusinessDate(payment.payment_date)}</p><p className="mt-1 break-words text-sm text-slate-600">{paymentMethods[payment.payment_method as keyof typeof paymentMethods]??payment.payment_method}{payment.reference&&` · ${payment.reference}`}</p></div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold tabular-nums">{formatMoney(payment.amount)}</span>{payment.voided_at&&<span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Void</span>}</div></div>
      {payment.notes&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-500">{payment.notes}</p>}
      {payment.voided_at?<p className="mt-2 break-words text-xs text-slate-500">Void reason: {payment.void_reason}</p>:<VoidPayment paymentId={payment.id}/>}
    </article>)}</div>}
  </section>;
}
