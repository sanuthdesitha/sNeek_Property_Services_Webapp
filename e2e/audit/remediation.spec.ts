import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({
    entryPoints: [path.resolve("e2e/audit/fixtures/entry.tsx")], bundle: true, write: false,
    format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' },
    alias: { "@": process.cwd(), "next/image": path.resolve("e2e/audit/fixtures/image.tsx"), "next/navigation": path.resolve("e2e/laundry/fixtures/responsive-navigation.ts") },
  })).outputFiles[0].text;
});

class OperationsScreen {
  calls: string[] = [];
  generations = 0;
  constructor(readonly page: Page) {}
  async open(screen: string, mode: "normal" | "empty" | "failure" | "forbidden" = "normal") {
    await this.page.route("**/*", async (route) => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== "http://audit.test") return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.fulfill({contentType:"text/html",body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
      this.calls.push(`${request.method()} ${url.pathname}`);
      if (url.pathname.endsWith("/generate")) {
        this.generations += 1;
        return route.fulfill({status:this.generations===1?503:200,json:{ok:this.generations>1}});
      }
      if (request.method()==="PATCH") return route.fulfill({status:mode==="forbidden"?403:200,json:mode==="forbidden"?{error:"Not authorized"}:{ok:true}});
      if (mode==="failure") return route.fulfill({status:503,json:{error:"Reports temporarily unavailable"}});
      if (url.pathname.endsWith("invoice-cadence")) return route.fulfill({json:{clients:[{id:"client-test",name:"Harbour Client",invoicingCadence:"MONTHLY"}],semimonthlyClientUserIds:[]}});
      if (url.pathname.endsWith("cadence-ledger")) return route.fulfill({json:{reviewedJobs:2,limited:false,rows:[{key:"deep",label:"Deep clean",lastEvidence:null,dueDay:null,status:"UNVERIFIED"},{key:"detail",label:"Skirting",lastEvidence:{jobId:"job-test",day:"2026-09-28",basis:"Photo proof"},dueDay:"2026-10-05",status:"DUE"}]}});
      if (url.pathname.endsWith("damage-reports")) return route.fulfill({json:{reports:[]}});
      return route.fulfill({json:{jobs:mode==="empty"?[]:[{id:"job-test",jobNumber:"JOB-TEST",status:"OFFERED",jobType:"AIRBNB_TURNOVER",scheduledDate:"2026-10-03T14:00:00Z",startTime:"10:00",cleaners:[],issueCount:2,maintenanceCount:0}],stats:{total:1,completed:0,upcoming:1,skipped:0}}});
    });
    await this.page.goto(`http://audit.test/?screen=${screen}`);
    await this.page.addScriptTag({content:bundle});
  }
  async togglePhotos() { await this.page.getByRole("switch").click(); }
  async retryReport() { await this.page.getByRole("button",{name:"Retry report rebuild"}).click(); }
  async filterCompleted() { await this.page.getByRole("button",{name:/Completed/}).click(); }
  async filterAll() { await this.page.getByRole("button",{name:/^All/}).click(); }
}

test.use({timezoneId:"America/Los_Angeles"});
test("history uses Sydney service dates, truthful case labels and reversible filters",async({page})=>{
  const ui=new OperationsScreen(page);await ui.open("history");
  await expect(page.getByText("04/10/2026",{exact:false})).toBeVisible();
  await expect(page.getByText("2 cases")).toBeVisible();
  await expect(page.getByText("Awaiting confirmation")).toBeVisible();
  await ui.filterCompleted();await expect(page.getByText("No jobs match this filter")).toBeVisible();
  await ui.filterAll();await expect(page.getByText("JOB-TEST")).toBeVisible();
});
test("empty property history is distinct from completed-filter empty",async({page})=>{
  await new OperationsScreen(page).open("history","empty");
  await expect(page.getByText("Nothing scheduled yet")).toBeVisible();
});
test("failed damage report load does not claim no damage",async({page})=>{
  await new OperationsScreen(page).open("forms","failure");
  await expect(page.getByText("Reports temporarily unavailable")).toBeVisible();
  await expect(page.getByText(/No formal damage/)).toHaveCount(0);
});
test("report generation retry preserves saved preference without another patch",async({page})=>{
  const ui=new OperationsScreen(page);await ui.open("tasks");await ui.togglePhotos();
  await expect(page.getByRole("alert")).toContainText("setting was saved");
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked","false");
  await ui.retryReport();await expect(page.getByRole("alert")).toHaveCount(0);
  expect(ui.calls.filter(call=>call.startsWith("PATCH"))).toHaveLength(1);
  expect(ui.generations).toBe(2);
});
test("denied save restores state and never rebuilds shared report",async({page})=>{
  const ui=new OperationsScreen(page);await ui.open("tasks","forbidden");await ui.togglePhotos();
  await expect.poll(()=>ui.calls.some(call=>call.startsWith("PATCH"))).toBe(true);
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked","true");
  expect(ui.generations).toBe(0);
});


test("invoice cadence save prepares a schedule only and does not create or send invoices",async({page})=>{
  const ui=new OperationsScreen(page);await ui.open("cadence");
  await page.getByText("Invoice draft schedule",{exact:true}).click();
  await page.getByRole("checkbox",{name:/Harbour Client/}).check();
  await page.getByRole("button",{name:"Save draft schedule"}).click();
  await expect(page.getByRole("status")).toContainText("No invoices were created or sent");
  expect(ui.calls.filter(call=>call.startsWith("PATCH"))).toEqual(["PATCH /api/admin/settings/invoice-cadence"]);
  expect(ui.calls.every(call=>call.endsWith("/invoice-cadence"))).toBe(true);
});
test("denied cadence save shows failure without claiming schedule saved",async({page})=>{
  const ui=new OperationsScreen(page);await ui.open("cadence","forbidden");
  await page.getByText("Invoice draft schedule",{exact:true}).click();
  await page.getByRole("button",{name:"Save draft schedule"}).click();
  await expect(page.getByRole("status")).toHaveText("Not authorized");
  await expect(page.getByText(/schedule saved/)).toHaveCount(0);
});
test("cadence ledger distinguishes unverified from current and never schedules work",async({page})=>{
  const ui=new OperationsScreen(page);await ui.open("ledger");
  await expect(page.getByRole("cell",{name:"No verified date"})).toBeVisible();
  await expect(page.getByRole("cell",{name:"Unverified",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"2026-09-28"})).toHaveAttribute("href","/admin/jobs/job-test");
  expect(ui.calls).toEqual(["GET /api/admin/properties/property-test/cadence-ledger"]);
});
test("failed ledger load cannot appear up to date",async({page})=>{
  await new OperationsScreen(page).open("ledger","failure");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByText("Current evidence")).toHaveCount(0);
});
