// @vitest-environment node
import {NextRequest} from "next/server";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({session:vi.fn(),bags:vi.fn(),record:vi.fn(),profit:vi.fn(),cost:vi.fn()}));vi.mock("@/lib/auth/session",()=>({requireSession:m.session}));vi.mock("@/lib/laundry/bag-custody",()=>({listBagCustody:m.bags,recordBagEvent:m.record}));vi.mock("@/lib/finance/turnover-profit",()=>({readTurnoverProfit:m.profit,saveTurnoverCosts:m.cost}));
import {GET as bags,POST as record} from "@/app/api/laundry/bag-custody/route";import {GET as profit,POST as cost} from "@/app/api/admin/turnover-profit/route";
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({user:{id:"c",role:"CLEANER"}});m.bags.mockResolvedValue({events:[]});});
it("uses authenticated task scope and never caches operational records",async()=>{const response=await bags(new NextRequest("https://app.invalid/api/laundry/bag-custody?taskId=t"));expect(m.bags).toHaveBeenCalledWith({id:"c",role:"CLEANER"},"t");expect(response.headers.get("cache-control")).toBe("private, no-store");});
it("does not return profit to a forbidden role",async()=>{m.profit.mockRejectedValue(new Error("FORBIDDEN"));expect((await profit(new NextRequest("https://app.invalid/api/admin/turnover-profit?jobId=j"))).status).toBe(403)});
it.each([record,cost])("blocks cross-origin writes before accessing records",async handler=>{expect((await handler(new NextRequest("https://app.invalid/api/operation",{method:"POST",headers:{origin:"https://foreign.invalid"},body:"{}"}))).status).toBe(403);expect(m.record).not.toHaveBeenCalled();expect(m.cost).not.toHaveBeenCalled()});
