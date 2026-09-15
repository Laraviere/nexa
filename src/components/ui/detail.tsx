import type { ReactNode } from "react";

export function PageHeader({ title, context, status, actions }: { title: string; context?: ReactNode; status: ReactNode; actions: ReactNode }) {
  return <header className="nexa-detail-header"><div className="min-w-0"><div className="nexa-detail-identity"><h1>{title}</h1><div className="nexa-detail-statuses">{status}</div></div>{context&&<p className="mt-2 text-sm text-secondary">{context}</p>}</div><div className="nexa-detail-actions">{actions}</div></header>;
}

// Callers supply formatted values; this component does not calculate document amounts.
type DocumentLine = { id: string; description: string; quantity: ReactNode; rate: string; amount: string; tax?: ReactNode };
export function DocumentLines({ label, lines }: { label: string; lines: DocumentLine[] }) {
  return <section aria-label={label} className="nexa-document-lines">
    <div className="nexa-document-table" role="region" aria-label={label} tabIndex={0}><table><caption className="sr-only">{label}</caption><colgroup><col style={{width:"49%"}}/><col style={{width:"15%"}}/><col style={{width:"17%"}}/><col style={{width:"19%"}}/></colgroup><thead><tr><th scope="col">Description</th><th scope="col">Quantity / unit</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead><tbody>{lines.map(line=><tr key={line.id}><td className="whitespace-pre-wrap font-medium">{line.description}</td><td>{line.quantity}</td><td>{line.rate}</td><td className="font-semibold">{line.amount}{line.tax&&<p className="mt-1 text-xs font-normal text-secondary">Tax {line.tax}</p>}</td></tr>)}</tbody></table></div>
    <ul className="nexa-document-mobile">{lines.map(line=><li key={line.id}><p className="whitespace-pre-wrap font-medium">{line.description}</p><dl>{[["Quantity / unit",line.quantity],["Rate",line.rate],["Amount",line.amount]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}{line.tax&&<div><dt>Tax</dt><dd>{line.tax}</dd></div>}</dl></li>)}</ul>
  </section>;
}
