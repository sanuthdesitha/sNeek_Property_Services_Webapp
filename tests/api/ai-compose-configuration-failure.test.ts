// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m=vi.hoisted(()=>({auth:vi.fn(),config:vi.fn(),compose:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({requireRole:m.auth}));
vi.mock("@/lib/ai/config",()=>({getResolvedAiConfiguration:m.config}));
vi.mock("@/lib/marketing/ai-composer",()=>({composeSocialPost:m.compose}));
import {GET,POST} from "@/app/api/admin/marketing/ai-compose/route";
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({user:{id:"admin"}});m.config.mockRejectedValue(new Error("secret-database-credential"));});
it("returns a sanitized no-store response when configuration reading fails",async()=>{const response=await GET();expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(await response.text()).not.toContain("secret-database-credential");});
it("catches configuration failures before composition without calling a provider",async()=>{const response=await POST(new NextRequest("http://local",{method:"POST",body:JSON.stringify({platform:"FACEBOOK",topic:"Spring cleaning"})}));expect(response.status).toBe(502);expect(await response.text()).not.toContain("secret-database-credential");expect(m.compose).not.toHaveBeenCalled();});
