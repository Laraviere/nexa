import type { Database } from "@/types/database";
import { invoiceInput,type Draft } from "@/lib/invoices/model";
import { generationInput } from "@/lib/invoices/generation";
export type PreviewArgs = Database["public"]["Functions"]["preview_customer_invoice"]["Args"];
export type PreviewResult = Database["public"]["Functions"]["preview_customer_invoice"]["Returns"][number];
export type ComposerArgs = Database["public"]["Functions"]["create_composed_invoice"]["Args"];
export type ComposerResult = Database["public"]["Functions"]["create_composed_invoice"]["Returns"][number];
export const chargeLabels = {retainer_fee:"Monthly retainer",retainer_overage:"Overage",hourly_time:"Hourly support"} as const;
// The generated candidate field is JSON. Decode the display fields at the boundary;
// this is a UI projection, not a replacement for either generated RPC contract.
export type Charge = {candidate_id:string;source_type:keyof typeof chargeLabels;description:string;quantity:number;unit:string;unit_rate:number;amount:number;billed_minutes?:number;retained?:boolean;tax_amount?:number};
export function readCharges(value: PreviewResult["candidates"]): Charge[] | null {
  if (!Array.isArray(value)) return null;
  const charges: Charge[] = [];
  for (const v of value) {
    if (!v || typeof v!=="object" || Array.isArray(v) || typeof v.candidate_id!=="string" || !/^[0-9a-f]{64}$/.test(v.candidate_id)
      || typeof v.source_type!=="string" || !Object.hasOwn(chargeLabels,v.source_type) || typeof v.description!=="string" || typeof v.unit!=="string"
      || ![v.quantity,v.unit_rate,v.amount].every(n=>typeof n==="number" && Number.isFinite(n) && n>=0)
      || (v.billed_minutes!==undefined && (typeof v.billed_minutes!=="number" || !Number.isSafeInteger(v.billed_minutes) || v.billed_minutes<0))) return null;
    charges.push({candidate_id:v.candidate_id,source_type:v.source_type as Charge["source_type"],description:v.description,unit:v.unit,
      quantity:v.quantity as number,unit_rate:v.unit_rate as number,amount:v.amount as number,billed_minutes:v.billed_minutes as number|undefined,retained:v.retained===true,tax_amount:typeof v.tax_amount==="number"?v.tax_amount:0});
  }
  return new Set(charges.map(c=>c.candidate_id)).size===charges.length?charges:null;
}
export type ComposerDraft = Draft & {as_of_date:string};
export type ComposerPayload = ComposerDraft & {revision:string;selected_candidate_ids:string[];invoice_id?:string;descriptions?:Record<string,string>};
export type ComposerState = {message?:string;uncertain?:boolean;stale?:boolean;invoiceId?:string};
export type PreviewState = {preview?:PreviewResult;message?:string};
export function composerInput(raw:unknown,requestId:string):{args?:ComposerArgs;message?:string} {
  if (!raw || typeof raw!=="object") return {message:"Check the invoice details."};
  const d = raw as Partial<ComposerPayload>;
  const base = generationInput(d,requestId);
  if (!base.args) return {message:base.message};
  if (!d.as_of_date || typeof d.revision!=="string" || !/^[0-9a-f]{64}$/.test(d.revision)) return {message:"Refresh charges before saving."};
  if (!Array.isArray(d.selected_candidate_ids) || d.selected_candidate_ids.length>1000 || d.selected_candidate_ids.some(id=>typeof id!=="string" || !/^[0-9a-f]{64}$/.test(id)) || new Set(d.selected_candidate_ids).size!==d.selected_candidate_ids.length) return {message:"Refresh charges and check your selection."};
  if (!Array.isArray(d.items)) return {message:"Check the custom items."};
  if (!d.items.length && !d.selected_candidate_ids.length) return {message:"Add or select at least one invoice item."};
  const custom = d.items.length?invoiceInput(d,requestId):null;
  if (custom && !custom.args) return {message:custom.message};
  return {args:{...base.args,p_as_of_date:d.as_of_date,p_revision:d.revision,p_selected_candidate_ids:d.selected_candidate_ids,p_custom_items:custom?.args?.p_items??[]}};
}
export function composerError(code:string,message:string):ComposerState {
  if (message.includes("STALE_INVOICE_PREVIEW")) return {message:"Billing activity changed since this invoice was prepared.",stale:true};
  if (code==="23505" || code==="23P01") return {message:"One or more billing charges are no longer available. Refresh the invoice.",stale:true};
  if (code==="22023" && message.includes("Request ID")) return {message:"We could not confirm this request. Retry the original submission to retrieve its result.",uncertain:true};
  if (code==="22023" && message.includes("Select a charge")) return {message:"Add or select at least one invoice item."};
  if (["22023","23514","P0002","0A000"].includes(code)) return {message:"Invoice could not be saved. Check the customer, dates and custom items, then try again."};
  return {message:"Invoice could not be saved. Please retry this same submission to confirm the result.",uncertain:true};
}

export type EditArgs = Database["public"]["Functions"]["update_composed_invoice"]["Args"];
export type EditResult = Database["public"]["Functions"]["update_composed_invoice"]["Returns"][number];
export type EditPreviewArgs = Database["public"]["Functions"]["preview_invoice_edit"]["Args"];
