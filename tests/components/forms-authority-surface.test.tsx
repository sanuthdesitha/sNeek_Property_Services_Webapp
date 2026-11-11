import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({session:{user:{role:"OPS_MANAGER",primaryRole:"OPS_MANAGER"}} as any,role:vi.fn(),fetch:vi.fn()}));
vi.mock("next-auth/react",()=>({useSession:()=>({data:m.session})}));
vi.mock("@/lib/auth/session",()=>({requireRole:m.role}));
vi.mock("next/navigation",()=>({usePathname:()=>"/v2/admin/forms",useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/components/forms/checklists-workspace",()=>({ChecklistsWorkspace:()=>null}));
vi.mock("@/components/v2/admin/forms/management/estate-checklists-workspace",()=>({EstateChecklistsWorkspace:()=> <div>Checklist workspace</div>}));
// The merged Forms library page (2026-11): ops access, tab counts and the
// embedded workspaces are stubbed; the Job forms tab reads the library API.
vi.mock("@/lib/db",()=>({db:{}}));
vi.mock("@/lib/rbac/ops-access",()=>({getOpsAccess:async()=>null}));
vi.mock("@/lib/forms/library-tab-counts",()=>({getFormsTabCounts:async()=>({forms:1,qa:0})}));
vi.mock("@/components/v2/admin/forms/library/form-stats-panel",()=>({FormStatsPanel:()=>null}));
vi.mock("@/components/v2/admin/forms/library/forms-subviews",()=>({ChecklistBlocksTab:()=>null,MessageTemplatesTab:()=>null}));
import FormsPage from "@/app/admin/forms/page";
import EstateFormsPage from "@/app/v2/admin/forms/page";
import { JobFormsLibrary } from "@/components/v2/admin/forms/library/job-forms-library";
const template={id:"t",name:"Turnover proof",serviceType:"AIRBNB_TURNOVER",kind:"CUSTOM",version:1,status:"draft",draftBaseVersion:null,usage:{kind:"not-live"},questions:3,avgMinutes:null,completionPct:null,submissionsInWindow:0,checks:{status:"pass",errors:0,warnings:0,issues:[]},neverAnswered:[],usageSample:0,groupId:null,tags:[],changedAt:"2026-11-01T00:00:00.000Z"};
const payload={rows:[template],total:1,page:1,pageSize:25,pageCount:1,sort:"name",dir:"asc",counts:{active:1,drafts:1,archived:0,problems:0,byGroup:{none:1},tags:[]},statsBasis:{weeks:8,minSample:5},timezone:"Australia/Sydney"};
const answer=(url:string)=>url.includes("/form-templates/library")?payload:url.includes("/form-templates/groups")?{groups:[]}:[];
beforeEach(()=>{vi.clearAllMocks();m.session={user:{role:"OPS_MANAGER",primaryRole:"OPS_MANAGER"}};m.role.mockResolvedValue(m.session);m.fetch.mockImplementation(async(url:string)=>({ok:true,json:async()=>answer(url)}));vi.stubGlobal("fetch",m.fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it.each([null,{user:{role:"CLEANER"}},{user:{role:"OPS_MANAGER",primaryRole:"OPS_MANAGER"}}])("legacy builder does not expose write controls to unadmitted user %j",async session=>{
 m.session=session;render(<FormsPage/>);
 expect(await screen.findByRole("link",{name:"View form templates and submissions"})).toHaveAttribute("href","/v2/admin/forms");
 expect(screen.queryByRole("button",{name:/Save/})).toBeNull();
 expect(m.fetch.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
});
// 2026-11 builder step: the classic page's own builder (which wrote the live
// form) was retired; admitted admins keep the page, and template creation and
// editing open the estate builder.
it.each([{role:"ADMIN",primaryRole:"ADMIN"},{role:"OPS_MANAGER",primaryRole:"ADMIN"}])("legacy forms page remains usable for admitted admin %j",async user=>{
 m.session={user};render(<FormsPage/>);
 expect(await screen.findByRole("heading",{name:"Forms"})).toBeVisible();
 expect(screen.queryByRole("link",{name:"View form templates and submissions"})).toBeNull();
 expect(screen.getAllByRole("link",{name:/New template/i}).every((link)=>link.getAttribute("href")==="/v2/admin/forms/new")).toBe(true);
 expect(m.fetch.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
});
it("defaults the job forms library to read only while preserving search and refresh",async()=>{
 render(<JobFormsLibrary canWrite={false}/>);expect(await screen.findByText("Turnover proof")).toBeVisible();
 expect(screen.getByText("Read only")).toBeVisible();
 expect(screen.queryByRole("link",{name:/Edit/})).toBeNull();
 expect(screen.queryByRole("checkbox")).toBeNull();
 expect(screen.queryByRole("button",{name:"+ New"})).toBeNull();
 expect(screen.getByRole("searchbox",{name:"Search forms"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:/Has problems/}));
 await waitFor(()=>expect(m.fetch.mock.calls.some(([url])=>String(url).includes("problems=1"))).toBe(true));
 expect(m.fetch.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
});
it.each([
 {user:{role:"OPS_MANAGER",heldRoles:["OPS_MANAGER"]},writes:false},
 {user:{role:"OPS_MANAGER",heldRoles:["OPS_MANAGER","ADMIN"]},writes:true},
 {user:{role:"ADMIN"},writes:true},
])("server role admission determines actual template write controls: %j",async({user,writes})=>{
 m.role.mockResolvedValue({user});render(await EstateFormsPage({searchParams:{}}));
 expect(await screen.findByText("Turnover proof")).toBeVisible();
 expect(m.role).toHaveBeenCalledWith(["ADMIN","OPS_MANAGER"]);
 expect(screen.getAllByRole("heading",{level:1})).toHaveLength(1);
 expect(Boolean(screen.queryByRole("button",{name:/New form/}))).toBe(writes);
 expect(Boolean(screen.queryByRole("link",{name:"Edit Turnover proof"}))).toBe(writes);
 expect(Boolean(screen.queryByRole("checkbox",{name:"Select Turnover proof"}))).toBe(writes);
});
it("denied server admission cannot load templates or render a builder",async()=>{
 m.role.mockRejectedValue(new Error("FORBIDDEN"));await expect(EstateFormsPage({searchParams:{}})).rejects.toThrow("FORBIDDEN");expect(m.fetch).not.toHaveBeenCalled();
});
