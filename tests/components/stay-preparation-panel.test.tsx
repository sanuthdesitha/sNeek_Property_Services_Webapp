import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StayPreparationPanel } from "@/components/inventory/stay-preparation-panel";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const data={policy:{version:1,items:[],extraTowels:null},plans:[{jobId:"job",generatedAt:"2026-10-04",nights:15,guests:4,guestBasis:"PROPERTY_MAX",staySource:"ICAL",startDate:"2026-10-01",endDate:"2026-10-16",towelInstruction:"Stay exceeds 14 nights. Confirm the extra towel quantity with the office.",rows:[]}]};
it("shows truthful forecast and print option without cleaner configuration",async()=>{const fetcher=vi.fn(async()=>new Response(JSON.stringify(data)));vi.stubGlobal("fetch",fetcher);render(<StayPreparationPanel propertyId="p" jobId="j"/>);expect(await screen.findByText(/15 nights \(ICAL\)/)).toBeInTheDocument();expect(screen.queryByText("Save preparation rules")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:/Print/})).toBeInTheDocument();expect(fetcher).toHaveBeenCalledWith("/api/inventory/stay-preparation?propertyId=p&jobId=j",expect.objectContaining({cache:"no-store"}));});
it("allows office configuration and preserves unknown towel quantity",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(data))));render(<StayPreparationPanel propertyId="p" isAdmin items={[{itemId:"paper",item:{name:"Paper",unit:"roll"}}]}/>);expect(await screen.findByRole("button",{name:"Save preparation rules"})).toBeInTheDocument();expect(screen.getByLabelText("Extra towels for stays over 14 nights")).toHaveValue(null);});

it("does not allow edits before saved policy has loaded",async()=>{let resolve!: (response:Response)=>void;vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(done=>{resolve=done;})));render(<StayPreparationPanel propertyId="p" isAdmin/>);expect(screen.getByRole("status")).toHaveTextContent("Loading stay preparation");expect(screen.queryByText("No associated job preparation available.")).toBeNull();expect(screen.queryByRole("button",{name:"Save preparation rules"})).not.toBeInTheDocument();await act(async()=>resolve(new Response(JSON.stringify({...data,policy:{...data.policy,extraTowels:7}}))));expect(await screen.findByLabelText("Extra towels for stays over 14 nights")).toHaveValue(7);});

it("locks pending policy input and never applies an old save response to the next property", async () => {
 let finish!: (response: Response) => void;
 const pending = new Promise<Response>(resolve => { finish = resolve; });
 vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
  if (options?.method === "POST") return pending;
  return new Response(JSON.stringify({...data, policy: {...data.policy, extraTowels: url.includes("propertyId=next") ? 9 : 2}}));
 }));
 const {rerender} = render(<StayPreparationPanel propertyId="first" isAdmin />);
 const field = await screen.findByLabelText("Extra towels for stays over 14 nights");
 fireEvent.click(screen.getByRole("button", {name: "Save preparation rules"}));
 expect(field).toBeDisabled();
 rerender(<StayPreparationPanel propertyId="next" isAdmin />);
 expect(await screen.findByLabelText("Extra towels for stays over 14 nights")).toHaveValue(9);
 await act(async () => finish(new Response("{}")));
 expect(screen.getByLabelText("Extra towels for stays over 14 nights")).toHaveValue(9);
 expect(screen.queryByText("Preparation rules saved.")).toBeNull();
});
