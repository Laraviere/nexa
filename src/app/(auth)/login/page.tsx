import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();

  if (claims) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
