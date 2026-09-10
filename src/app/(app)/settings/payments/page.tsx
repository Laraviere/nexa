import { paymentSettings } from "@/lib/payments/server";
import { PaymentSettingsForm } from "@/components/payments/settings-form";
export default async function PaymentsSettingsPage(){const settings=await paymentSettings();return <PaymentSettingsForm key={settings.updated_at} settings={settings}/>;}
