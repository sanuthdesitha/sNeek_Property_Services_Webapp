import { expect, it } from "vitest";
import { investigateLaundry, investigationPropertyKey, investigationTime, investigationDate, type InvestigationTask } from "@/lib/laundry/investigation";
const task: InvestigationTask = { id:"run", propertyId:"p", property:{name:"Jackson P11"}, status:"PENDING", pickupDate:"2026-10-04T00:00:00Z", dropoffDate:"2026-10-06T00:00:00Z" };
const event = (name:string,at:string,fields={}) => ({id:name,confirmedByName:"Pat",createdAt:at,laundryReady:true,notes:JSON.stringify({event:name,...fields})});
it("keeps unknown custody, readiness and quantities unknown",()=>{
 const result=investigateLaundry(task);
 expect(result.ready).toBe("Cleaner readiness not recorded");
 expect(result.holder).toContain("not confirmed");expect(result.next).toContain("Cleaner");
 expect(result.summary).toContain("2026-10-04");expect(result.issues).toEqual([]);
 expect(result.summary).not.toMatch(/bags|stock|https:/);
 expect(investigationPropertyKey(task)).toBe("p");
 expect(investigationPropertyKey({...task,propertyId:undefined,property:null})).toBe("unknown:run");
 expect(investigationTime("invalid")).toBe("Time not recorded");expect(investigationDate("invalid")).toBe("Date not recorded");
});
it("orders recorded participants and preserves original records without treating authors as recipients",()=>{
 const confirmations=Object.freeze([event("DROPPED","2026-10-06T04:00:00Z",{dropoffLocation:"Front door"}),event("PICKED_UP","2026-10-04T04:00:00Z",{bagCount:2})]);
 const before=JSON.stringify(confirmations);
 const result=investigateLaundry({...task,status:"PICKED_UP",supplier:{name:"Linen supplier"},confirmations});
 expect(result.holder).toContain("Pickup recorded by Pat");expect(result.holder).toContain("not confirmed");expect(result.next).toContain("Linen supplier");
 expect(result.summary.indexOf("Pickup recorded")).toBeLessThan(result.summary.lastIndexOf("Return recorded"));
 expect(JSON.stringify(confirmations)).toBe(before);
});
it("shows corrected return location and dates without inventing recipient acceptance",()=>{
 const result=investigateLaundry({...task,status:"DROPPED",createdAt:"2026-10-01T04:00:00Z",droppedAt:"2026-10-06T04:00:00Z",confirmations:[
 event("DROPPED","2026-10-06T04:00:00Z",{dropoffLocation:"Front door"}),event("EDIT_COMPLETED","2026-10-06T05:00:00Z",{changedFields:["dropoffLocation"],after:{dropoffLocation:"Linen cupboard"}})]});
 expect(result.holder).toContain("Linen cupboard");expect(result.holder).not.toContain("Front door");expect(result.holder).toContain("acceptance not recorded");expect(result.milestones).toHaveLength(2);expect(result.next).toContain("Receiving team");
});
it("surfaces pending approval, driver evidence and most recent cleaner readiness separately",()=>{
 const result=investigateLaundry({...task,status:"FLAGGED",flagReason:"NOT_READY",flagNotes:"Access issue",confirmations:[
 {id:"ready",createdAt:"2026-10-03",laundryReady:true,confirmedByName:"Alex",notes:"Ready at door"},
 {id:"notready",createdAt:"2026-10-04",laundryReady:false,confirmedByName:"Alex",notes:JSON.stringify({source:"EARLY_UPDATE",laundryOutcome:"NOT_READY"})},
 event("PICKED_UP","2026-10-04T03:00:00Z",{pickupReadiness:"NOT_READY"}),event("FAILED_PICKUP_REQUEST","2026-10-04T04:00:00Z",{approvalStatus:"PENDING"})]});
 expect(result.ready).toContain("Not ready — recorded by Alex");expect(result.issues).toContain("Office approval pending for failed pickup");expect(result.next).toContain("Office");
});
it.each(["CONFIRMED","SKIPPED_PICKUP"])("does not treat old pickup records as current custody for %s",status=>{
 const result=investigateLaundry({...task,status,skipReasonNote:"No linen required",confirmations:[event("PICKED_UP","2026-10-04")]});
 expect(result.holder).toContain("not confirmed");expect(result.issues).toContain("No linen required");
 expect(result.next).toContain(status==="CONFIRMED"?"Laundry team":"Office");
});
it("handles malformed/undated history and no-pickup records without failing the view",()=>{
 const result=investigateLaundry({...task,noPickupRequired:true,confirmations:[{notes:"{broken",createdAt:"invalid"},{notes:"[]"},{notes:"null"},{laundryReady:false}]});
 expect(result.ready).toBe("No pickup required");expect(result.next).toContain("Office");expect(result.summary).toContain("Time not recorded");
});
it("does not assume a supplier or actor when pickup identity is missing",()=>{
 const result=investigateLaundry({...task,status:"PICKED_UP",confirmations:[{createdAt:"2026-10-04",notes:'{"event":"PICKED_UP"}'}]});
 expect(result.holder).toContain("name unavailable");expect(result.next).toContain("Laundry team");
});
it.each([undefined,"Cupboard"])("uses only recorded return location (%s)",location=>{
 const result=investigateLaundry({...task,status:"DROPPED",confirmations:[event("DROPPED","2026-10-06",location?{dropoffLocation:location}:{})]});
 expect(result.holder).toContain(location??"location not recorded");
});
it("does not retain a cleared return location and handles absent property/readiness names",()=>{
 const result=investigateLaundry({...task,property:null,status:"DROPPED",confirmations:[{laundryReady:true},event("DROPPED","2026-10-06",{dropoffLocation:"Old"}),event("EDIT_COMPLETED","2026-10-07",{changedFields:["dropoffLocation"],after:{dropoffLocation:null}})]});
 expect(result.holder).toContain("location not recorded");expect(result.summary).toContain("Property not recorded");expect(result.ready).toContain("name unavailable");
});
