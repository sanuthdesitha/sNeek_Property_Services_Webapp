import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LaundryInvestigation } from "@/components/v2/admin/laundry/laundry-investigation";
import type { LaundryTaskDTO } from "@/components/v2/admin/laundry/laundry-shared";
vi.mock("@/components/shared/media-gallery",()=>({MediaGallery:()=> <div>Evidence gallery</div>}));
const fetcher=vi.fn(),copy=vi.fn();
const tasks:LaundryTaskDTO[]=[{id:"r1",propertyId:"p1",jobId:"j1",property:{id:"p1",name:"Jackson P11"},status:"PICKED_UP",pickupDate:"2026-10-04",dropoffDate:"2026-10-06",confirmations:[{id:"receipt",confirmedByName:"Pat",createdAt:"2026-10-04T04:00:00Z",photoUrl:"https://example.invalid/proof.jpg",notes:'{"event":"PICKED_UP","bagCount":2}'}]},
 {id:"r2",property:{id:"p2",name:"Other property"},status:"PENDING",pickupDate:"2026-10-04",dropoffDate:"2026-10-06"}];
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal("fetch",fetcher);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}});copy.mockResolvedValue(undefined);});
afterEach(()=>vi.unstubAllGlobals());
function choose(){fireEvent.change(screen.getByLabelText("Property"),{target:{value:"p1"}});}
function dates(){fireEvent.change(screen.getByLabelText("From date"),{target:{value:"2026-09-01"}});fireEvent.change(screen.getByLabelText("Through date"),{target:{value:"2026-09-30"}});}
it("investigates one property with participants, evidence, next step and manual copy only",async()=>{
 render(<LaundryInvestigation initialTasks={tasks}/>);choose();
 expect(screen.getByRole("article",{name:"Laundry run r1"})).toBeInTheDocument();expect(screen.queryByRole("article",{name:"Laundry run r2"})).toBeNull();
 expect(screen.getByText(/Recorded by Pat/)).toBeInTheDocument();expect(screen.getByText("Evidence gallery")).toBeInTheDocument();
 expect(screen.getByRole("link",{name:"Open linked job"})).toHaveAttribute("href","/v2/admin/jobs/j1");
 fireEvent.click(screen.getByRole("button",{name:"Copy property update"}));await screen.findByText("Update copied. Nothing was sent.");
 expect(copy).toHaveBeenCalledWith(expect.stringContaining("onward custody not confirmed"));
 expect(copy.mock.calls[0][0]).not.toContain("https://");expect(fetcher).not.toHaveBeenCalled();
});
it("retains a reviewable update if clipboard permission fails",async()=>{
 copy.mockRejectedValue(new Error("denied"));render(<LaundryInvestigation initialTasks={tasks}/>);choose();
 fireEvent.click(screen.getByRole("button",{name:"Copy property update"}));await screen.findByText(/Clipboard unavailable/);
 expect((screen.getByLabelText("Property update") as HTMLTextAreaElement).value).toContain("Jackson P11");
});
it("loads an explicit historical range through the existing read-only feed",async()=>{
 fetcher.mockResolvedValue({ok:true,json:async()=>tasks});render(<LaundryInvestigation initialTasks={[]}/>);dates();
 fireEvent.click(screen.getByRole("button",{name:"Load date range"}));await screen.findByText(/2026-09-01 through 2026-09-30/);
 expect(fetcher).toHaveBeenCalledWith("/api/laundry/week?start=2026-09-01T00%3A00%3A00.000Z&days=30",{cache:"no-store"});choose();
 expect(screen.getByRole("article",{name:"Laundry run r1"})).toBeInTheDocument();
});
it("rejects missing/reversed/oversized dates without requests and retains records after a load failure",async()=>{
 render(<LaundryInvestigation initialTasks={tasks}/>);choose();fireEvent.click(screen.getByRole("button",{name:"Load date range"}));
 expect(screen.getByRole("alert")).toHaveTextContent("1–366 days");expect(fetcher).not.toHaveBeenCalled();
 dates();fetcher.mockResolvedValue({ok:false,json:async()=>({error:"History unavailable"})});fireEvent.click(screen.getByRole("button",{name:"Load date range"}));
 await screen.findByText(/History unavailable/);expect(screen.getByRole("article",{name:"Laundry run r1"})).toBeInTheDocument();
});
it("receives initial records if the parent feed finishes after the tab opens",()=>{
 const view=render(<LaundryInvestigation initialTasks={[]}/>);expect(screen.getByText(/No laundry runs/)).toBeInTheDocument();
 view.rerender(<LaundryInvestigation initialTasks={tasks}/>);choose();expect(screen.getByRole("article",{name:"Laundry run r1"})).toBeInTheDocument();
});
it("shows missing evidence and actor data for a pending run without fabricating stock",()=>{
 render(<LaundryInvestigation initialTasks={tasks}/>);
 fireEvent.change(screen.getByLabelText("Property"),{target:{value:"p2"}});
 expect(screen.getByText("No recorded photo evidence.")).toBeInTheDocument();
 expect(screen.getByText("Current holder not confirmed by the records")).toBeInTheDocument();
 expect(screen.queryByRole("link",{name:"Open linked job"})).toBeNull();
});
it.each(["invalid-body","no-message","network"])("keeps history visible after %s",async kind=>{
 if(kind==="network")fetcher.mockRejectedValue("offline");else fetcher.mockResolvedValue({ok:kind==="invalid-body",json:async()=>({})});
 render(<LaundryInvestigation initialTasks={tasks}/>);choose();dates();fireEvent.click(screen.getByRole("button",{name:"Load date range"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Could not load laundry history.");
 expect(screen.getByRole("article",{name:"Laundry run r1"})).toBeInTheDocument();
});
it("keeps distinct property IDs even when names match and updates contain no proof links",()=>{
 render(<LaundryInvestigation initialTasks={[...tasks,{...tasks[1],id:"r3",property:{id:"p3",name:"Jackson P11"}},{...tasks[1],id:"r4",property:null}]}/>);
 expect(screen.getAllByRole("option",{name:"Jackson P11"})).toHaveLength(2);
 fireEvent.change(screen.getByLabelText("Property"),{target:{value:"p3"}});
 expect(screen.getByRole("article",{name:"Laundry run r3"})).toBeInTheDocument();expect(screen.queryByRole("article",{name:"Laundry run r1"})).toBeNull();
});
