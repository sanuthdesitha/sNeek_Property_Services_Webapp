import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({session:{user:{role:"OPS_MANAGER",primaryRole:"OPS_MANAGER"}} as any,role:vi.fn(),fetch:vi.fn()}));
vi.mock("next-auth/react",()=>({useSession:()=>({data:m.session})}));
vi.mock("@/lib/auth/session",()=>({requireRole:m.role}));
vi.mock("next/navigation",()=>({usePathname:()=>"/v2/admin/forms",useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/components/forms/checklists-workspace",()=>({ChecklistsWorkspace:()=>null}));
vi.mock("@/components/v2/admin/forms/management/estate-checklists-workspace",()=>({EstateChecklistsWorkspace:()=> <div>Checklist workspace</div>}));
import FormsPage from "@/app/admin/forms/page";
import EstateFormsPage from "@/app/v2/admin/forms/page";
import { EstateFormsList } from "@/components/v2/admin/forms/management/estate-forms-list";
const template={id:"t",name:"Turnover proof",serviceType:"AIRBNB_TURNOVER",version:1,isActive:false,publishedAt:null,archivedAt:null};
beforeEach(()=>{vi.clearAllMocks();m.session={user:{role:"OPS_MANAGER",primaryRole:"OPS_MANAGER"}};m.role.mockResolvedValue(m.session);m.fetch.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes("form-templates")?[template]:[]}));vi.stubGlobal("fetch",m.fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it.each([null,{user:{role:"CLEANER"}},{user:{role:"OPS_MANAGER",primaryRole:"OPS_MANAGER"}}])("legacy builder does not expose write controls to unadmitted user %j",async session=>{
 m.session=session;render(<FormsPage/>);
 expect(await screen.findByRole("link",{name:"View form templates and submissions"})).toHaveAttribute("href","/v2/admin/forms");
 expect(screen.queryByRole("button",{name:/Save/})).toBeNull();
 expect(m.fetch.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
});
it.each([{role:"ADMIN",primaryRole:"ADMIN"},{role:"OPS_MANAGER",primaryRole:"ADMIN"}])("legacy builder remains usable for admitted admin %j",async user=>{
 m.session={user};render(<FormsPage/>);
 expect(await screen.findByRole("heading",{name:"Forms"})).toBeVisible();
 expect(screen.queryByRole("link",{name:"View form templates and submissions"})).toBeNull();
 expect(screen.getByRole("button",{name:"Create template"})).toBeEnabled();
});
it("defaults template list to read only while preserving search and refresh",async()=>{
 render(<EstateFormsList tab="templates"/>);expect(await screen.findByText("Turnover proof")).toBeVisible();
 expect(screen.getByText("Read only")).toBeVisible();
 for(const name of ["New template","Edit"])expect(screen.queryByRole("link",{name})).toBeNull();
 for(const name of [/Duplicate/,/Publish/,/Delete template/])expect(screen.queryByRole("button",{name})).toBeNull();
 fireEvent.change(screen.getByPlaceholderText("Search name / service…"),{target:{value:"does not match"}});
 expect(screen.queryByText("Turnover proof")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/Refresh/}));await waitFor(()=>expect(m.fetch).toHaveBeenCalledTimes(4));
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
 expect(Boolean(screen.queryByRole("link",{name:"New template"}))).toBe(writes);
 expect(Boolean(screen.queryByRole("link",{name:"Edit"}))).toBe(writes);
 expect(Boolean(screen.queryByRole("button",{name:"Publish"}))).toBe(writes);
});
it("denied server admission cannot load templates or render a builder",async()=>{
 m.role.mockRejectedValue(new Error("FORBIDDEN"));await expect(EstateFormsPage({searchParams:{}})).rejects.toThrow("FORBIDDEN");expect(m.fetch).not.toHaveBeenCalled();
});
