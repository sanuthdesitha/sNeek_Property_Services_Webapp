import { captureOperationsLayout } from "./operations-layout";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { parseJobInternalNotes, serializeJobInternalNotes } from "../lib/jobs/meta";
const origin = process.env.SNEEK_TEST_SERVER_ORIGIN, database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires isolated fixture server and database");
// Includes multiple portal journeys plus desktop/mobile light/dark captures.
test.setTimeout(90_000);
const [admin, cleaner, client, property, job, item, task, invoice] = Array.from({ length: 8 }, () => randomUUID());
const password = "Care-fixture-password-27!";
let db: PrismaClient;
test.beforeAll(async () => {
  if (origin !== "http://localhost:3002" || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).port !== "55439") throw Error("Dedicated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({ data: [{ id: admin, email: `${admin}@example.invalid`, role: "ADMIN", passwordHash }, { id: cleaner, email: `${cleaner}@example.invalid`, role: "CLEANER", hourlyRate: 40, passwordHash }] });
  await db.client.create({ data: { id: client, name: "Jackson" } });
  await db.property.create({ data: { id: property, name: "Browser fixture property", clientId: client, address: "Fixture", suburb: "Fixture", inventoryEnabled: true } });
  await db.inventoryItem.create({data:{id:item,name:"Fixture paper",category:"Fixture",unit:"roll"}});
  await db.propertyStock.create({data:{propertyId:property,itemId:item,onHand:10}});
  await db.propertyClientRate.create({ data: { propertyId: property, jobType: "AIRBNB_TURNOVER", baseCharge: 100 } });
  await db.job.create({ data: { id: job, jobNumber: job, propertyId: property, jobType: "AIRBNB_TURNOVER", sameDayCheckin: true, internalNotes: serializeJobInternalNotes({...parseJobInternalNotes(null),reservationContext:{stayStartDate:"2026-10-01",stayEndDate:"2026-10-16",staySource:"ICAL",preparationGuestCount:4,preparationSource:"INCOMING_BOOKING"}}), status: "ASSIGNED", scheduledDate: new Date(Date.now() + 2 * 86400000), startTime: "09:00", endTime: "11:00", estimatedHours: 2, assignments: { create: { userId: cleaner, payRate: 40, responseStatus: "ACCEPTED" } } } });
 await db.laundryTask.create({data:{id:task,jobId:job,propertyId:property,pickupDate:new Date(),dropoffDate:new Date(Date.now()+3*86400000)}});
 await db.clientInvoice.create({data:{id:invoice,clientId:client,invoiceNumber:invoice,status:"SENT",subtotal:100,gstAmount:10,totalAmount:110,lines:{create:{jobId:job,description:"Turnover",category:"CLEANING",lineTotal:100,quantity:1,unitPrice:100}}}});
});
test.afterAll(async () => {
  if (!db) return;
  // This is an empty, disposable database; no production or shared data allowed.
  await db.notification.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.clientInvoice.deleteMany({ where: { clientId: client } });
  await db.propertyClientRate.deleteMany({ where: { propertyId: property } });
  await db.jobTask.deleteMany({ where: { propertyId: property } });
  await db.laundryTask.delete({where:{id:task}});
  await db.appSetting.deleteMany({where:{OR:[{key:`turnover_cost_review_v1:${job}`},{key:{startsWith:"linen_bag_v1:"},value:{path:["propertyId"],equals:property}}]}});
  await db.jobAssignment.deleteMany({ where: { jobId: job } }); await db.job.delete({ where: { id: job } });
  await db.appSetting.deleteMany({where:{key:`stay_preparation_v1:${property}`}});
  await db.propertyStock.deleteMany({where:{propertyId:property}});
  await db.inventoryItem.delete({where:{id:item}});
  await db.property.delete({ where: { id: property } }); await db.client.delete({ where: { id: client } });
  await db.user.deleteMany({ where: { id: { in: [admin, cleaner] } } }); await db.$disconnect();
});


test("bag custody and audited profit remain distinct from delivery and cash",async({browser})=>{
 async function login(user:string){const context=await browser.newContext();await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const csrf=await(await context.request.get(`${origin}/api/auth/csrf`)).json();await context.request.post(`${origin}/api/auth/callback/credentials`,{form:{email:`${user}@example.invalid`,password,csrfToken:csrf.csrfToken,json:"true",callbackUrl:`${origin}/linen-bags`}});return context;}
 const context=await login(admin);const page=await context.newPage();await page.goto(`${origin}/linen-bags?taskId=${task}`);await page.getByLabel("Physical bag ID",{exact:true}).fill("BROWSER-BAG-"+task);await page.getByLabel("Observed at (your local time)",{exact:true}).fill(new Date(Date.now()-60000).toISOString().slice(0,16));await page.getByLabel("Holder or location (write Unknown if uncertain)",{exact:true}).fill("Fixture cupboard");await page.getByLabel("Observation note / evidence reference",{exact:true}).fill("Physical label checked, contents unknown");await page.getByRole("button",{name:"Record bag observation"}).click();await expect(page.getByText("Item count: Unknown.",{exact:false})).toBeVisible();expect((await db.laundryTask.findUnique({where:{id:task}}))?.status).toBe("PENDING");await page.screenshot({path:"/workspace/final-release/bag-custody.png",fullPage:true});await page.pdf({path:"/workspace/final-release/bag-custody.pdf",format:"A4"});
 await expect(page.getByText(/Recorded by administrator/)).toBeVisible();
 await expect(page.getByText(/ADMIN_RECORDED/)).toHaveCount(0);
 await captureOperationsLayout(page,"linen");
 await page.goto(`${origin}/turnover-profit?jobId=${job}`);await expect(page.getByText("Profit on documented accrual basis: Unknown")).toBeVisible();for(const key of ["CLEANER","LAUNDRY","SUPPLIES","OTHER"]){await page.getByLabel(`${key} amount`,{exact:true}).fill(key==="CLEANER"?"40":"0");await page.getByLabel(`${key} reference`,{exact:true}).fill("Fixture document review; explicit amount confirmed");}await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Save audited cost review"}).click();await expect(page.getByText("Profit on documented accrual basis: $60.00")).toBeVisible();await expect(page.getByText("Cash specifically attributable to this turnover: Unknown")).toBeVisible();await page.screenshot({path:"/workspace/final-release/turnover-profit.png",fullPage:true});
 await captureOperationsLayout(page,"profit");
 await page.goto(`${origin}/v2/admin/finance`);
 await page.getByRole("button", { name: "Review profit for an individual turnover", exact: true }).click();
 await page.getByRole("combobox", { name: "Turnover", exact: true }).selectOption(job);
 await expect(page.getByText("Profit on documented accrual basis: $60.00")).toBeVisible();
 await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
 await captureOperationsLayout(page,"profit-integrated");
 const restricted=await login(cleaner);const response=await restricted.request.get(`${origin}/api/admin/turnover-profit?jobId=${job}`);expect(response.status()).toBe(403);await restricted.close();await context.close();
});
