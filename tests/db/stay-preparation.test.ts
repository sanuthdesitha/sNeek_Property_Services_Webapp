// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { reportUrgentStock as report, actOnUrgentStock as act, listUrgentStock as list, setUrgentStockSettings as settings, dispatchUrgentStockReminders as reminders, nextUrgentStockClean } from "@/lib/inventory/urgent-stock";
import { listStayPreparation, saveStayPolicy } from "@/lib/inventory/stay-preparation";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
const url = process.env.SNEEK_TEST_DATABASE_URL;
const prefix = "urgent_stock_v1:";
const ids = Array.from({ length: 7 }, () => randomUUID());
const [adminId, cleanerId, strangerId, clientId, propertyId, itemId, jobId] = ids;
const admin = { id: adminId, role: Role.ADMIN }, cleaner = { id: cleanerId, role: Role.CLEANER }, stranger = { id: strangerId, role: Role.CLEANER };
const input = () => ({ propertyId, itemId, requestId: randomUUID(), observedCount: null as number | null, observedAt: null as string | null, purchaseQuantity: null as number | null, note: "Paper needed, actual quantity unknown" });
const action = (need: any, stage: string, extra = {}) => ({ reportId: need.id, requestId: randomUUID(), expectedVersion: need.version, stage, reason: "Recorded by fixture", observedCount: null, observedAt: null, needResolved: false, ...extra });
describe.skipIf(!url)("stay preparation read-only scoped integration", () => {
 beforeAll(async () => {
  if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
  m.client = new PrismaClient({ datasources: { db: { url } } });
  await m.client.user.createMany({ data: [admin, cleaner, stranger].map(user => ({ id: user.id, email: `${user.id}@example.invalid`, role: user.role })) });
  await m.client.client.create({ data: { id: clientId, name: "Stock fixture client" } });
  await m.client.property.create({ data: { id: propertyId, name: "Stock fixture property", clientId, address: "Fixture", suburb: "Fixture", inventoryEnabled: true } });
  await m.client.inventoryItem.create({ data: { id: itemId, name: "Fixture paper", category: "Fixture" } });
  await m.client.propertyStock.create({ data: { propertyId, itemId, onHand: 10 } });
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date(), assignments: { create: { userId: cleaner.id, responseStatus: "ACCEPTED" } } } });
 });
 beforeEach(async () => {
  await m.client.appSetting.deleteMany({ where: { OR: [{ key: { startsWith: prefix } }, { key: `stay_preparation_v1:${propertyId}` }, { key: `job_submission_stock_v1:${jobId}` }] } });
  await m.client.notification.deleteMany({ where: { userId: adminId } });
  await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
  await m.client.propertyStock.updateMany({ where: { propertyId }, data: { onHand: 10, updatedAt: new Date(Date.now() - 3600000) } });
  await m.client.jobAssignment.updateMany({ where: { jobId }, data: { removedAt: null } });
  await m.client.job.update({ where: { id: jobId }, data: { status: "ASSIGNED", cleanSkipStatus: "NONE", scheduledDate: new Date(), startTime: "12:00", internalNotes: null, sameDayCheckin: false } });
 });
 afterAll(async () => {
  await m.client.appSetting.deleteMany({ where: { OR: [{ key: { startsWith: prefix } }, { key: `stay_preparation_v1:${propertyId}` }, { key: `job_submission_stock_v1:${jobId}` }] } });
  await m.client.notification.deleteMany({ where: { userId: { in: [adminId, cleanerId, strangerId] } } });
  await m.client.auditLog.deleteMany({ where: { userId: adminId } });
  await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
  await m.client.propertyStock.deleteMany({ where: { propertyId } });
  await m.client.jobAssignment.deleteMany({ where: { jobId } }); await m.client.job.delete({ where: { id: jobId } });
  await m.client.property.delete({ where: { id: propertyId } }); await m.client.client.delete({ where: { id: clientId } });
  await m.client.inventoryItem.delete({ where: { id: itemId } }); await m.client.user.deleteMany({ where: { id: { in: [adminId, cleanerId, strangerId] } } }); await m.client.$disconnect();
 });
 it("admin configures estimates; assigned cleaner reads them without inventory mutations",async()=>{
  await m.client.job.update({where:{id:jobId},data:{sameDayCheckin:true,internalNotes:serializeJobInternalNotes({...parseJobInternalNotes(null),reservationContext:{stayStartDate:"2026-10-01",stayEndDate:"2026-10-16",staySource:"ICAL",preparationGuestCount:4,preparationSource:"INCOMING_BOOKING"}})}});
  const policy={version:1,items:[{itemId,perStay:2,perGuestNight:0.25}],extraTowels:4};
  await saveStayPolicy(admin,propertyId,policy);
  const before=await m.client.propertyStock.findFirst({where:{propertyId}});
  const result=await listStayPreparation(cleaner,propertyId,jobId);
  expect(result.plans[0]).toMatchObject({nights:15,guests:4,guestBasis:"INCOMING_BOOKING"});
  expect(result.plans[0].rows[0]).toMatchObject({estimated:17,available:null,supplied:null,remaining:null,ledgerCount:10});
  expect(result.plans[0].towelInstruction).toContain("4 extra towels");
  expect(await m.client.propertyStock.findFirst({where:{propertyId}})).toEqual(before);
  expect(await m.client.stockTx.count({where:{propertyStock:{propertyId}}})).toBe(0);
  await expect(saveStayPolicy(cleaner,propertyId,policy)).rejects.toThrow("FORBIDDEN");
  await expect(saveStayPolicy({...stranger,role:Role.ADMIN},propertyId,policy)).rejects.toThrow("FORBIDDEN");
  await expect(listStayPreparation(stranger,propertyId,jobId)).rejects.toThrow("FORBIDDEN");
  await expect(saveStayPolicy(admin,propertyId,{...policy,items:[{itemId:"foreign",perStay:1,perGuestNight:1}]})).rejects.toThrow("configured");
  await m.client.jobAssignment.updateMany({where:{jobId},data:{removedAt:new Date()}});
  await expect(listStayPreparation(cleaner,propertyId,jobId)).rejects.toThrow("FORBIDDEN");
 });
 it("ties verified availability to the latest physical urgent-stock observation, invalidated by later writes",async()=>{
  await saveStayPolicy(admin,propertyId,{version:1,items:[{itemId,perStay:5,perGuestNight:0}],extraTowels:null});
  const observedAt=new Date(Date.now()-1000).toISOString();
  const need=await report(cleaner,{...input(),observedCount:3,observedAt});
  const plan=(await listStayPreparation(cleaner,propertyId,jobId)).plans[0];
  expect(plan.nights).toBeNull();expect(plan.guests).toBeNull();
  const first=plan.rows[0];
  expect(first).toMatchObject({estimated:5,available:3,supplied:null,remaining:null,reportId:need.id,observedAt});
  await m.client.propertyStock.updateMany({where:{propertyId},data:{onHand:2}});
  const changed=(await listStayPreparation(cleaner,propertyId,jobId)).plans[0].rows[0];
  expect(changed.available).toBeNull();expect(changed.ledgerCount).toBe(2);expect(changed.reportId).toBe(need.id);
 });

 it("keeps declared supply separate from capped ledger deductions and forecasts",async()=>{
  await saveStayPolicy(admin,propertyId,{version:1,items:[{itemId,perStay:8,perGuestNight:0}],extraTowels:null});
  await m.client.appSetting.create({data:{key:`job_submission_stock_v1:${jobId}`,value:{submissionId:"fixture",usage:{[itemId]:5}}}});
  const row=(await listStayPreparation(cleaner,propertyId,jobId)).plans[0].rows[0];
  expect(row).toMatchObject({estimated:8,supplied:5,remaining:3,ledgerUsed:null,ledgerCount:10});
  expect(await m.client.stockTx.count({where:{propertyStock:{propertyId}}})).toBe(0);
 });
});
