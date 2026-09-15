import { Surface, SectionHeading } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { paymentMethods, type Payment } from "@/lib/payments/model";
import { VoidPayment } from "./void-payment";
export function PaymentHistory({payments}:{payments:Payment[]}){
  return <section aria-labelledby="payment-history" className="mt-8"><SectionHeading id="payment-history">Payment History</SectionHeading>
    {!payments.length?<EmptyState title="No payments recorded."/>:<Surface padding="compact" className="mt-3 divide-y divide-slate-200">{payments.map(payment=><article key={payment.id} className="min-w-0 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{formatBusinessDate(payment.payment_date)}</p><p className="mt-1 break-words text-sm text-slate-600">{paymentMethods[payment.payment_method as keyof typeof paymentMethods]??payment.payment_method}{payment.reference&&` · ${payment.reference}`}</p></div><div className="flex flex-wrap items-center gap-2"><span className="whitespace-nowrap font-semibold tabular-nums">{formatMoney(payment.amount)}</span><StatusBadge domain="paymentRecord" status={payment.voided_at?"voided":"active"}/></div></div>
      {payment.notes&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-500">{payment.notes}</p>}
      {payment.voided_at?<p className="mt-2 break-words text-sm text-secondary">Void reason: {payment.void_reason}</p>:<VoidPayment paymentId={payment.id}/>}
    </article>)}</Surface>}
  </section>;
}
