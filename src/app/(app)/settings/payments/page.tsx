import { paymentSettings } from "@/lib/payments/server";
import { CheckInstructionsForm, PaymentSettingsForm } from "@/components/payments/settings-form";
export default async function PaymentsSettingsPage(){const settings=await paymentSettings();return <><PaymentSettingsForm key={`methods:${settings.updated_at}`} settings={settings}/><CheckInstructionsForm key={`checks:${settings.updated_at}`} settings={settings}/></>;}
