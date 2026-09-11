import Link from "next/link";
import { customerClient } from "@/lib/customers/server";
import { businessDate, formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { quoteStatus, quoteStatuses } from "@/lib/quotes/model";
export default async function QuotesPage({searchParams}:{searchParams:Promise<{q?:string;page?:string}>}) {
 const params=await searchParams;const search=typeof params.q==="string"?params.q.trim().slice(0,200):"";
 const page=/^\d+$/.test(params.page??"")?Math.min(100000,Math.max(1,Number(params.page))):1;
 const client=await customerClient();
 let query=client.from("quotes").select("id,quote_number,company_name_snapshot,quote_date,expiration_date,status,total",{count:"exact"});
 const number=search.match(/^(?:Q-)?(\d+)$/i);
 if(number&&Number(number[1])<=2147483647)query=query.eq("quote_number",Number(number[1]));
 else if(search)query=query.ilike("company_name_snapshot",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
 const {data,error,count}=await query.order("quote_date",{ascending:false}).order("id").range((page-1)*25,page*25-1);
 if(error)throw new Error("Unable to load quotes.");
 const today=businessDate();
 const href=(n:number)=>`/quotes?${new URLSearchParams({q:search,page:String(n)})}`;
 return <div><header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-3xl font-semibold tracking-tight">Quotes</h1><p className="mt-2 text-slate-600">Prepare proposals and convert accepted work into invoices.</p></div><Link href="/quotes/new" className="rounded-lg bg-cyan-400 px-5 py-3 text-center font-semibold">Create Quote</Link></header>
 <form className="my-6 flex flex-col gap-3 sm:flex-row"><label className="flex-1 text-sm font-medium">Search quotes<input name="q" defaultValue={search} placeholder="Customer or Q-number" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label><button className="self-end rounded-lg border border-slate-300 bg-white px-5 py-2 font-medium">Search</button></form>
 <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{["Quote","Customer","Quote date","Expiration","Status","Total"].map(h=><th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead><tbody>{data.map(q=><tr key={q.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-4 py-4"><Link href={`/quotes/${q.id}`} className="font-semibold text-cyan-700">Q-{q.quote_number}</Link></td><td className="px-4 py-4">{q.company_name_snapshot}</td><td className="whitespace-nowrap px-4 py-4">{formatBusinessDate(q.quote_date)}</td><td className="whitespace-nowrap px-4 py-4">{q.expiration_date?formatBusinessDate(q.expiration_date):"—"}</td><td className="px-4 py-4"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">{quoteStatuses[quoteStatus(q,today) as keyof typeof quoteStatuses]}</span></td><td className="whitespace-nowrap px-4 py-4 tabular-nums">{formatMoney(q.total??0)}</td></tr>)}</tbody></table>{!data.length&&<p className="p-6 text-sm text-slate-500">No quotes found.</p>}</div>
 <nav aria-label="Quote pages" className="mt-5 flex items-center justify-between text-sm"><span>{count??0} quotes · Page {page}</span><div className="flex gap-5">{page>1&&<Link href={href(page-1)} className="text-cyan-700">Previous</Link>}{page*25<(count??0)&&<Link href={href(page+1)} className="text-cyan-700">Next</Link>}</div></nav></div>;
}
