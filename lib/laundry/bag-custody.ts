import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { propertyIsVisibleToLaundry, getVisibleLaundryPropertyIds } from "./teams";
export const bagEventInput = z.object({ requestId:z.string().uuid(), taskId:z.string().min(1), bagId:z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9 _.-]+$/).transform(value=>value.toUpperCase()), expectedVersion:z.number().int().nonnegative(), status:z.enum(["REGISTERED","PICKED_UP","RETURNED","UNKNOWN"]), observedAt:z.string().datetime({offset:true}), location:z.string().trim().min(1).max(300), contents:z.string().trim().max(1000).nullable(), itemCount:z.number().int().min(0).max(10000).nullable(), note:z.string().trim().min(1).max(2000) }).strict();
type Actor={id:string;role:Role};type Tx=Prisma.TransactionClient;
export type BagRecord={bagId:string;propertyId:string;taskId:string;jobId:string;version:number;status:string;observedAt:string;recordedAt:string;location:string;contents:string|null;itemCount:number|null;note:string;actorId:string;source:string};
const prefix="linen_bag_v1:";const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function actor(tx:Tx,user:Actor){const row=await tx.user.findUnique({where:{id:user.id},select:{isActive:true,role:true,extraRoles:{select:{role:true}}}});if(!row?.isActive)throw Error("UNAUTHORIZED");if(![Role.ADMIN,Role.CLEANER,Role.LAUNDRY].includes(user.role as any)||![row.role,...row.extraRoles.map(r=>r.role)].includes(user.role))throw Error("FORBIDDEN");}
async function taskScope(tx:Tx,user:Actor,taskId:string){await actor(tx,user);const task=await tx.laundryTask.findUnique({where:{id:taskId},include:{property:{select:{accessInfo:true,laundryEnabled:true}},job:{include:{assignments:{where:{userId:user.id,removedAt:null,responseStatus:{in:["PENDING","ACCEPTED"]}}}}}}});if(!task)throw Error("NOT_FOUND");if(user.role===Role.LAUNDRY&&!propertyIsVisibleToLaundry(task.property,user.id)||user.role===Role.CLEANER&&!task.job.assignments.length)throw Error("FORBIDDEN");return task;}
export function validateBagTransition(previous:BagRecord|null,input:z.infer<typeof bagEventInput>,now:Date){
 if(new Date(input.observedAt)>now)throw Error("Observation time cannot be in the future.");
 if(previous&&new Date(input.observedAt)<new Date(previous.observedAt))throw Error("Observation predates current custody; retain it in the note for office review.");
 if((previous&&previous.taskId!==input.taskId&&input.status==="REGISTERED"?0:previous?.version??0)!==input.expectedVersion)throw Error("CONFLICT: reload bag history.");
 if(!previous&&input.status!=="REGISTERED")throw Error("Register the bag against this run first.");
 if(previous&&input.status==="REGISTERED"&&previous.status!=="RETURNED")throw Error("The previous bag cycle must have an explicit return before reuse.");
 if(previous?.status==="RETURNED"&&input.status!=="REGISTERED")throw Error("Register a new cycle before recording another handoff.");
 if(previous?.status==="PICKED_UP"&&input.status==="PICKED_UP")throw Error("Pickup is already recorded.");
}
export async function recordBagEvent(user:Actor,raw:unknown){const input=bagEventInput.parse(raw);return db.$transaction(async tx=>{
 const task=await taskScope(tx,user,input.taskId);if(user.role===Role.CLEANER&&input.status==="PICKED_UP")throw Error("Only the laundry team or administrator records pickup custody.");
 const bagKey=prefix+"bag:"+hash(input.bagId),eventKey=prefix+"event:"+hash([user.id,input.requestId]);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bagKey},0))`;
 const receipt=await tx.appSetting.findUnique({where:{key:eventKey}});const fingerprint=hash(input);if(receipt){const saved=receipt.value as any;if(saved.fingerprint!==fingerprint)throw Error("CONFLICT: request already used.");return saved.record as BagRecord;}
 const existing=await tx.appSetting.findUnique({where:{key:bagKey}});const previous=existing?.value as unknown as BagRecord|null;const now=new Date();
 if(previous&&previous.propertyId!==task.propertyId)throw Error("This bag ID belongs to another property. Ask the office to resolve the identity.");
 if(previous&&previous.taskId!==task.id&&input.status!=="REGISTERED")throw Error("This bag is linked to another run.");
 validateBagTransition(previous,input,now);
 const record:BagRecord={...input,propertyId:task.propertyId,taskId:task.id,jobId:task.jobId,version:(previous?.version??0)+1,recordedAt:now.toISOString(),actorId:user.id,source:`${user.role}_RECORDED`};
 const value=record as unknown as Prisma.InputJsonValue;
 await tx.appSetting.upsert({where:{key:bagKey},create:{key:bagKey,value},update:{value}});
 await tx.appSetting.create({data:{key:eventKey,value:{fingerprint,record:value,propertyId:task.propertyId,taskId:task.id,jobId:task.jobId}}});
 await tx.auditLog.create({data:{userId:user.id,action:"LINEN_BAG_CUSTODY_RECORDED",entity:"LaundryTask",entityId:task.id,before:previous?previous as unknown as Prisma.InputJsonValue:Prisma.JsonNull,after:value}});return record;
 });}
export async function listBagCustody(user:Actor,taskId?:string){await actor(db,user);if(taskId)await taskScope(db,user,taskId);
 const propertyIds=user.role===Role.LAUNDRY?await getVisibleLaundryPropertyIds(user.id):undefined;
 const tasks=await db.laundryTask.findMany({where:{...(propertyIds?{propertyId:{in:propertyIds}}:{}),...(taskId?{id:taskId}:{}),...(user.role===Role.CLEANER?{job:{assignments:{some:{userId:user.id,removedAt:null,responseStatus:{in:["PENDING","ACCEPTED"]}}}}}:{})},include:{property:{select:{name:true,accessInfo:true,laundryEnabled:true}},job:{select:{jobNumber:true}}},orderBy:{pickupDate:"desc"},take:100});
 const allowed=tasks.filter(task=>user.role!==Role.LAUNDRY||propertyIsVisibleToLaundry(task.property,user.id));
 const rows=taskId?await db.appSetting.findMany({where:{key:{startsWith:prefix+"event:"},value:{path:["taskId"],equals:taskId}},orderBy:{createdAt:"asc"}}):[];
 return {tasks:allowed.map(task=>({id:task.id,property:task.property.name,job:task.job.jobNumber,pickupDate:task.pickupDate,returnDate:task.dropoffDate,legacyStatus:task.status})),events:rows.map(row=>(row.value as any).record as BagRecord)};
}
