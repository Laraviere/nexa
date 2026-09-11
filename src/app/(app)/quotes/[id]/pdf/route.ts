import { createClient } from "@/lib/supabase/server";
import { isCustomerId } from "@/lib/customers/validation";
import { businessDate } from "@/lib/billing/model";
import { renderQuotePdf } from "@/lib/quotes/pdf";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff",Vary:"Cookie"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const client=await createClient();const auth=await client.auth.getClaims();
  if(auth.error||!auth.data?.claims)return Response.json({message:"Sign in to view this quote PDF."},{status:401,headers});
  const {id}=await params;
  if(!isCustomerId(id))return Response.json({message:"Quote not found."},{status:404,headers});
  // A single row contains the header, lines and totals from one DB snapshot.
  const {data,error}=await client.from("quotes").select("*").eq("id",id).maybeSingle();
  if(error)throw new Error("Unable to load quote.");
  if(!data)return Response.json({message:"Quote not found."},{status:404,headers});
  const pdf=await renderQuotePdf(data,businessDate());
  return new Response(new Uint8Array(pdf),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`inline; filename="Nexa-Quote-Q-${data.quote_number}.pdf"`}});
 }catch{return Response.json({message:"Unable to generate this quote PDF. Please try again."},{status:500,headers});}
}
