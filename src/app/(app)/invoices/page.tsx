import { getInvoiceReport } from "@/lib/invoices/report-server";
import type { ReportParams } from "@/lib/invoices/report";
import { InvoiceReportView } from "@/components/invoices/report-view";
export default async function InvoicesPage({searchParams}:{searchParams:Promise<ReportParams>}) {
  return <InvoiceReportView data={await getInvoiceReport(await searchParams)}/>;
}
