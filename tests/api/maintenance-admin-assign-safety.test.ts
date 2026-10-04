// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({role:vi.fn(),assign:vi.fn(),worker:vi.fn(),item:vi.fn(),notify:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({requireRole:m.role}));vi.mock("@/lib/maintenance/workers",()=>({assignMaintenanceItem:m.assign}));vi.mock("@/lib/db",()=>({db:{maintenanceWorker:{findUnique:m.worker},propertyMaintenanceItem:{findUnique:m.item},notification:{create:m.notify}}}));
import {POST} from "@/app/api/admin/maintenance/[id]/assign/route";
const run=()=>POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({workerId:"worker"})}) as any,{params:{id:"item"}});
beforeEach(()=>{vi.resetAllMocks();m.role.mockResolvedValue({user:{id:"admin"}});m.assign.mockResolvedValue({id:"item",unchanged:false});m.worker.mockResolvedValue({userId:"worker-user"});m.item.mockResolvedValue({title:"Fix sink",property:{name:"Home"}});});
it("identical assignment returns unchanged without worker lookup or duplicate notification",async()=>{m.assign.mockResolvedValue({id:"item",unchanged:true});expect((await run()).status).toBe(200);expect(m.worker).not.toHaveBeenCalled();expect(m.notify).not.toHaveBeenCalled();});
it("new portal worker assignment creates categorized inbox notification",async()=>{expect((await run()).status).toBe(200);expect(m.notify).toHaveBeenCalledWith({data:expect.objectContaining({userId:"worker-user",externalId:expect.stringContaining("cases"),status:"SENT",sentAt:expect.any(Date)})});});
it("authorization failure cannot assign or notify",async()=>{m.role.mockRejectedValue(new Error("FORBIDDEN"));expect((await run()).status).toBe(403);expect(m.assign).not.toHaveBeenCalled();expect(m.notify).not.toHaveBeenCalled();});
