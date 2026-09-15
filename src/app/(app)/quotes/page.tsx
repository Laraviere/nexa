import { ListHeader, FilterToolbar, ListPagination } from "@/components/ui/list";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import Link from "next/link";
import { customerClient } from "@/lib/customers/server";
import { businessDate, formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { quoteStatus } from "@/lib/quotes/model";
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
 return <div className="nexa-list-workspace">
 <ListHeader title="Quotes" description="Prepare proposals and convert accepted work into invoices." action={<ButtonLink variant="primary" href="/quotes/new">Create Quote</ButtonLink>}/>
 <FilterToolbar className="nexa-filter-row" aria-label="Quote search"><label className="flex-1 font-medium">Search quotes<Input name="q" defaultValue={search} placeholder="Customer or Q-number" className="mt-1 block w-full"/></label><Button variant="secondary">Search</Button>{search&&<Link href="/quotes" className="nexa-list-link">Clear search</Link>}</FilterToolbar>
 {!data.length?<div className="nexa-empty"><EmptyState title={search?"No quotes match this search.":"No quotes found."} action={<ButtonLink href={search||page>1?"/quotes":"/quotes/new"}>{search||page>1?"View quotes":"Create Quote"}</ButtonLink>}/></div>:<>
 <div className="nexa-table-frame" tabIndex={0} role="region" aria-label="Quotes table"><table className="nexa-table"><caption className="sr-only">Quotes matching current search</caption><colgroup><col style={{width:"10%"}}/><col style={{width:"28%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/><col style={{width:"12%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr>{["Quote","Customer","Quote date","Expiration","Status","Total"].map(h=><th scope="col" key={h} className={h==="Total"?"text-right":""}>{h}</th>)}</tr></thead><tbody>{data.map(q=><tr key={q.id}><td><Link href={`/quotes/${q.id}`} className="nexa-list-link">Q-{q.quote_number}</Link></td><td>{q.company_name_snapshot}</td><td className="nexa-date">{formatBusinessDate(q.quote_date)}</td><td className="nexa-date">{q.expiration_date?formatBusinessDate(q.expiration_date):"—"}</td><td><StatusBadge domain="quote" status={quoteStatus(q,today)}/></td><td className="nexa-money">{formatMoney(q.total??0)}</td></tr>)}</tbody></table></div>
 <ul className="nexa-records" aria-label="Quote cards">{data.map(q=><li key={q.id}><Link href={`/quotes/${q.id}`} className="nexa-record"><div className="nexa-record-heading"><strong>Q-{q.quote_number}</strong><strong className="nexa-money">{formatMoney(q.total??0)}</strong></div><p className="mt-1 text-secondary">{q.company_name_snapshot}</p><div className="nexa-record-meta"><StatusBadge domain="quote" status={quoteStatus(q,today)}/><span>Quote date: {formatBusinessDate(q.quote_date)}</span>{q.expiration_date&&<span>Expires: {formatBusinessDate(q.expiration_date)}</span>}</div></Link></li>)}</ul></>}
 <ListPagination label="Quote pages" previousHref={page>1?href(page-1):undefined} nextHref={page*25<(count??0)?href(page+1):undefined}>{count??0} quotes · Page {page}{(count??0)>0&&` of ${Math.ceil((count??0)/25)}`}</ListPagination></div>;
}
