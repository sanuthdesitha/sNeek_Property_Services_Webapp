import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyJobsHistory } from "@/components/v2/admin/properties/property-jobs-history";
import { FormsQaCentre } from "@/components/v2/admin/jobs/forms-qa-centre";
import { TaskEvidence } from "@/components/v2/admin/jobs/task-evidence";
import { MediaGallery } from "@/components/shared/media-gallery";
const mocks=vi.hoisted(()=>({toast:vi.fn(),fetch:vi.fn()}));
vi.mock("@/hooks/use-toast",()=>({toast:mocks.toast}));
// The isolated component test replaces Next image optimization with a native image.
// eslint-disable-next-line @next/next/no-img-element
vi.mock("next/image",()=>({default:({fill,sizes,alt="",...props}:any)=><img alt={alt} {...props} />}));
vi.mock("@/components/v2/shared/report-download-dialog",()=>({DownloadButton:()=> <button>Download</button>}));
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("fetch",mocks.fetch);});
const response=(body:unknown,ok=true)=>({ok,json:async()=>body});
describe("audit operating UI",()=>{
  it("shows Sydney dates and case counts without claiming damage reports",async()=>{
    mocks.fetch.mockResolvedValue(response({jobs:[{id:"j",jobNumber:"JOB-TEST",jobType:"AIRBNB_TURNOVER",status:"OFFERED",scheduledDate:"2026-10-03T14:00:00Z",cleaners:[],issueCount:2,maintenanceCount:0}],stats:{total:1,completed:0,upcoming:1,skipped:0}}));
    render(<PropertyJobsHistory propertyId="p" />);
    expect(await screen.findByText("04/10/2026")).toBeVisible();
    expect(screen.getByText("2 cases")).toBeVisible();
    expect(screen.getByText("Awaiting confirmation")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:/Completed/}));
    expect(screen.getByText("No jobs match this filter")).toBeVisible();
  });
  it("does not report zero damage when the report request failed",async()=>{
    mocks.fetch.mockResolvedValue(response({error:"Reports temporarily unavailable"},false));
    render(<FormsQaCentre jobId="j" hasReport={false} hasQaReview={false}/>);
    expect(await screen.findByText("Reports temporarily unavailable")).toBeVisible();
    expect(screen.queryByText(/No formal damage/)).toBeNull();
  });
  it("keeps saved setting and retries only generation after rebuild fails",async()=>{
    mocks.fetch.mockResolvedValueOnce(response({ok:true})).mockResolvedValueOnce(response({error:"Unavailable"},false)).mockResolvedValueOnce(response({ok:true}));
    render(<TaskEvidence jobId="j" includeInReport={true} tasks={[{id:"t",title:"Proof",executionStatus:"COMPLETED",proof:[{id:"m",mediaType:"PHOTO",url:"/proof.jpg",kind:"COMPLETION_PROOF"}]} as any]}/>);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("setting was saved");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked","false");
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({description:"The report has been rebuilt."}));
    fireEvent.click(screen.getByRole("button",{name:"Retry report rebuild"}));
    await waitFor(()=>expect(screen.queryByRole("alert")).toBeNull());
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls[2][0]).toContain("/reports/j/generate");
  });
  it("restores toggle on rejected save and does not generate a report",async()=>{
    mocks.fetch.mockResolvedValue(response({},false));
    render(<TaskEvidence jobId="j" includeInReport={true} tasks={[{id:"t",title:"Proof",proof:[{id:"m",mediaType:"PHOTO",url:"/proof.jpg"}]} as any]}/>);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(()=>expect(screen.getByRole("switch")).toHaveAttribute("aria-checked","true"));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps a saved choice when rebuild retry fails without issuing another save",async()=>{
    mocks.fetch.mockResolvedValueOnce(response({ok:true})).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response({},false));
    render(<TaskEvidence jobId="j" includeInReport={false} tasks={[{id:"t",title:"Proof",completionNote:"Verified",proof:[{id:"m",mediaType:"PHOTO",url:"/proof.jpg"}]} as any]}/>);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("setting was saved");
    fireEvent.click(screen.getByRole("button",{name:"Retry report rebuild"}));
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("rebuilding still failed"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked","true");
    expect(mocks.fetch.mock.calls.filter(([,options])=>options?.method==="PATCH")).toHaveLength(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("restores the choice after an unstructured transport failure without claiming a report save",async()=>{
    mocks.fetch.mockRejectedValue(null);
    render(<TaskEvidence jobId="j" includeInReport={true} tasks={[{id:"t",title:"Proof",completionNote:"Verified",proof:[{id:"m",mediaType:"PHOTO",url:"/proof.jpg"}]} as any]}/>);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:"Try again.",variant:"destructive"})));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked","true");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps not-applicable proof distinct from completed or failed work",()=>{
    render(<TaskEvidence jobId="j" includeInReport={true} tasks={[{id:"t",title:"Optional detail",executionStatus:"CANCELLED",completionDisposition:"NOT_APPLICABLE",completionNote:"Surface absent",proof:[{id:"m",mediaType:"PHOTO",url:"/proof.jpg",kind:"FAILURE_PROOF"}]} as any]}/>);
    expect(screen.getByText("Not applicable")).toBeVisible();
    expect(screen.queryByText("Not completed")).toBeNull();
    expect(screen.getByText("Surface absent")).toBeVisible();
  });
  it("offers recovery without describing video errors as lost evidence",async()=>{
    const reload=vi.fn();render(<MediaGallery items={[{id:"v",url:"/proof.mp4",mediaType:"VIDEO",label:"Balcony proof"}]} onReload={reload}/>);
    fireEvent.click(screen.getByTitle("Balcony proof"));
    const video=document.querySelector("video[controls]")!;fireEvent.error(video);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be played");
    fireEvent.click(screen.getByRole("button",{name:"Reload media"}));expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByRole("link",{name:"Open video file"})).toHaveAttribute("href","/proof.mp4");
  });
});
