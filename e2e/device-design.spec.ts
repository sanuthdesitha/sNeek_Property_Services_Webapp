import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { captureOperationsLayout } from "./operations-layout";
const origin=process.env.SNEEK_TEST_SERVER_ORIGIN,database=process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin||!database,"Requires isolated local fixtures");
const [cleaner,client,property,job,template]=Array.from({length:5},()=>randomUUID());
const password="Visual-fixture-only-27!";let db:PrismaClient;
test.beforeAll(async()=>{
 if(origin!=="http://localhost:3002"||new URL(database!).hostname!=="127.0.0.1"||new URL(database!).port!=="55439")throw Error("Dedicated local fixtures required");
 db=new PrismaClient({datasources:{db:{url:database}}});
 await db.user.create({data:{id:cleaner,name:"Fixture Cleaner",email:`${cleaner}@example.invalid`,role:"CLEANER",passwordHash:await bcrypt.hash(password,4)}});
 await db.client.create({data:{id:client,name:"Device design fixture"}});
 await db.property.create({data:{id:property,clientId:client,name:"Device design fixture",address:"Fixture",suburb:"Fixture",laundryEnabled:false,inventoryEnabled:false}});
 await db.formTemplate.create({data:{id:template,name:"Device design fixture",serviceType:"AIRBNB_TURNOVER",isJobScoped:true,schema:{standardSections:false,sections:[{id:"devices",title:"Device checks",fields:[{id:"minut_checked",type:"yesno",label:"Minut checked",required:true},{id:"ring_working",type:"yesno",label:"Ring camera working",required:true}]}]}}});
 await db.job.create({data:{id:job,jobNumber:"DESIGN-DEVICE",propertyId:property,jobType:"AIRBNB_TURNOVER",formTemplateId:template,status:"IN_PROGRESS",scheduledDate:new Date(),gpsCheckInAt:new Date(),arrivedAt:new Date(),assignments:{create:{userId:cleaner,responseStatus:"ACCEPTED"}},timeLogs:{create:{userId:cleaner,startedAt:new Date()}}}});
});
test.afterAll(async()=>{if(!db)return;await db.notification.deleteMany({where:{userId:cleaner}});await db.auditLog.deleteMany({where:{userId:cleaner}});await db.appSetting.deleteMany({where:{OR:[{key:`cleaner_job_shared_draft_v1:${job}`},{key:`stay_preparation_v1:${property}`}]}});await db.timeLog.deleteMany({where:{jobId:job}});await db.jobTask.deleteMany({where:{jobId:job}});await db.jobAssignment.deleteMany({where:{jobId:job}});await db.job.delete({where:{id:job}});await db.formTemplate.delete({where:{id:template}});await db.property.delete({where:{id:property}});await db.client.delete({where:{id:client}});await db.user.delete({where:{id:cleaner}});await db.$disconnect();});
test("device exceptions retain labelled reasons in the actual cleaner workspace",async({browser})=>{
 const context=await browser.newContext();await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const csrf=await(await context.request.get(`${origin}/api/auth/csrf`)).json();await context.request.post(`${origin}/api/auth/callback/credentials`,{form:{email:`${cleaner}@example.invalid`,password,csrfToken:csrf.csrfToken,json:"true",callbackUrl:`${origin}/v2/cleaner/jobs/${job}`}});
 const page=await context.newPage();await page.goto(`${origin}/v2/cleaner/jobs/${job}`);
 const status=page.getByLabel("Minut checked — device status",{exact:true});await expect(status).toBeVisible({timeout:45000});await status.selectOption("NOT_CHECKED");
 const reason=page.getByLabel("Minut checked — reason",{exact:true});await reason.fill("Device could not be checked during this visit.");await expect(reason).toHaveAttribute("aria-required","true");
 await page.getByLabel("Ring camera working — device status",{exact:true}).selectOption("NOT_APPLICABLE");await page.getByLabel("Ring camera working — reason",{exact:true}).fill("Device absent at this property.");
 await captureOperationsLayout(page,"device-workspace");
 // Capture the actual field block at both breakpoints as well as the full workspace.
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});if(process.env.SNEEK_VISUAL_OUTPUT)await status.locator("..").screenshot({path:`${process.env.SNEEK_VISUAL_OUTPUT}/device-control-${width}.png`});}
 await context.close();
});
