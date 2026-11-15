/**
 * Boards "QualitySubpages", "QualityInspection" and "M-QualityDetail":
 * the issue side panel (false-confirmation decision, propose deduction, record
 * the fix incl. "No after photo", drafts kept on failure, read-only view),
 * its phone layout (one decision docked, actions as sheets), the Issues tab's
 * six columns and tints, Inspectors cards, and the inspection record's AI
 * photo review (suggestions only, unapprovable findings explained, approval
 * through the tier A dialog) and reopen dialog.
 */
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/v2/admin/quality", useSearchParams: () => new URLSearchParams() }));

import { IssuePanel } from "@/components/v2/admin/quality/issues/issue-panel";
import { emptyIssueDraft, type IssueDraft } from "@/components/v2/admin/quality/issues/issue-action-forms";
import { IssuesTab } from "@/components/v2/admin/quality/hub/issues-tab";
import { InspectorsTab } from "@/components/v2/admin/quality/hub/inspectors-tab";
import { RecordAiReview } from "@/components/v2/admin/quality/record/record-ai-review";
import { InspectionRecordView } from "@/components/v2/admin/quality/record/inspection-record-view";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";
import type { InspectionRecord } from "@/lib/quality/inspection-record-types";
import { EMPTY_ISSUE_FILTERS } from "@/lib/quality/types";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches || query.includes("1023"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

function issue(extra: Partial<QualityIssueRow> = {}): QualityIssueRow {
  return {
    id: "i1", category: "kitchen", severity: "MINOR", description: "Ticked oven cleaned, photo shows residue.", rectificationStatus: "RETURNED_TO_CLEANER",
    rectificationMinutes: null, rectificationCost: null, rectificationBeforeKeys: null, rectificationAfterKeys: null, falseConfirmation: "SUSPECTED",
    guestReadyImpact: false, cleanerMarkedComplete: true, qaPhotoKeys: [], escalatedAt: null, createdAt: "2026-11-11T03:52:00Z", updatedAt: "2026-11-11T03:52:00Z",
    jobId: "job1", propertyId: "p1", cleanerId: "c1", job: { id: "job1", jobNumber: "J-1031", scheduledDate: null, propertyName: "Glebe House", propertySuburb: null },
    property: null, cleaner: { id: "c1", name: "Marco Rossi" }, raisedBy: { id: "q1", name: "Dana Whitfield" }, rectifiedBy: null,
    review: { id: "r1", score: 84, rating: "PASS", managementReview: false }, payAdjustment: null, inspectionAssignmentId: "assign-1", fixOwed: { hours: 52, overdue: true },
    ...extra,
  };
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];
let patchResponse: () => Response = () => Response.json({ ok: true });

beforeEach(() => {
  calls = [];
  patchResponse = () => Response.json({ ok: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("/api/admin/qa/issues/")) return patchResponse();
    if (String(url).startsWith("/api/uploads/access")) return Response.json({ url: "https://example.invalid/p.jpg" });
    return Response.json({});
  }));
  setPhone(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Panel({ row = issue(), canManage = true, onChanged = vi.fn(), initialDraft }: { row?: QualityIssueRow; canManage?: boolean; onChanged?: () => void; initialDraft?: IssueDraft }) {
  const [draft, setDraft] = React.useState<IssueDraft>(initialDraft ?? emptyIssueDraft(row));
  return (
    <IssuePanel issue={row} categoryLabel="Kitchen detail" canManage={canManage} falseConfirmationDeduction={10} timeZone="Australia/Sydney" draft={draft} onDraft={setDraft} onClose={vi.fn()} onChanged={onChanged} />
  );
}

const patches = () => calls.filter((call) => call.url.startsWith("/api/admin/qa/issues/")).map((call) => JSON.parse(String(call.init?.body)));

describe("issue side panel (desktop)", () => {
  it("shows the facts, the linked inspection and the false-confirmation decision, and confirms through the existing endpoint", async () => {
    const onChanged = vi.fn();
    render(<Panel onChanged={onChanged} />);
    expect(screen.getByRole("link", { name: "Inspection, score 84" }).getAttribute("href")).toBe("/v2/admin/quality/assign-1");
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.getByText("None proposed")).toBeTruthy();
    expect(screen.getByText(/Confirm keeps the −10 point false-confirmation deduction/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm, −10 points" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(patches()).toEqual([{ action: "falseConfirmation", decision: "CONFIRMED" }]);
  });

  it("proposes a deduction as a pending proposal, and keeps the draft and says it was not recorded when it fails", async () => {
    patchResponse = () => Response.json({ error: "Database unavailable" }, { status: 503 });
    const onChanged = vi.fn();
    render(<Panel onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose deduction" }));
    expect(screen.getByText(/Nothing is deducted until someone approves it/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Amount (AUD)"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Note, required"), { target: { value: "Oven not cleaned inside" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Propose deduction" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "It was not recorded: Database unavailable");
    expect(patches()).toEqual([{ action: "proposeDeduction", amount: 15, note: "Oven not cleaned inside" }]);
    expect((screen.getByLabelText("Note, required") as HTMLInputElement).value).toBe("Oven not cleaned inside");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("records a fix with no after photo, says it will read No after photo, and never sends empty photo lists", async () => {
    render(<Panel row={issue({ falseConfirmation: "NONE" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark rectification" }));
    fireEvent.click(screen.getByRole("button", { name: "QA" }));
    expect(screen.getByText(/An after photo is not required, but "No after photo" is written on the issue/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Minutes spent fixing"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save fix" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({ action: "rectify", status: "FIXED_BY_QA", minutes: 25 });
  });

  it("shows a fixed issue without an after photo as No after photo", () => {
    render(<Panel row={issue({ falseConfirmation: "NONE", rectificationStatus: "FIXED_BY_MANAGER", fixOwed: null })} />);
    expect(screen.getAllByText("No after photo").length).toBeGreaterThan(0);
  });

  it("is read-only for a QA inspector or a read-only pack: no decision, no actions, no inspection link", () => {
    render(<Panel canManage={false} />);
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Propose deduction" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Inspection, score/ })).toBeNull();
    expect(screen.getByText("Waiting for the office")).toBeTruthy();
  });
});

describe("issue on a phone", () => {
  it("docks the one decision and opens the actions as sheets with the same rules", async () => {
    setPhone(true);
    render(<Panel />);
    const bar = await screen.findByRole("group", { name: "Issue decision" });
    expect(within(bar).getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Confirm, −10" })).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Mark fixed…" }));
    const sheet = await screen.findByRole("dialog", { name: "Record the fix" });
    expect(within(sheet).getByRole("button", { name: "Save fix" })).toBeTruthy();
  });

  it("shows no docked bar to a read-only viewer", () => {
    setPhone(true);
    render(<Panel canManage={false} />);
    expect(screen.queryByRole("group", { name: "Issue decision" })).toBeNull();
  });
});

describe("Issues tab", () => {
  it("draws the six columns and tints a row that needs someone, with the reason in words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rows: [issue(), issue({ id: "i2", severity: "CRITICAL", falseConfirmation: "CONFIRMED", fixOwed: null, rectificationStatus: "ESCALATED" })], total: 2, page: 1, pageSize: 25, pageCount: 1, sort: "created", dir: "desc" })));
    render(
      <IssuesTab apiQuery="period=30d" filters={EMPTY_ISSUE_FILTERS} sort="created" dir="desc" page={1} context={{ canManage: true, inspectorView: false, timeZone: "Australia/Sydney", falseConfirmationDeduction: 10 }}
        labelFor={(key) => key} refreshToken={0} onFilters={vi.fn()} onSort={vi.fn()} onPage={vi.fn()} onOpenIssue={vi.fn()} onChanged={vi.fn()} />,
    );
    await screen.findAllByText("Ticked oven cleaned, photo shows residue.");
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean);
    expect(headers).toEqual(["Issue · raised", "Cleaner · property", "Severity", "Fix", "False confirmation"]);
    expect(screen.getByText("52 h, over 48 h")).toBeTruthy();
    expect(screen.getByText("Fix owed for over 48 hours.")).toBeTruthy();
    expect(screen.getByText("Critical issue.")).toBeTruthy();
    expect(screen.getByText("−10 points")).toBeTruthy();
    expect(screen.getByText(/Tinted rows have a fix owed for over 48 hours or a critical issue/)).toBeTruthy();
  });
});

describe("Inspectors tab on a phone", () => {
  it("shows read-only cards with words for missing values, never zero minutes", async () => {
    setPhone(true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ rows: [
      { inspectorId: "h", name: "Hannah Lee", role: "ADMIN", inspectionsCompleted: 4, avgOnSiteMinutes: null, issuesFound: { total: 0, MINOR: 0, MAJOR: 0, CRITICAL: 0 }, issuesFixedByQA: 0, rectificationMinutes: 0, rectificationCost: 0, falseConfirmationsRaised: 0, caution: { passedJobs: 0, complaints: 0, complaintRate: null } },
    ], issueTotal: 0, note: "" })));
    render(<InspectorsTab apiQuery="period=30d" sort="issues" dir="desc" refreshToken={0} hrefForTab={() => "/x"} onSort={vi.fn()} />);
    expect(await screen.findAllByText("Hannah Lee")).toBeTruthy();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not enough data").length).toBeGreaterThan(0);
    expect(screen.getByText("No issues found")).toBeTruthy();
  });
});

function record(extra: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    assignmentId: "assign-1", jobId: "job1", jobNumber: "J-1031", jobStatus: "COMPLETED", propertyName: "Glebe House", jobTypeLabel: "Airbnb turnover", serviceDate: "2026-11-11",
    cleanerNames: ["Marco Rossi"], inspectorName: "Dana Whitfield", checkIn: { at: "2026-11-11T03:20:00Z", method: "gps", reason: null }, submittedAt: "2026-11-11T03:58:00Z",
    templateLabel: "QA turnover, standard v6", verdictOptions: ["PASS", "MINOR", "FAIL", "NA"], areas: [], itemCount: 0, issueCount: 0,
    score: { score: 84, rawScore: null, adjustmentReason: null, ratingLabel: "Pass", ratingTone: "ok", passed: true, managementReview: false, lines: [{ label: "Minor", count: 2 }] },
    damage: [], nextClean: [], evidence: null, whoFixes: { status: null, events: [], note: "No rework was requested." }, signOff: null,
    reopen: { eligible: true, blockedReason: null, warnings: ["A rework job was created; reopening does not cancel it."] },
    ai: { scoreReviewId: "r1", coveredFieldIds: ["oven"], coveredMediaIds: [], deductedAnalysisIds: [] }, timeZone: "Australia/Sydney",
    ...extra,
  };
}

const AI_PAYLOAD = {
  enabled: true, hasSubmission: true, canApprove: true, scoreReview: { id: "r1", score: 84 },
  review: {
    id: "a1", status: "READY", reviewedAt: null, settings: { minConfidence: 0.8, maxScoreContribution: 10, minorPoints: 2, majorPoints: 5 },
    result: { totalPhotos: 4, observations: [
      { mediaId: "m1", fieldId: "microwave", fieldLabel: "Microwave inside", assessment: "issue", outcome: "issue", summary: "", findings: [{ id: "f1", mediaId: "m1", fieldId: "microwave", fieldLabel: "Microwave inside", description: "Splatter on the microwave roof", severity: "minor", confidence: 0.9, confidenceBand: "high" }] },
      { mediaId: "m2", fieldId: "oven", fieldLabel: "Oven cleaned inside", assessment: "issue", outcome: "issue", summary: "", findings: [{ id: "f2", mediaId: "m2", fieldId: "oven", fieldLabel: "Oven cleaned inside", description: "Residue on the back wall", severity: "minor", confidence: 0.9, confidenceBand: "high" }] },
      { mediaId: "m3", fieldId: "fridge", fieldLabel: "Fridge shelves", assessment: "issue", outcome: "issue", summary: "", findings: [{ id: "f3", mediaId: "m3", fieldId: "fridge", fieldLabel: "Fridge shelves", description: "Crumbs on the bottom shelf", severity: "minor", confidence: 0.4, confidenceBand: "low" }] },
      { mediaId: "m4", fieldId: "shower", fieldLabel: "Shower screen", assessment: "inconclusive", outcome: "cannot_tell", reason: "Glare covers the lower half of the photo.", summary: "", findings: [] },
    ] },
  },
  photos: [],
};

describe("AI photo review on the inspection record", () => {
  function stubAi(post: () => Response = () => Response.json({ ok: true })) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (init?.method === "POST") return post();
      return Response.json(AI_PAYLOAD);
    }));
  }

  it("reads suggestions only: nothing is posted on load, 'Cannot tell' is its own outcome, and the band is shown, not the number", async () => {
    stubAi();
    render(<RecordAiReview record={record()} canManage />);
    await screen.findByText("Splatter on the microwave roof");
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
    expect(screen.getByText("Cannot tell")).toBeTruthy();
    expect(screen.getByText(/Suggestions only/)).toBeTruthy();
    expect(screen.getAllByText(/high confidence/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/90%/);
  });

  it("disables findings that cannot be approved and writes why", async () => {
    stubAi();
    render(<RecordAiReview record={record()} canManage />);
    await screen.findByText("Splatter on the microwave roof");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.disabled)).toEqual([false, true, true]);
    expect(screen.getByText(/this area already has a QA finding, so change it in the QA review instead/)).toBeTruthy();
    expect(screen.getByText(/below the deduction threshold, cannot be approved/)).toBeTruthy();
  });

  it("approves only after the tier A dialog, with the selection, reason and expected score; a failure keeps the dialog open", async () => {
    stubAi(() => Response.json({ error: "The QA score changed. Refresh and review the deduction again." }, { status: 409 }));
    render(<RecordAiReview record={record()} canManage />);
    await screen.findByText("Splatter on the microwave roof");
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.change(screen.getByLabelText("Review reason, required"), { target: { value: "Splatter clear against the reference" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve 2-point deduction/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Take 2 points off this clean?")).toBeTruthy();
    expect(within(dialog).getByText(/goes from 84 to 82.*No money changes/)).toBeTruthy();
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve deduction" }));
    await within(dialog).findByText(/It was not recorded: The QA score changed/);
    const body = JSON.parse(String(calls.find((call) => call.init?.method === "POST")?.init?.body));
    expect(body).toEqual({ action: "approve", analysisId: "a1", reason: "Splatter clear against the reference", findingIds: ["f1"], expectedReviewId: "r1", expectedScore: 84 });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("explains when this person cannot approve, and locks the findings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...AI_PAYLOAD, canApprove: false })));
    render(<RecordAiReview record={record()} canManage />);
    expect(await screen.findByText(/You cannot approve deductions on this inspection/)).toBeTruthy();
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((box) => box.disabled)).toBe(true);
  });
});

describe("inspection record", () => {
  it("states that deductions are proposals and reopens through the tier A dialog with the required reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/reopen")) return Response.json({ ok: true });
      if (String(url).includes("/photo-review")) return Response.json({ ...AI_PAYLOAD, enabled: false, review: null });
      return Response.json({});
    }));
    render(<InspectionRecordView record={record()} canManage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Deductions are proposals; the office decides.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen inspection…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("A rework job was created; reopening does not cancel it.")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Reopen inspection" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why are you reopening it/), { target: { value: "Graded the rangehood Minor by mistake" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const reopen = calls.find((call) => call.url.includes("/reopen"));
    expect(JSON.parse(String(reopen?.init?.body))).toEqual({ assignmentId: "assign-1", reason: "Graded the rangehood Minor by mistake" });
  });

  it("offers no reopen to a read-only pack and keeps the workspace and report reachable", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...AI_PAYLOAD, review: null })));
    render(<InspectionRecordView record={record()} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Reopen inspection…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More inspection actions" }));
    expect(screen.getByRole("menuitem", { name: "Open inspection workspace" }).getAttribute("href")).toBe("/v2/admin/quality/assign-1?view=workspace");
    expect(screen.getByRole("menuitem", { name: "Download QA report" })).toBeTruthy();
  });
});
