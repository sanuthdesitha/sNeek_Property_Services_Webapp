// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ticket: vi.fn(), media: vi.fn(), attachments: vi.fn(), report: vi.fn(), peek: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    issueTicket: { findUnique: m.ticket },
    submissionMedia: { count: m.media },
    caseAttachment: { count: m.attachments },
    report: { findUnique: m.report },
  },
}));
vi.mock("@/lib/jobs/peek-summary", () => ({ loadJobPeekSummary: m.peek }));

import { loadCaseLinkedContext } from "@/lib/cases/linked-context";

beforeEach(() => {
  vi.resetAllMocks();
  m.attachments.mockImplementation(async (args: { where: Record<string, unknown> }) => ("uploadedBy" in args.where ? 2 : 5));
});

it("derives job, cleaners, departing guest, report and evidence from the linked job", async () => {
  m.ticket.mockResolvedValue({ id: "c", jobId: "j", reportId: null, client: { id: "cl", name: "Harbour" }, property: null });
  m.peek.mockResolvedValue({
    id: "j", jobNumber: "J-1031", scheduledDate: "2026-11-06T00:00:00.000Z", status: "COMPLETED",
    property: { id: "p", name: "Bondi Studio", suburb: null }, client: { id: "cl", name: "Harbour" },
    assignments: [{ name: "Jane C.", isPrimary: true }],
    departing: { name: "Priya Shah", phoneLabel: null, phoneHref: null, checkoutAt: null },
  });
  m.media.mockResolvedValue(14);
  m.report.mockResolvedValue({ id: "rep" });
  const linked = await loadCaseLinkedContext("c");
  expect(linked).toMatchObject({
    job: { id: "j", jobNumber: "J-1031" },
    property: { name: "Bondi Studio" },
    cleaners: [{ name: "Jane C." }],
    departingGuest: { name: "Priya Shah" },
    report: { id: "rep", href: "/v2/admin/reports?reportId=rep" },
    evidence: { jobPhotos: 14, clientAttachments: 2, officeAttachments: 3 },
    nextSteps: { clientDraftInvoicesHref: "/v2/admin/finance?tab=invoices&client=cl&status=DRAFT" },
  });
  expect(m.media.mock.calls[0][0].where).toEqual({ mediaType: "PHOTO", submission: { jobId: "j" } });
});

it("says plainly when no job is linked instead of inventing zeros", async () => {
  m.ticket.mockResolvedValue({ id: "c", jobId: null, reportId: null, client: null, property: null });
  const linked = await loadCaseLinkedContext("c");
  expect(linked?.job).toBeNull();
  expect(linked?.evidence.jobPhotos).toBeNull();
  expect(linked?.nextSteps.clientDraftInvoicesHref).toBeNull();
  expect(m.peek).not.toHaveBeenCalled();
});
