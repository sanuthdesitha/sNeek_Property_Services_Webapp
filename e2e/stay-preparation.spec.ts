import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { parseJobInternalNotes, serializeJobInternalNotes } from "../lib/jobs/meta";
const origin = process.env.SNEEK_TEST_SERVER_ORIGIN, database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires isolated fixture server and database");
const [admin, cleaner, client, property, job, item] = Array.from({ length: 6 }, () => randomUUID());
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
});
test.afterAll(async () => {
  if (!db) return;
  // This is an empty, disposable database; no production or shared data allowed.
  await db.notification.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [admin, cleaner] } } });
  await db.clientInvoice.deleteMany({ where: { clientId: client } });
  await db.propertyClientRate.deleteMany({ where: { propertyId: property } });
  await db.jobTask.deleteMany({ where: { propertyId: property } });
  await db.jobAssignment.deleteMany({ where: { jobId: job } }); await db.job.delete({ where: { id: job } });
  await db.appSetting.deleteMany({where:{key:`stay_preparation_v1:${property}`}});
  await db.propertyStock.deleteMany({where:{propertyId:property}});
  await db.inventoryItem.delete({where:{id:item}});
  await db.property.delete({ where: { id: property } }); await db.client.delete({ where: { id: client } });
  await db.user.deleteMany({ where: { id: { in: [admin, cleaner] } } }); await db.$disconnect();
});


test("office configures a long-stay estimate, cleaner sees truthful quantities, and print preserves planning labels",async({browser})=>{
 async function login(user:string){const context=await browser.newContext();await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const csrf=await(await context.request.get(`${origin}/api/auth/csrf`)).json();await context.request.post(`${origin}/api/auth/callback/credentials`,{form:{email:`${user}@example.invalid`,password,csrfToken:csrf.csrfToken,json:"true",callbackUrl:`${origin}/urgent-stock?propertyId=${property}`}});return context;}
 const context=await login(admin);const page=await context.newPage();await page.goto(`${origin}/urgent-stock?propertyId=${property}`);
 await expect(page.getByRole("heading",{name:"Property preparation rules"})).toBeVisible();
 await page.getByLabel("Extra towels for stays over 14 nights",{exact:true}).fill("4");
 await page.getByLabel("Include estimate").check();await page.getByLabel("Fixture paper: Units per stay",{exact:true}).fill("2");await page.getByLabel("Fixture paper: Units per guest-night",{exact:true}).fill("0.25");
 await page.getByRole("button",{name:"Save preparation rules"}).click();await expect(page.locator("pre")).toContainText("estimated 17; verified available Unknown; cleaner-reported supplied/used Unknown; remaining estimate Unknown");await expect(page.locator("pre")).toContainText("4 extra towels");
 const popupEvent=context.waitForEvent("page");await page.getByRole("button",{name:"Print / save estimate as PDF"}).click();const popup=await popupEvent;await expect(popup.locator("body")).toContainText("Estimates do not deduct inventory");await popup.pdf({path:"/workspace/stay-preparation-release/example-estimate.pdf",format:"A4"});await popup.close();
 await page.screenshot({path:"/workspace/stay-preparation-release/preparation-workspace.png",fullPage:true});
 const cleanerContext=await login(cleaner);const cleanerPage=await cleanerContext.newPage();await cleanerPage.goto(`${origin}/urgent-stock?propertyId=${property}`);await expect(cleanerPage.locator("pre")).toContainText("15 nights");await expect(cleanerPage.getByRole("button",{name:"Save preparation rules"})).toHaveCount(0);
 expect((await db.propertyStock.findFirst({where:{propertyId:property}}))?.onHand).toBe(10);expect(await db.stockTx.count({where:{propertyStock:{propertyId:property}}})).toBe(0);
 await cleanerContext.close();await context.close();
});
