import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DraftEvidenceReview } from "@/components/v2/admin/jobs/draft-evidence-review";
const row = { key: "forms/old-job/capture/cleaner/photo.jpg", name: "Old photo", previewUrl: "/fixture.jpg", version: "a".repeat(64), removed: false, issues: ["Stored under another job"], source: { jobId: "old-job", captureId: "capture", userId: "cleaner", legacy: false }, locations: [{ type: "bulkPool" }], receipts: [{ id: "capture", formRevision: "old-version", draftIdentity: "old-context" }] };
let fetcher: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const review = (locked = false) => ({ jobId: "job", locked, rows: [row], history: [] });
beforeEach(() => { fetcher = vi.fn(async () => json(review())); vi.stubGlobal("fetch", fetcher); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function open() { render(<DraftEvidenceReview jobId="job" />); await screen.findByText("1 active · 1 need review"); fireEvent.click(screen.getByRole("button", { name: /Draft evidence review/ })); }
function select() { fireEvent.click(screen.getByRole("checkbox", { name: "Select Old photo", exact: true })); fireEvent.change(screen.getByRole("textbox"), { target: { value: "Wrong historical job evidence" } }); }
it("starts compact, requires selection, reason and confirmation", async () => {
 render(<DraftEvidenceReview jobId="job" />); await screen.findByText("1 active · 1 need review");
 expect(screen.queryByRole("checkbox")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: /Draft evidence review/ }));
 fireEvent.click(screen.getByRole("checkbox", { name: "Select Old photo", exact: true }));
 expect(screen.getByRole("button", { name: "Discard 1 selected" })).toBeDisabled();
 fireEvent.change(screen.getByRole("textbox"), { target: { value: "Wrong historical job evidence" } });
 vi.mocked(window.confirm).mockReturnValue(false);
 fireEvent.click(screen.getByRole("button", { name: "Discard 1 selected" }));
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(screen.getByRole("checkbox", { name: "Select Old photo", exact: true })).toBeChecked();
});
it("prevents repeated requests and rejects an incorrect acknowledgement", async () => {
 let resolve!: (response: Response) => void;
 fetcher.mockImplementation(async (_url, options) => options?.method === "POST" ? new Promise(r => { resolve = r; }) : json(review()));
 await open(); select(); const button = screen.getByRole("button", { name: "Discard 1 selected" });
 fireEvent.click(button); fireEvent.click(button);
 expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
 await act(async () => resolve(json({ ok: true, key: "wrong", discardedReference: true })));
 expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
 expect(screen.getByRole("textbox")).toHaveValue("Wrong historical job evidence");
});
it("limits select-all to the current page and clears on page/filter changes", async () => {
 fetcher.mockImplementation(async () => json({ ...review(), rows: Array.from({length: 18}, (_, i) => ({ ...row, key: String(i), name: "Photo " + i })) }));
 render(<DraftEvidenceReview jobId="job" />); await screen.findByText("18 active · 18 need review");
 fireEvent.click(screen.getByRole("button", { name: /Draft evidence review/ }));
 fireEvent.click(screen.getByRole("checkbox", { name: "Select all on this page (8)" }));
 expect(screen.getByText("8 selected")).toBeInTheDocument();
 expect(screen.queryByRole("checkbox", { name: "Select Photo 8", exact: true })).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Next" }));
 expect(screen.getByText("0 selected")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("checkbox", { name: "Select Photo 8", exact: true }));
 fireEvent.change(screen.getByRole("combobox"), {target: { value: "removed" }});
 expect(screen.queryByRole("textbox")).toBeNull();
});
it("shares a reason, stops at partial failure, retains remaining selection and refreshes stale versions", async () => {
 const second = { ...row, key: "second", name: "Second", version: "b".repeat(64), issues: ["Different account context"] };
 let removed = false;
 fetcher.mockImplementation(async (_url, options) => {
  if(options?.method === "POST") { const body=JSON.parse(options.body); if(body.key===row.key) { removed=true; return json({ok:true,key:row.key,discardedReference:true}); } return json({error:"Changed; refresh"},409); }
  return json({...review(),rows:[{...row,removed},second]});
 });
 render(<DraftEvidenceReview jobId="job" />); await screen.findByText("2 active · 2 need review");
 fireEvent.click(screen.getByRole("button",{name:/Draft evidence review/}));
 fireEvent.click(screen.getByRole("checkbox",{name:"Select all on this page (2)"}));
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"Wrong historical job evidence"}});
 fireEvent.click(screen.getByRole("button",{name:"Discard 2 selected"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("1 of 2 confirmed");
 const posts=fetcher.mock.calls.filter(call=>call[1]?.method==="POST").map(call=>JSON.parse(call[1].body));
 expect(posts.map(p=>p.reason)).toEqual(["Wrong historical job evidence","Wrong historical job evidence"]);
 expect(posts.map(p=>p.version)).toEqual([row.version,second.version]);
 expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Different account context"));
 expect(screen.getByRole("checkbox",{name:"Select Second",exact:true})).toBeChecked();
 fireEvent.click(screen.getByRole("button",{name:"Refresh"}));
 await waitFor(()=>expect(screen.queryByRole("textbox")).toBeNull());
});
it("is read-only for submitted jobs", async () => {
 fetcher.mockImplementation(async()=>json(review(true))); await open();
 expect(screen.getByText(/read-only/)).toBeInTheDocument();
 expect(screen.queryByRole("checkbox")).toBeNull();
});
it("fails closed after access is revoked", async () => {
 fetcher.mockImplementation(async()=>json({error:"FORBIDDEN"},403));
 render(<DraftEvidenceReview jobId="job" />);
 await screen.findByText("Could not load · expand to retry");
 fireEvent.click(screen.getByRole("button",{name:/Draft evidence review/}));
 expect(screen.getByRole("alert")).toHaveTextContent("FORBIDDEN");
 expect(screen.queryByRole("checkbox")).toBeNull();
});
it("stops after the in-flight reference and leaves later selections untouched", async () => {
 let resolve!: (response: Response) => void;
 fetcher.mockImplementation(async (_url, options) => options?.method === "POST" ? new Promise(r => { resolve = r; }) : json({...review(),rows:[row,{...row,key:"second",name:"Second"}]}));
 render(<DraftEvidenceReview jobId="job" />); await screen.findByText("2 active · 2 need review");
 fireEvent.click(screen.getByRole("button",{name:/Draft evidence review/}));
 fireEvent.click(screen.getByRole("checkbox",{name:"Select all on this page (2)"}));
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"Wrong historical job evidence"}});
 fireEvent.click(screen.getByRole("button",{name:"Discard 2 selected"}));
 fireEvent.click(screen.getByRole("button",{name:"Stop after current"}));
 await act(async()=>resolve(json({ok:true,key:row.key,discardedReference:true})));
 expect(fetcher.mock.calls.filter(call=>call[1]?.method==="POST")).toHaveLength(1);
 expect(screen.getByRole("checkbox",{name:"Select Second",exact:true})).toBeChecked();
 expect(screen.getByText(/Stopped; remaining references/)).toBeInTheDocument();
});
it("reloads confirmed removals and the audit history, retaining removed items as read-only", async () => {
 let removed=false;
 fetcher.mockImplementation(async(_url,options)=>{
  if(options?.method==="POST"){removed=true;return json({ok:true,key:row.key,discardedReference:true});}
  return json({...review(),rows:[{...row,removed}],history:removed?[{id:"audit",action:"OFFICE_DISCARD_DRAFT_REFERENCE",user:{name:"Office User"},createdAt:"2026-10-07T00:00:00Z",after:{reason:"Wrong historical job evidence"}}]:[]});
 });
 await open();select();fireEvent.click(screen.getByRole("button",{name:"Discard 1 selected"}));
 await screen.findByText("Resolution history (latest 50)");
 expect(screen.queryByRole("textbox")).toBeNull();
 fireEvent.change(screen.getByRole("combobox"),{target:{value:"removed"}});
 expect(screen.getByText("Removed from draft")).toBeInTheDocument();
 expect(screen.queryByRole("checkbox")).toBeNull();
});
