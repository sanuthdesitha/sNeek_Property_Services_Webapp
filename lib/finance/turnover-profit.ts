import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { verifiedCostsSchema, turnoverRevenue, turnoverProfit } from "./turnover-profit-policy";
async function admin(user:{id:string;role:Role}){const row=await db.user.findUnique({where:{id:user.id},select:{isActive:true,role:true,extraRoles:{select:{role:true}}}});if(!row?.isActive)throw Error("UNAUTHORIZED");if(user.role!==Role.ADMIN||![row.role,...row.extraRoles.map(r=>r.role)].includes(Role.ADMIN))throw Error("FORBIDDEN");}
const key=(jobId:string)=>`turnover_cost_review_v1:${jobId}`;
export async function readTurnoverProfit(user:{id:string;role:Role},jobId?:string){await admin(user);
 const jobs=await db.job.findMany({where:{jobType:"AIRBNB_TURNOVER",...(jobId?{id:jobId}:{})},select:{id:true,jobNumber:true,scheduledDate:true,status:true,fixedPrice:true,property:{select:{name:true}}},orderBy:{scheduledDate:"desc"},take:100});
 if(!jobId)return {jobs,detail:null};const job=jobs[0];if(!job)throw Error("NOT_FOUND");
 const [invoices,review,laundry]=await Promise.all([db.clientInvoice.findMany({where:{lines:{some:{jobId}}},include:{lines:true}}),db.appSetting.findUnique({where:{key:key(jobId)}}),db.laundryTask.findUnique({where:{jobId},select:{dropoffCostAud:true,receiptImageUrl:true,droppedAt:true}})]);
 const revenue=turnoverRevenue(jobId,invoices);const recorded=review?.value as any;
 return {jobs,detail:{job,revenue,costReview:recorded??null,...turnoverProfit(revenue.invoiced,recorded?.costs??null),agreedPriceEstimate:job.fixedPrice??null,laundryRecordedCharge:laundry?.dropoffCostAud??null,laundryReceiptPresent:!!laundry?.receiptImageUrl,note:"AUD. Revenue and reviewed costs exclude recoverable GST. Cash receipts include invoice tax and are not profit. Cost review is an administrator attestation; missing costs remain unknown."}};
}
export async function saveTurnoverCosts(user:{id:string;role:Role},raw:unknown){await admin(user);const input=verifiedCostsSchema.parse(raw);
 return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key(input.jobId)},0))`;
 const job=await tx.job.findUnique({where:{id:input.jobId},select:{jobType:true}});if(job?.jobType!=="AIRBNB_TURNOVER")throw Error("NOT_FOUND");
 const old=await tx.appSetting.findUnique({where:{key:key(input.jobId)}});const previous=old?.value as any;if((previous?.version??0)!==input.expectedVersion)throw Error("CONFLICT: reload cost review.");
 const value={version:(previous?.version??0)+1,costs:input.costs,source:"ADMIN_DOCUMENT_REVIEW",reviewedBy:user.id,reviewedAt:new Date().toISOString()};
 await tx.appSetting.upsert({where:{key:key(input.jobId)},create:{key:key(input.jobId),value},update:{value}});
 await tx.auditLog.create({data:{userId:user.id,action:"TURNOVER_COSTS_REVIEWED",entity:"Job",entityId:input.jobId,before:old?.value??Prisma.JsonNull,after:value}});return value;
 });}
