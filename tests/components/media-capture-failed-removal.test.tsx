import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ rows: new Map<string, any>(), list: vi.fn(), cancel: vi.fn(), process: vi.fn(), volatile: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", () => ({ getEvidence: async (id: string) => m.rows.get(id), listEvidence: m.list, putEvidence: async (row: any) => { m.rows.set(row.id, row); }, sameEvidenceScope: (a: any, b: any) => a.jobId === b.jobId && a.draftIdentity === b.draftIdentity && a.formRevision === b.formRevision, isEvidenceVolatile:m.volatile }));
vi.mock("@/lib/cleaner/evidence-client", () => ({ processEvidence: m.process, cancelPendingEvidence: m.cancel }));
vi.mock("@/lib/uploads/capture-advice", () => ({ deviceStorageAdvice: async () => [], inspectImageCapture: async () => [] }));
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import { getActiveEvidenceUploadCount } from "@/lib/cleaner/evidence-volatile";
const scope = { jobId: "job", draftIdentity: "identity", templateId: "template", formRevision: "revision" };
const file = new File(["original-video"], "failed.mp4", { type: "video/mp4" });
beforeEach(() => { vi.clearAllMocks(); m.rows.clear(); m.list.mockImplementation(async () => Array.from(m.rows.values())); m.volatile.mockReturnValue(false); m.process.mockRejectedValue(new Error("Network interrupted")); });
function view(disabled = false, onChange = vi.fn(), value:any[] = []) { return <EvidenceContext.Provider value={scope}><MediaCapture value={value} onChange={onChange} evidenceFieldId="video" mode="video" disabled={disabled} /></EvidenceContext.Provider>; }
async function failUpload(container: HTMLElement) { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } }); await screen.findByText(/1 file did not upload. Retry the saved upload/); }
it("automatically clears active failure chips without cancelling uncertain evidence or losing original", async () => {
 const {container}=render(view()); await failUpload(container); expect(screen.queryByRole("button",{name:"Remove failed upload"})).toBeNull();expect(screen.queryByRole("button",{name:"Retry it"})).toBeNull();expect(screen.getByRole("button",{name:"Save original: failed.mp4"})).toBeVisible();expect(m.cancel).not.toHaveBeenCalled();expect(Array.from(m.rows.values())[0].blob).toBe(file);expect(getActiveEvidenceUploadCount(scope)).toBe(0);
});
it("keeps successful attachments and only starts another attempt on explicit file selection",async()=>{
 const change=vi.fn();const saved={key:"existing",url:"/existing.mp4",kind:"video"};const {container}=render(view(false,change,[saved]));await failUpload(container);expect(change).not.toHaveBeenCalled();expect(m.process).toHaveBeenCalledOnce();m.process.mockResolvedValue({key:"new",url:"/new.mp4",kind:"video"});fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[new File(["new"],"new.mp4",{type:"video/mp4"})]}});await waitFor(()=>expect(change).toHaveBeenCalledWith([saved,{key:"new",url:"/new.mp4",kind:"video"}]));expect(screen.queryByText(/Choose the file again/)).toBeNull();expect(m.cancel).not.toHaveBeenCalled();
});
it("counts active work across field unmount until processing settles, scoped to actor draft",async()=>{
 let settle!:(value:any)=>void;m.process.mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));const {container,unmount}=render(view());fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[file]}});await waitFor(()=>expect(m.process).toHaveBeenCalledOnce());expect(getActiveEvidenceUploadCount(scope)).toBe(1);expect(getActiveEvidenceUploadCount({...scope,draftIdentity:"another"})).toBe(0);unmount();expect(getActiveEvidenceUploadCount(scope)).toBe(1);await act(async()=>settle({key:"saved",url:"/saved.mp4",kind:"video"}));expect(getActiveEvidenceUploadCount(scope)).toBe(0);
});
it("keeps recent attachments received while an upload is in flight",async()=>{
 let settle!:(value:any)=>void;m.process.mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));const change=vi.fn();const {container,rerender}=render(view(false,change));fireEvent.change(container.querySelector('input[type="file"]')!,{target:{files:[file]}});await waitFor(()=>expect(m.process).toHaveBeenCalledOnce());const recent={key:"recent",url:"/recent.mp4",kind:"video"};rerender(view(false,change,[recent]));const uploaded={key:"uploaded",url:"/uploaded.mp4",kind:"video"};await act(async()=>settle(uploaded));expect(change).toHaveBeenLastCalledWith([recent,uploaded]);
});
it("shows temporary device storage advice and keeps upload picker disabled in read-only view",async()=>{m.volatile.mockReturnValue(true);const {container,rerender}=render(view());await failUpload(container);await screen.findByText(/Device storage is full or unavailable/);rerender(view(true));expect(container.querySelector('input[type="file"]')).toBeDisabled();expect(m.process).toHaveBeenCalledOnce();});
it("shows the actionable failure reason on demand without a removal step",async()=>{const {container}=render(view());await failUpload(container);const summary=screen.getByText("Why upload failed");expect(summary.closest("details")).not.toHaveAttribute("open");fireEvent.click(summary);expect(screen.getByText("Network interrupted",{exact:false})).toBeVisible();expect(screen.queryByRole("button",{name:"Remove failed upload"})).toBeNull();});

it("shares the recovery read across capture fields in the same form", async () => {
 render(<>{view()}{view()}</>);
 await waitFor(() => expect(m.list).toHaveBeenCalledTimes(1));
});
