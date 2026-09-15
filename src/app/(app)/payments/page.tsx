import { getPaymentReport } from "@/lib/payments/report-server";
import type { ReportParams } from "@/lib/payments/report";
import { PaymentReportView } from "@/components/payments/report-view";
export default async function PaymentsPage({searchParams}:{searchParams:Promise<ReportParams>}) {
  return <PaymentReportView data={await getPaymentReport(await searchParams)}/>;
}
