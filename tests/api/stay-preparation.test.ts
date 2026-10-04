// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({session:vi.fn(),list:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({requireSession:m.session}));
vi.mock("@/lib/inventory/stay-preparation",()=>({listStayPreparation:m.list,saveStayPolicy:m.save}));
import {GET,POST} from "@/app/api/inventory/stay-preparation/route";
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({user:{id:"cleaner",role:"CLEANER"}});m.list.mockResolvedValue({plans:[]});});
it("uses authenticated identity, exact property/job scope, and no-store",async()=>{const response=await GET(new NextRequest("https://app.invalid/api/inventory/stay-preparation?propertyId=p&jobId=j"));expect(m.list).toHaveBeenCalledWith({id:"cleaner",role:"CLEANER"},"p","j");expect(response.headers.get("cache-control")).toBe("private, no-store");});
it("blocks unauthenticated and unassigned reads",async()=>{m.session.mockRejectedValue(new Error("UNAUTHORIZED"));expect((await GET(new NextRequest("https://app.invalid/api/inventory/stay-preparation"))).status).toBe(401);m.session.mockResolvedValue({user:{id:"c",role:"CLEANER"}});m.list.mockRejectedValue(new Error("FORBIDDEN"));expect((await GET(new NextRequest("https://app.invalid/api/inventory/stay-preparation?propertyId=other"))).status).toBe(403);});
it("requires same-origin configuration writes",async()=>{expect((await POST(new NextRequest("https://app.invalid/api/inventory/stay-preparation",{method:"POST",headers:{origin:"https://other.invalid"},body:"{}"}))).status).toBe(403);expect(m.save).not.toHaveBeenCalled();});
it("rejects non-admin configuration without changing policy",async()=>{m.save.mockRejectedValue(new Error("FORBIDDEN"));const response=await POST(new NextRequest("https://app.invalid/api/inventory/stay-preparation",{method:"POST",headers:{origin:"https://app.invalid"},body:JSON.stringify({propertyId:"p",policy:{}})}));expect(response.status).toBe(403);expect(m.save).toHaveBeenCalledWith({id:"cleaner",role:"CLEANER"},"p",{});});
