import { expect, it } from "vitest";
import { addCalendarMonths, buildCadenceLedger, sydneyWeekStart, type CadenceEvidenceJob } from "@/lib/properties/cadence-ledger";
const now = new Date("2026-10-05T01:00:00Z");
function job(extra: Partial<CadenceEvidenceJob> = {}): CadenceEvidenceJob { return { id: "j", jobType: "GENERAL_CLEAN", status: "COMPLETED", completedAt: "2026-09-28T01:00:00Z", formSubmissions: [], jobTasks: [], ...extra }; }
it("adds calendar months, clamps end of month, and handles year rollover", () => {
 expect(addCalendarMonths("2026-11-30", 3)).toBe("2027-02-28"); expect(addCalendarMonths("2027-11-30", 3)).toBe("2028-02-29"); expect(addCalendarMonths("2026-01-31", 3)).toBe("2026-04-30");
});
it("uses Sydney weekly boundaries across daylight saving", () => { expect(sydneyWeekStart("2026-10-04")).toBe("2026-09-28"); expect(sydneyWeekStart("2026-10-05")).toBe("2026-10-05"); });
it("does not turn future/uncompleted jobs or checkbox-only work into proof", () => {
 const rows = buildCadenceLedger([job({ status: "ASSIGNED", jobType: "DEEP_CLEAN", formSubmissions: [{ data: {}, media: [{ s3Key: "p" }] }] }), job({ completedAt: "2027-01-01", jobType: "DEEP_CLEAN" }), job({ jobTasks: [{ title: "Skirting", executionStatus: "COMPLETED", attachments: [] }] })], now);
 expect(rows.every(row => row.status === "UNVERIFIED")).toBe(true);
});
it("links evidence and marks calendar due without creating any scheduled work", () => {
 const rows = buildCadenceLedger([job({ jobType: "DEEP_CLEAN", completedAt: "2026-07-04T01:00:00Z", formSubmissions: [{ data: {}, media: [{ s3Key: "p" }] }] }), job({ jobTasks: [{ title: "Skirting boards", executionStatus: "COMPLETED", attachments: [{ kind: "COMPLETION_PROOF", s3Key: "proof" }] }] })], now);
 expect(rows[0]).toMatchObject({ dueDay: "2026-10-04", status: "OVERDUE", lastEvidence: { jobId: "j" } });
 expect(rows[1]).toMatchObject({ dueDay: "2026-10-05", status: "DUE" });
});
it("only trusts uploaded keys backed by submission media", () => {
 const data = { __templateSchema: { sections: [{ fields: [{ id: "cobwebs", label: "Cobwebs" }] }] }, uploads: { cobwebs: ["actual"] } };
 expect(buildCadenceLedger([job({ formSubmissions: [{ data, media: [{ s3Key: "other" }] }] })], now)[2].status).toBe("UNVERIFIED");
 expect(buildCadenceLedger([job({ formSubmissions: [{ data, media: [{ s3Key: "actual" }] }] })], now)[2].status).toBe("DUE");
});
it("rejects invalid dates, missing completion and empty media references", () => {
 const rows = buildCadenceLedger([
  job({ completedAt: null }), job({ completedAt: "invalid" }),
  job({ jobType: "DEEP_CLEAN", formSubmissions: [{ data: null, media: [{ s3Key: null }] }] }),
  job({ jobTasks: [{ title: "Skirting", executionStatus: "COMPLETED", attachments: [{ kind: "COMPLETION_PROOF", s3Key: null }] }, { title: "Cobwebs", executionStatus: "OPEN", attachments: [{ kind: "COMPLETION_PROOF", s3Key: "p" }] }, { title: "Detail", executionStatus: "COMPLETED", attachments: [{ kind: "FAILURE_PROOF", s3Key: "p" }] }] }),
 ], now);
 expect(rows.every(row => row.status === "UNVERIFIED")).toBe(true);
});
it("selects newest evidence independently of input order, ignores older and same-day candidates", () => {
 const evidence = (id: string, completedAt: string) => job({ id, completedAt, jobTasks: [{ title: "Detail extras", executionStatus: "COMPLETED", attachments: [{ kind: "COMPLETION_PROOF", s3Key: "p" }] }] });
 const rows = buildCadenceLedger([evidence("old", "2026-09-20"), evidence("latest", "2026-10-05"), evidence("older", "2026-09-28"), evidence("same", "2026-10-05")], now);
 expect(rows[3]).toMatchObject({ status: "CURRENT", dueDay: "2026-10-12", lastEvidence: { jobId: "latest" } });
});
it("finds nested checklist uploads, legacy string keys and id-only labels", () => {
 const data = { __templateSchema: { sections: [{}, { fields: [null, { children: [{ id: "rot_detail", children: [], label: null }, { id: "skirting", label: "Skirting" }, { id: "cobweb" }, { id: "blank" }] }] }] }, uploads: { rot_detail: "proof", skirting: ["proof"], cobweb: "proof", blank: false } };
 const rows = buildCadenceLedger([job({ status: "INVOICED", formSubmissions: [{ data, media: [{ s3Key: null }, { s3Key: "proof" }] }] })], now);
 expect(rows.slice(1).map(row => row.status)).toEqual(["DUE", "DUE", "DUE"]);
 expect(rows[3].lastEvidence?.basis).toBe("Checklist photo: rot_detail");
});
it("marks deep clean due on exact calendar anniversary and uses default current time", () => {
 const item = job({ completedAt: "2026-07-05T01:00:00Z", jobType: "DEEP_CLEAN", formSubmissions: [{ data: { __templateSchema: {} }, media: [{ s3Key: "p" }] }] });
 expect(buildCadenceLedger([item], now)[0].status).toBe("DUE");
 expect(buildCadenceLedger([])).toHaveLength(4);
});
