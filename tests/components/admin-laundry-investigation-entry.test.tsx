import { expect,it,vi } from "vitest";
import { render,screen,fireEvent } from "@testing-library/react";
vi.mock("@/components/v2/admin/laundry/laundry-live",()=>({LaundryLive:()=>null}));
vi.mock("@/components/v2/admin/laundry/laundry-reports",()=>({LaundryReports:()=>null}));
vi.mock("@/components/v2/admin/laundry/laundry-new-run",()=>({LaundryNewRun:()=>null}));
vi.mock("@/components/v2/admin/laundry/laundry-edit-dialog",()=>({LaundryEditDialog:()=>null}));
vi.mock("@/components/v2/admin/laundry/laundry-suppliers",()=>({LaundrySuppliers:()=>null}));
vi.mock("@/components/v2/laundry/laundry-delete-dialog",()=>({useLaundryDeleteDialog:()=>({requestDelete:vi.fn(),modal:null})}));
vi.mock("@/components/shared/media-gallery",()=>({MediaGallery:()=>null}));
import { LaundryWorkspace } from "@/components/v2/admin/laundry/laundry-workspace";
it("opens property investigation from the real Estate workspace using the existing read-only feed",async()=>{
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>[{id:"r",property:{id:"p",name:"P11"},status:"CONFIRMED",pickupDate:"2026-10-04",dropoffDate:"2026-10-06"}]}));
 vi.stubGlobal("fetch",fetcher);
 try{
  render(<LaundryWorkspace/>);await screen.findByText("P11");
  fireEvent.click(screen.getByRole("button",{name:"Investigate property"}));
  fireEvent.change(screen.getByLabelText("Property"),{target:{value:"p"}});
  expect(screen.getByRole("article",{name:"Laundry run r"})).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]).toMatchObject({cache:"no-store",signal:expect.any(AbortSignal)});
 }finally{vi.unstubAllGlobals();}
});
