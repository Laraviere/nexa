import { Document, Page, Text, View, StyleSheet, renderToBuffer, Font } from "@react-pdf/renderer";
import { formatBusinessDate, formatMoney } from "@/lib/billing/model";
import { statuses } from "@/lib/invoices/model";
import { invoiceBusiness } from "./business";
import type { InvoicePdfData } from "./data";

// Permit long identifiers/URLs to wrap without dropping text.
Font.registerHyphenationCallback(word => word.length > 24 ? word.match(/.{1,20}/gu) ?? [word] : [word]);
export function descriptionParts(text: string) {
  // Keep each table fragment small enough to stay together. Long descriptions
  // continue in subsequent fragments/pages; amounts appear only once.
  const parts: string[] = [];
  while (text.length > 600 || text.split("\n").length > 20) {
    const boundary = Math.max(text.lastIndexOf(" ", 600), text.lastIndexOf("\n", 600));
    const lineLimit = text.split("\n").slice(0, 20).join("\n").length + 1;
    const end = Math.min(boundary > 300 ? boundary + 1 : 600, lineLimit);
    parts.push(text.slice(0, end)); text = text.slice(end);
  }
  parts.push(text); return parts;
}

// Avoid inherited numeric lineHeight on fixed elements: repeated pagination
// can multiply it in React PDF. Keep the footer height explicit.
export const styles = StyleSheet.create({
  page: { paddingTop: 144, paddingBottom: 60, paddingHorizontal: 42, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },
  running: { position: "absolute", top: 30, left: 42, right: 42, height: 65, flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1.5, borderBottomColor: "#22b8cf", paddingBottom: 12 },
  brand: { fontSize: 25, fontFamily: "Helvetica-Bold", letterSpacing: -0.6 },
  identity: { alignItems: "flex-end" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", letterSpacing: 1.8, color: "#475569" },
  number: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 4 },
  status: { fontSize: 8, color: "#475569", marginTop: 5 },
  badge: { marginTop: 5, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#475569", backgroundColor: "#f1f5f9", paddingVertical: 3, paddingHorizontal: 6 },
  voidBadge: { color: "#9f1239", backgroundColor: "#fff1f2" },
  information: { flexDirection: "row", justifyContent: "space-between", marginBottom: 26 },
  billTo: { width: 310, paddingRight: 18 },
  dates: { width: 175, alignItems: "flex-end" },
  label: { fontSize: 8, color: "#64748b", marginBottom: 6, fontFamily: "Helvetica-Bold" },
  dateValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  customer: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 7 },
  contact: { fontSize: 9.5, color: "#475569", marginBottom: 3 },
  columns: { flexDirection: "row", backgroundColor: "#f8fafc", paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 0.6, borderBottomColor: "#cbd5e1", fontFamily: "Helvetica-Bold", fontSize: 8, color: "#475569" },
  row: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  description: { width: "46%", paddingRight: 12 },
  quantity: { width: "18%", textAlign: "right", paddingRight: 10 },
  rate: { width: "18%", textAlign: "right", paddingRight: 10 },
  amount: { width: "18%", textAlign: "right" },
  totals: { marginTop: 21, marginRight: 8, width: 230, alignSelf: "flex-end" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, color: "#475569" },
  grandTotal: { borderTopWidth: 1, borderTopColor: "#94a3b8", marginTop: 7, paddingTop: 12, fontSize: 18, fontFamily: "Helvetica-Bold", color: "#0f172a" },
  prose: { marginTop: 22, borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 12 },
  proseBody: { fontSize: 9.5, color: "#475569" },
  footer: { position: "absolute", bottom: 26, height: 20, left: 42, right: 42, borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 8, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#64748b" },
});
export function formatInvoiceQuantity(quantity: number, unit: string) {
  const value = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(quantity);
  if (unit === "flat") return quantity === 1 ? "Flat fee" : `${value} × Flat fee`;
  const labels: Record<string, [string, string]> = { hour: ["Hour", "Hours"], minute: ["Minute", "Minutes"], each: ["Each", "Each"], mile: ["Mile", "Miles"], month: ["Month", "Months"], custom: ["Custom", "Custom"] };
  return `${value} ${labels[unit]?.[quantity === 1 ? 0 : 1] ?? unit}`;
}
export function Columns() {
  return <View style={styles.columns}><Text style={styles.description}>DESCRIPTION</Text><Text style={styles.quantity}>QTY / UNIT</Text><Text style={styles.rate}>RATE</Text><Text style={styles.amount}>AMOUNT</Text></View>;
}
export function InvoiceDocument({ invoice: v, items, totals }: InvoicePdfData) {
  const address = [v.billing_address_line1_snapshot, v.billing_address_line2_snapshot,
    [v.billing_city_snapshot, v.billing_state_snapshot, v.billing_postal_code_snapshot].filter(Boolean).join(", "), v.billing_country_snapshot];
  return <Document title={`Nexa Invoice ${v.invoice_number}`} author={invoiceBusiness.name} subject="Invoice" language="en-US">
    <Page size="LETTER" style={styles.page}>
      <View style={styles.running} fixed>
        <View><Text style={styles.brand}>{invoiceBusiness.name}</Text>{invoiceBusiness.contactLines.map((line, i) => <Text key={i} style={styles.contact}>{line}</Text>)}</View>
        <View style={styles.identity}><Text style={styles.title}>INVOICE</Text><Text style={styles.number}>#{v.invoice_number}</Text>
          {v.status === "void" ? <Text style={[styles.badge, styles.voidBadge]}>VOID — Not payable</Text>
            : v.status === "draft" ? <Text style={styles.badge}>DRAFT — For review</Text>
            : <Text style={styles.status}>{statuses[v.status as keyof typeof statuses] ?? v.status}</Text>}
        </View>
      </View>
      <View style={styles.information}>
        <View style={styles.billTo}><Text style={styles.label} minPresenceAhead={30}>BILL TO</Text><Text style={styles.customer}>{v.company_name_snapshot}</Text>
          {[v.primary_contact_name_snapshot, v.email_snapshot, v.phone_snapshot, ...address].filter(Boolean).map((line, i) => <Text key={i} style={styles.contact}>{line}</Text>)}
        </View>
        <View style={styles.dates}><Text style={styles.label}>ISSUE DATE</Text><Text style={styles.dateValue}>{formatBusinessDate(v.issue_date)}</Text><Text style={[styles.label, { marginTop: 17 }]}>DUE DATE</Text><Text style={styles.dateValue}>{formatBusinessDate(v.due_date)}</Text></View>
      </View>
      <View fixed style={{ position: "absolute", top: 103, left: 42, right: 42 }} render={({ pageNumber }) => pageNumber > 1 ? <Columns /> : null} />
      <Columns />
      {items.flatMap(item => descriptionParts(item.description).map((description, index) => <View key={`${item.id}:${index}`} style={styles.row} wrap={false}>
        <Text style={styles.description}>{description}</Text><Text style={styles.quantity}>{index === 0 ? formatInvoiceQuantity(item.quantity, item.unit) : ""}</Text><Text style={styles.rate}>{index === 0 ? formatMoney(item.unit_rate) : ""}</Text><Text style={styles.amount}>{index === 0 ? formatMoney(item.amount) : ""}</Text>
      </View>))}
      <View style={styles.totals} wrap={false}>
        <View style={styles.totalRow}><Text>Subtotal</Text><Text>{formatMoney(totals.subtotal)}</Text></View>
        <View style={styles.totalRow}><Text>Tax</Text><Text>{formatMoney(totals.tax_amount)}</Text></View>
        <View style={[styles.totalRow, styles.grandTotal]}><Text>Total</Text><Text>{formatMoney(totals.total)}</Text></View>
      </View>
      {[["NOTES", v.notes], ["TERMS", v.terms]].map(([label, value]) => value?.trim() && <View key={label} style={styles.prose}><Text style={styles.label} minPresenceAhead={25}>{label}</Text><Text style={styles.proseBody} orphans={2} widows={2}>{value}</Text></View>)}
      <View style={styles.footer} fixed><Text>{invoiceBusiness.name}</Text><Text render={({ pageNumber, totalPages }) => `Invoice #${v.invoice_number}  ·  ${pageNumber} / ${totalPages}`} /></View>
    </Page>
  </Document>;
}
export async function renderInvoicePdf(data: InvoicePdfData) {
  return renderToBuffer(<InvoiceDocument {...data} />);
}
