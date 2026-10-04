import { z } from "zod";
export const costCategories=["CLEANER","LAUNDRY","SUPPLIES","OTHER"] as const;
const cost=z.object({amount:z.number().finite().min(0).max(1000000),reference:z.string().trim().min(3).max(1000)}).strict().nullable();
export const verifiedCostsSchema=z.object({jobId:z.string().min(1),expectedVersion:z.number().int().nonnegative(),confirmed:z.literal(true),costs:z.object({CLEANER:cost,LAUNDRY:cost,SUPPLIES:cost,OTHER:cost}).strict()}).strict();
/** Invoice status alone is not evidence of cash receipt. Never allocate a mixed invoice by guesswork. */
export function turnoverRevenue(jobId:string,invoices:any[]){
 const unique=Array.from(new Map(invoices.map(row=>[row.id,row])).values());
 let invoiced:number|null=null, cash:number|null=null;let incomplete=false;const sources:any[]=[];
 for(const invoice of unique){if(["DRAFT","VOID"].includes(invoice.status))continue;
 const lines=(invoice.lines??[]).filter((line:any)=>line.jobId===jobId);if(!lines.length)continue;
 const amounts=lines.map((line:any)=>line.lineTotal);if(!amounts.every((n:unknown)=>typeof n==="number"&&Number.isFinite(n))){incomplete=true;continue;}
 const amount=amounts.reduce((a:number,b:number)=>a+b,0);invoiced=(invoiced??0)+amount;
 const exclusivelyThisJob=invoice.lines.every((line:any)=>line.jobId===jobId);
 const paid=["PART_PAID","PAID"].includes(invoice.status)&&typeof invoice.paidAmount==="number"&&Number.isFinite(invoice.paidAmount)&&invoice.paidAmount>=0&&invoice.paidDate?invoice.paidAmount:null;
 if(exclusivelyThisJob&&paid!==null)cash=(cash??0)+paid;
 sources.push({id:invoice.id,number:invoice.invoiceNumber,status:invoice.status,invoiced:amount,invoicePaid:paid,cashAllocated:exclusivelyThisJob?paid:null,paidDate:invoice.paidDate??null});
 }
 // If any linked invoice has unknown/unallocated receipts, a total cash figure would be incomplete.
 if(sources.some(row=>row.cashAllocated===null))cash=null;
 return {invoiced:incomplete?null:invoiced,cash:incomplete?null:cash,sources};
}
export function turnoverProfit(revenue:number|null,costs:Record<string,{amount:number;reference:string}|null>|null){
 const missing=costCategories.filter(key=>!costs?.[key]);
 const documented=costCategories.reduce((sum,key)=>sum+(costs?.[key]?.amount??0),0);
 return {documentedCostSubtotal:missing.length===costCategories.length?null:documented,missingCosts:missing,totalCost:missing.length?null:documented,profit:revenue===null||missing.length?null:Number((revenue-documented).toFixed(2))};
}
