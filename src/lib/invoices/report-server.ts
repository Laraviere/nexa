import "server-only";
import { customerClient } from "@/lib/customers/server";
import { parseReport,reportFilters,type ParsedReport,type ReportParams } from "./report";
import type { Tables } from "@/types/database";
export async function getInvoiceReport(params:ReportParams) {
  const client=await customerClient();
  const filters=reportFilters(params);
  const [options,loaded]=await Promise.all([
    (async()=>{
      const customers:Pick<Tables<"customers">,"id"|"company_name"|"is_active">[]=[];
      try {
        for(let offset=0;;offset+=100){
          const {data,error}=await client.from("customers").select("id,company_name,is_active").order("company_name").order("id").range(offset,offset+99);
          if(error||!data)throw Error();customers.push(...data);if(data.length<100)break;
        }
        return {customers,customerMessage:undefined};
      }catch{return {customers,customerMessage:"Customer filters are unavailable. Please reload to try again."};}
    })(),
    (async():Promise<{report:ParsedReport|null;message?:string}>=>{
      if(filters.message)return {report:null,message:filters.message};
      try {
        const {data,error}=await client.rpc("get_invoice_report",filters.args);
        if(error)return {report:null,message:error.code==="22023"?"Check the filters and issue-date range, then try again.":"Unable to load invoice report."};
        if(!data||data.length!==1)throw Error();
        return {report:parseReport(data[0])};
      }catch{return {report:null,message:"Unable to load invoice report."};}
    })(),
  ]);
  return {filters,...options,...loaded};
}
