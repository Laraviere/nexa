import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardData } from "@/lib/dashboard/server";
import { formatBusinessDate,formatMoney } from "@/lib/billing/model";
import { formatDuration } from "@/lib/time/model";
import { paymentMethods,paymentStatuses } from "@/lib/payments/model";
import { DashboardTimer } from "./timer";

const focus="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-700";
const link=`text-sm font-medium text-cyan-800 hover:underline underline-offset-4 ${focus}`;
const row=`block rounded-lg py-3.5 hover:bg-slate-50 ${focus}`;
const amount="min-w-0 max-w-40 break-words text-right text-sm font-semibold tabular-nums text-slate-950";
const columns="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4";
const shortDate=(value:string)=>new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));

function Section({title,href,action,children}:{title:string;href:string;action:string;children:ReactNode}) {
  return <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3.5 sm:px-5">
      <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      <Link href={href} className={`shrink-0 text-xs font-medium text-slate-500 hover:text-cyan-800 hover:underline underline-offset-4 ${focus}`}>{action}</Link>
    </div>
    <div className="px-4 sm:px-5">{children}</div>
  </section>;
}
function Empty({children}:{children:ReactNode}) {return <p className="py-5 text-sm text-slate-500">{children}</p>;}

export function DashboardOverview({data:d}:{data:DashboardData}) {
  const month=new Intl.DateTimeFormat("en-US",{month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${d.dates.monthStart}T12:00:00Z`));
  const metrics=[{label:"Outstanding balance",value:d.outstanding===null?null:formatMoney(d.outstanding),note:"Open non-void invoices",href:"/invoices"},
    {label:"Ready invoices",value:String(d.readyCount),note:"Ready for payment activity",href:"/invoices?status=ready"},
    {label:"Payments this month",value:d.paymentsThisMonth===null?null:formatMoney(d.paymentsThisMonth),note:`${month} · Payments`,href:"/invoices"},
    {label:"Billable time this month",value:d.billableMinutes===null?null:formatDuration(d.billableMinutes),note:`${month} · Rounded time`,href:"/time"}];
  return <div className="mx-auto max-w-6xl space-y-5 [overflow-wrap:anywhere] px-5 py-8 sm:space-y-6 sm:px-8 sm:py-10">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Dashboard</h1>
      <p className="mt-2 text-sm text-slate-600">Overview of billing, payments, retainers, and time.</p>
      <p className="mt-1.5 text-xs text-slate-500">As of {formatBusinessDate(d.dates.today)} · New York</p>
    </header>
    <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
      {[["New Invoice","/invoices/new"],["Add Time Entry","/time/new"],[d.timer?"View Timer":"Start Timer","/time"],["New Customer","/customers/new"]].map(([label,href],i)=><Link key={label} href={href} className={`inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-medium ${focus} ${i===0?"border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100":"border-slate-200 text-slate-600 hover:bg-white hover:text-slate-950"}`}>{label}</Link>)}
    </nav>
    {d.timer&&<DashboardTimer key={d.timer.id+String(d.observedAt)} timer={d.timer} observedAt={d.observedAt}/>}
    <section aria-label="Business overview" className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m,index)=><Link href={m.href} key={m.label} className={`grid min-w-0 grid-rows-[2.5rem_auto_1fr] rounded-xl border p-4 ${focus} ${index===0?"border-cyan-300 bg-cyan-50/40 hover:border-cyan-500":"border-slate-200 bg-white hover:border-slate-300"}`}>
        <h2 className={`text-sm font-medium leading-5 ${index===0?"text-cyan-900":"text-slate-600"}`}>{m.label}</h2>
        <p className={`mt-1 break-words text-2xl leading-8 tracking-tight tabular-nums text-slate-950 ${index===0?"font-bold":"font-semibold"}`}>{m.value??"Unavailable"}</p>
        <p className="mt-3 min-h-8 self-end text-xs leading-4 text-slate-500">{m.value===null?"Too many records for a complete dashboard total. Open the full list.":m.note}</p>
      </Link>)}
    </section>
    <div className="grid items-start gap-5 sm:gap-6 lg:grid-cols-2">
      <Section title="Invoices needing attention" href="/invoices" action="View all invoices">
        {!d.attentionComplete&&<p className="pt-4 text-sm text-amber-800">Invoice scan limit reached. This list may omit higher-priority invoices; view all invoices.</p>}
        {!d.attention.length?<Empty>No outstanding invoices.</Empty>:<ul className="divide-y divide-slate-100">{d.attention.map(i=>{
          const overdue=i.balance_due>0&&!!i.due_date&&i.due_date<d.dates.today;
          return <li key={i.id}><Link href={`/invoices/${i.id}`} className={row}>
            <div className={columns}>
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-950">Invoice #{i.invoice_number}</p><p className="mt-1 break-words text-sm text-slate-600">{i.company_name_snapshot}</p></div>
              <div className={amount}>{formatMoney(i.balance_due)}<span className="mt-1 block text-xs font-normal text-slate-500">due</span></div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-slate-500">
              {overdue&&<span className="rounded bg-amber-50 px-1.5 font-medium text-amber-800">Overdue</span>}
              <span>{i.status==="ready"?"Ready":i.status==="sent"?"Sent":"Draft"} · {paymentStatuses[i.payment_status as keyof typeof paymentStatuses]} · {i.due_date?`Due ${shortDate(i.due_date)}`:"No due date"}</span>
            </div>
          </Link></li>;
        })}</ul>}
      </Section>
      <Section title="Recent payments" href="/invoices" action="View invoices">
        {!d.payments.length?<Empty>No recent payments.</Empty>:<ul className="divide-y divide-slate-100">{d.payments.map(p=><li key={p.id}><Link href={`/invoices/${p.invoice_id}`} className={row}>
          <div className={columns}><p className="min-w-0 break-words text-sm font-medium text-slate-950">{p.invoices?.company_name_snapshot??"Customer"}</p><p className={amount}>{formatMoney(p.amount)}</p></div>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">Invoice #{p.invoices?.invoice_number} · {shortDate(p.payment_date)} · {paymentMethods[p.payment_method as keyof typeof paymentMethods]}</p>
        </Link></li>)}</ul>}
      </Section>
      <Section title="Retainer usage" href="/customers" action="View customers">
        {(!d.retainersComplete||d.retainerErrors.length>0)&&<p className="pt-4 text-sm text-amber-800">{!d.retainersComplete?"Checked the first 25 current retainers. ":""}{d.retainerErrors.length>0?`Usage unavailable for ${d.retainerErrors.join(", ")}. `:""}Open customer details to review.</p>}
        {!d.retainers.length?<Empty>{d.retainersComplete&&!d.retainerErrors.length?"No retainers need attention.":"No attention items in the available usage results."}</Empty>:<ul className="divide-y divide-slate-100">{d.retainers.map(r=><li key={r.customerId}><Link href={`/customers/${r.customerId}`} className={row}>
          <p className="break-words text-sm font-medium text-slate-950">{r.customer}</p>
          <p className="mt-1 text-sm tabular-nums text-slate-600">{formatDuration(r.usage.rounded_minutes_used)} used of {formatDuration(r.usage.included_minutes_available)} included</p>
          <p className="mt-1.5 text-xs leading-5 tabular-nums">{r.usage.overage_minutes>0?<><span className="font-semibold text-amber-800">{formatDuration(r.usage.overage_minutes)} overage</span><span className="text-slate-500"> · {formatDuration(r.usage.remaining_included_minutes)} remaining</span></>:<span className="font-medium text-amber-800">{formatDuration(r.usage.remaining_included_minutes)} remaining{r.usage.remaining_included_minutes===0?" · Allowance exhausted":""}</span>}</p>
        </Link></li>)}</ul>}
      </Section>
      <Section title="Recent time" href="/time" action="View all time">
        {!d.time.length?<Empty>No recent time entries.</Empty>:<ul className="divide-y divide-slate-100">{d.time.map(t=><li key={t.id} className="py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><Link href={`/customers/${t.customer_id}`} className={`${link} min-w-0 break-words`}>{t.customers?.company_name??"Customer"}</Link><span className="text-xs text-slate-500">{t.is_billable?"Billable":"Non-billable"}</span></div>
          <p className="mt-1 line-clamp-2 break-words text-sm text-slate-600">{t.description}</p>
          <p className="mt-1.5 text-xs leading-5 tabular-nums text-slate-500">{shortDate(t.work_date)} · {formatDuration(t.actual_minutes)} actual · {formatDuration(t.rounded_minutes)} billable</p>
        </li>)}</ul>}
      </Section>
    </div>
  </div>;
}
