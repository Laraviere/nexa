import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { styles,Columns,descriptionParts,formatInvoiceQuantity } from "@/lib/invoices/pdf/document";
import { invoiceBusiness } from "@/lib/invoices/pdf/business";
import { formatBusinessDate,formatMoney } from "@/lib/billing/model";
import { quoteContact,quoteLines,quoteStatus,quoteStatuses,type Quote } from "./model";
export function QuoteDocument({quote:q,today}:{quote:Quote;today:string}) {
 const status=quoteStatuses[quoteStatus(q,today) as keyof typeof quoteStatuses];
 return <Document title={`Nexa Quote Q-${q.quote_number}`} author={invoiceBusiness.name} subject="Quote" language="en-US"><Page size="LETTER" style={styles.page}>
  <View style={styles.running} fixed><View><Text style={styles.brand}>{invoiceBusiness.name}</Text>{invoiceBusiness.contactLines.map((line,i)=><Text key={i} style={styles.contact}>{line}</Text>)}</View><View style={styles.identity}><Text style={styles.title}>QUOTE</Text><Text style={styles.number}>Q-{q.quote_number}</Text><Text style={styles.status}>{status}</Text></View></View>
  <View style={styles.information}><View style={styles.billTo}><Text style={styles.label} minPresenceAhead={30}>PREPARED FOR</Text><Text style={styles.customer}>{q.company_name_snapshot}</Text>{quoteContact(q).map((line,i)=><Text key={i} style={styles.contact}>{line}</Text>)}</View><View style={styles.dates}><Text style={styles.label}>QUOTE DATE</Text><Text style={styles.dateValue}>{formatBusinessDate(q.quote_date)}</Text>{q.expiration_date&&<><Text style={[styles.label,{marginTop:17}]}>VALID THROUGH</Text><Text style={styles.dateValue}>{formatBusinessDate(q.expiration_date)}</Text></>}</View></View>
  <View fixed style={{position:"absolute",top:103,left:42,right:42}} render={({pageNumber})=>pageNumber>1?<Columns/>:null}/><Columns/>
  {quoteLines(q.items).flatMap((item,i)=>descriptionParts(item.description).map((description,index)=><View key={`${i}:${index}`} style={styles.row} wrap={false}><Text style={styles.description}>{description}</Text><Text style={styles.quantity}>{index===0?formatInvoiceQuantity(Number(item.quantity),item.unit):""}</Text><Text style={styles.rate}>{index===0?formatMoney(Number(item.unit_rate)):""}</Text><Text style={styles.amount}>{index===0?formatMoney(Number(item.amount)):""}</Text></View>))}
  <View style={styles.totals} wrap={false}><View style={styles.totalRow}><Text>Subtotal</Text><Text>{formatMoney(q.subtotal??0)}</Text></View><View style={[styles.totalRow,styles.grandTotal]}><Text>Total</Text><Text>{formatMoney(q.total??0)}</Text></View></View>
  {[["NOTES",q.notes],["TERMS",q.terms]].map(([label,value])=>value?.trim()&&<View key={label} style={styles.prose}><Text style={styles.label} minPresenceAhead={25}>{label}</Text><Text style={styles.proseBody} orphans={2} widows={2}>{value}</Text></View>)}
  <View style={styles.footer} fixed><Text>{invoiceBusiness.name}</Text><Text render={({pageNumber,totalPages})=>`Quote Q-${q.quote_number}  ·  ${pageNumber} / ${totalPages}`}/></View>
 </Page></Document>;
}
export async function renderQuotePdf(quote:Quote,today:string) {return renderToBuffer(<QuoteDocument quote={quote} today={today}/>);}
