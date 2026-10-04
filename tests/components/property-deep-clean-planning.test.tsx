import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeepCleanProposalQueue, PropertyDeepCleanPlanning } from "@/components/v2/admin/properties/property-deep-clean-planning";
const fetchMock=vi.fn();let view:any;
const response=(body:any,ok=true)=>({ok,json:async()=>body});
beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);view={plan:{revision:4,baseline:null,proposal:null},baselineValid:false,today:"2026-10-05",canManage:true,candidates:[{id:"done",jobNumber:"JOB-1",hasProof:true},{id:"missing",jobNumber:"JOB-2",hasProof:false}]};fetchMock.mockImplementation(async()=>response(view));});
afterEach(()=>vi.unstubAllGlobals());
async function open(){render(<PropertyDeepCleanPlanning propertyId="p"/>);await screen.findByText("No verified completion baseline. The next due date is unknown.");}
function due(){view.plan.baseline={jobId:"done",completedDay:"2026-07-05",dueDay:"2026-10-05"};view.baselineValid=true;view.plan.proposal={id:"p:done",status:"NEEDS_SCHEDULING",dueDay:"2026-10-05",jobId:null,scheduledDay:null};}
it("unknown baseline stays unknown; verification requires explicit review and preserves edits after conflict",async()=>{await open();expect(fetchMock).toHaveBeenCalledOnce();expect(screen.queryByLabelText("Service date")).not.toBeInTheDocument();fireEvent.click(screen.getByText("Review and verify a completed deep clean"));const save=screen.getByRole("button",{name:"Verify completion baseline"});expect(save).toBeDisabled();expect(screen.getByRole("option",{name:/JOB-2/})).toBeDisabled();fireEvent.change(screen.getByLabelText("Completed deep-clean job"),{target:{value:"done"}});fireEvent.change(screen.getByLabelText("Verification note"),{target:{value:"Reviewed all rooms"}});expect(save).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fetchMock.mockResolvedValueOnce(response({error:"Revision changed"},false));fireEvent.click(save);await screen.findByText("Revision changed");expect(screen.getByLabelText("Verification note")).toHaveValue("Reviewed all rooms");expect(screen.getByRole("checkbox")).toBeChecked();expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({action:"verify",revision:4,jobId:"done",reviewNote:"Reviewed all rooms",evidenceReviewed:true});});
it("owner supplies date explicitly and success reloads without automatically publishing",async()=>{due();render(<PropertyDeepCleanPlanning propertyId="p"/>);const input=await screen.findByLabelText("Service date");expect(input).toHaveValue("");const save=screen.getByRole("button",{name:"Create dated draft"});expect(save).toBeDisabled();fireEvent.change(input,{target:{value:"2026-10-06"}});fetchMock.mockResolvedValueOnce(response({jobId:"draft"}));fireEvent.click(save);await screen.findByText("Dated draft created. Review scope and pricing in the job before publishing.");expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({action:"schedule",revision:4,proposalId:"p:done",date:"2026-10-06"});await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));expect(screen.getByLabelText("Service date")).toHaveValue("");});
it("changed evidence blocks scheduling despite a chosen date",async()=>{due();view.baselineValid=false;render(<PropertyDeepCleanPlanning propertyId="p"/>);fireEvent.change(await screen.findByLabelText("Service date"),{target:{value:"2026-10-06"}});expect(screen.getByRole("button",{name:"Create dated draft"})).toBeDisabled();expect(screen.getByRole("alert")).toHaveTextContent("Re-verify");expect(fetchMock).toHaveBeenCalledOnce();});
it("deferred and already scheduled proposals cannot be scheduled in the card",async()=>{due();view.plan.proposal.status="DEFERRED";const mounted=render(<PropertyDeepCleanPlanning propertyId="p"/>);await screen.findByText(/Proposal deferred until/);expect(screen.queryByLabelText("Service date")).toBeNull();mounted.unmount();view.plan.proposal={...view.plan.proposal,status:"SCHEDULED",jobId:"draft",scheduledDay:"2026-10-06"};render(<PropertyDeepCleanPlanning propertyId="p"/>);expect(await screen.findByRole("link",{name:"2026-10-06"})).toHaveAttribute("href","/admin/jobs/draft");expect(screen.queryByLabelText("Service date")).toBeNull();});
it("operations read view exposes no mutation controls",async()=>{view.canManage=false;await open();expect(screen.queryByText("Review and verify a completed deep clean")).toBeNull();expect(screen.getByText(/An administrator must verify/)).toBeInTheDocument();});
it("load error is explicit and retry reads only",async()=>{fetchMock.mockResolvedValueOnce(response({error:"Unavailable"},false));render(<PropertyDeepCleanPlanning propertyId="p"/>);await screen.findByText("Unavailable");fireEvent.click(screen.getByRole("button",{name:"Reload planning"}));await screen.findByText(/next due date is unknown/);expect(fetchMock.mock.calls.every(call=>!call[1]?.method)).toBe(true);});
it("owner queue paginates without manufacturing dates and opens selected property",async()=>{fetchMock.mockResolvedValueOnce(response({proposals:[{propertyId:"p",propertyName:"Home",baselineValid:false,proposal:{id:"one",dueDay:"2026-10-05"}}],nextCursor:"next:key"}));render(<DeepCleanProposalQueue/>);await screen.findByText("Home");expect(screen.getByText(/Evidence needs re-verification/)).toBeInTheDocument();fetchMock.mockResolvedValueOnce(response({proposals:[],nextCursor:null}));fireEvent.click(screen.getByRole("button",{name:"Load more properties"}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/api/admin/deep-clean-proposals?cursor=next%3Akey",{cache:"no-store"}));fireEvent.click(screen.getByText("Home"));await screen.findByText(/next due date is unknown/);expect(fetchMock.mock.calls.every(call=>!call[1]?.method)).toBe(true);});

it("successful evidence attestation reloads the verified plan",async()=>{
 await open();fireEvent.click(screen.getByText("Review and verify a completed deep clean"));
 fireEvent.change(screen.getByLabelText("Completed deep-clean job"),{target:{value:"done"}});
 fireEvent.change(screen.getByLabelText("Verification note"),{target:{value:"All proof reviewed"}});
 fireEvent.click(screen.getByRole("checkbox"));
 fireEvent.click(screen.getByRole("button",{name:"Verify completion baseline"}));
 expect(await screen.findByRole("status")).toHaveTextContent("Baseline verified");
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(3));
});
it.each(["missing-message","non-Error"])("preserves chosen service date on %s failure",async kind=>{
 due();render(<PropertyDeepCleanPlanning propertyId="p"/>);
 fireEvent.change(await screen.findByLabelText("Service date"),{target:{value:"2026-10-06"}});
 if(kind==="missing-message")fetchMock.mockResolvedValueOnce(response({},false));else fetchMock.mockRejectedValueOnce("offline");
 fireEvent.click(screen.getByRole("button",{name:"Create dated draft"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Could not save planning.");
 expect(screen.getByLabelText("Service date")).toHaveValue("2026-10-06");
});
it("shows default load failure text and ignores late resolution after unmount",async()=>{
 fetchMock.mockResolvedValueOnce(response({},false));
 const first=render(<PropertyDeepCleanPlanning propertyId="p"/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Could not load planning.");first.unmount();
 let settle:(value:unknown)=>void=()=>{};
 fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{settle=resolve;}));
 const second=render(<PropertyDeepCleanPlanning propertyId="other"/>);second.unmount();
 settle(response(view));await Promise.resolve();expect(screen.queryByRole("alert")).toBeNull();
});
it("refreshes an empty queue, reports failures and labels valid queued evidence",async()=>{
 fetchMock.mockResolvedValueOnce(response({proposals:[],nextCursor:null}));render(<DeepCleanProposalQueue/>);
 await screen.findByText(/No undated proposals/);
 fetchMock.mockResolvedValueOnce(response({},false));fireEvent.click(screen.getByRole("button",{name:"Refresh queue"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Could not load proposals.");
 fetchMock.mockRejectedValueOnce("offline");fireEvent.click(screen.getByRole("button",{name:"Refresh queue"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh queue"})).not.toBeDisabled());
 fetchMock.mockResolvedValueOnce(response({proposals:[{propertyId:"p",propertyName:"Home",baselineValid:true,proposal:{id:"one",dueDay:"2026-10-05"}}],nextCursor:null}));
 fireEvent.click(screen.getByRole("button",{name:"Refresh queue"}));await screen.findByText(/Unscheduled/);
 expect(screen.queryByRole("alert")).toBeNull();
});
