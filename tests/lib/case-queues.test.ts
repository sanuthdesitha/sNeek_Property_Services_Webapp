// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CASE_QUEUES,
  SLA_RISK_WINDOW_MS,
  buildCaseFilterWhere,
  buildQueueWhere,
  compareCases,
  isKnownCaseQueueValue,
  lastPublicMessageIsFromClient,
  parseCaseQueue,
  type CaseSortKey,
} from "@/lib/cases/queues";
import { listQueryString, stateFromLink, DEFAULT_CASE_STATE } from "@/components/v2/admin/cases/case-url-state";
import { summaryFromDetail, type CaseDetail } from "@/components/v2/admin/cases/case-types";

const now = new Date("2026-11-11T00:00:00.000Z");
const context = { viewerId: "me", now, needsReplyIds: ["c1", "c2"] };

describe("queue definitions", () => {
  it("keeps every old view and maps the old ids", () => {
    expect(CASE_QUEUES).toEqual(expect.arrayContaining(["open", "mine", "waitingClient", "slaRisk", "all", "needsReply", "unowned", "resolved"]));
    expect(parseCaseQueue("awaitingClient")).toBe("waitingClient");
    expect(parseCaseQueue("mine")).toBe("mine");
    expect(parseCaseQueue("bogus", "open")).toBe("open");
    expect(isKnownCaseQueueValue("awaitingClient")).toBe(true);
    expect(isKnownCaseQueueValue("bogus")).toBe(false);
  });

  it("needs my reply = open, owned by me and among the client-last ids", () => {
    expect(buildQueueWhere("needsReply", context)).toEqual({
      AND: [{ status: { notIn: ["RESOLVED", "CLOSED"] } }, { assignedToUserId: "me" }, { id: { in: ["c1", "c2"] } }],
    });
  });

  it("only a CLIENT or VA author counts as the client having replied", () => {
    expect(lastPublicMessageIsFromClient("CLIENT")).toBe(true);
    expect(lastPublicMessageIsFromClient("VA")).toBe(true);
    expect(lastPublicMessageIsFromClient("ADMIN")).toBe(false);
    expect(lastPublicMessageIsFromClient(null)).toBe(false);
  });

  it("unowned, waiting on client, resolved and all", () => {
    expect(buildQueueWhere("unowned", context)).toEqual({ AND: [{ status: { notIn: ["RESOLVED", "CLOSED"] } }, { assignedToUserId: null }] });
    expect(buildQueueWhere("waitingClient", context)).toEqual({ status: "WAITING_CLIENT" });
    expect(buildQueueWhere("resolved", context)).toEqual({ status: { in: ["RESOLVED", "CLOSED"] } });
    expect(buildQueueWhere("all", context)).toEqual({});
  });

  it("SLA at risk keeps the old 4 hour window, including passed deadlines", () => {
    const where = buildQueueWhere("slaRisk", context) as { AND: Array<Record<string, unknown>> };
    expect(where.AND[1]).toEqual({ slaBreachAt: { not: null, lt: new Date(now.getTime() + SLA_RISK_WINDOW_MS) } });
  });

  it("filters: OTHER means none of the known stored types; job and report links", () => {
    expect(buildCaseFilterWhere({ caseType: "OTHER" })).toEqual([{ caseType: { notIn: ["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OPS", "SLA"] } }]);
    expect(buildCaseFilterWhere({ jobId: "j1", reportId: "r1", assigneeUserId: "__unassigned" })).toEqual([
      { jobId: "j1" },
      { reportId: "r1" },
      { assignedToUserId: null },
    ]);
  });
});

describe("sorting", () => {
  const row = (id: string, patch: Partial<CaseSortKey>): CaseSortKey => ({
    id, status: "OPEN", severity: "MEDIUM", caseType: "OPS", slaBreachAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"), ...patch,
  });
  const rows = [
    row("none", {}),
    row("late", { slaBreachAt: new Date("2026-11-12T00:00:00Z"), createdAt: new Date("2026-11-05T00:00:00Z") }),
    row("soon", { slaBreachAt: new Date("2026-11-11T02:00:00Z"), severity: "LOW" }),
    row("damage", { caseType: "DAMAGE", severity: "CRITICAL", createdAt: new Date("2026-10-01T00:00:00Z") }),
    row("closed", { status: "RESOLVED", slaBreachAt: new Date("2026-11-10T00:00:00Z") }),
  ];
  const ids = (sort: Parameters<typeof compareCases>[0], dir: "asc" | "desc") => [...rows].sort(compareCases(sort, dir)).map((r) => r.id);

  it("SLA soonest first; no live deadline (or closed) last, damage first among those", () => {
    expect(ids("sla", "asc")).toEqual(["soon", "late", "damage", "closed", "none"]);
    expect(ids("sla", "desc").slice(0, 2)).toEqual(["late", "soon"]);
  });
  it("newest, oldest, priority and type", () => {
    expect(ids("created", "desc")[0]).toBe("late");
    expect(ids("created", "asc")[0]).toBe("damage");
    expect(ids("priority", "desc")[0]).toBe("damage");
    expect(ids("priority", "desc").at(-1)).toBe("soon");
    expect(ids("type", "asc")[0]).toBe("damage");
  });
});

describe("links and list query", () => {
  it("?jobId opens all of that job's cases; ?queue and old ?view are honoured", () => {
    const fromJob = stateFromLink("?jobId=job_1", DEFAULT_CASE_STATE);
    expect(fromJob.queue).toBe("all");
    expect(fromJob.filters.jobId).toBe("job_1");
    expect(listQueryString(fromJob, "")).toContain("jobId=job_1");
    expect(stateFromLink("?view=awaitingClient", DEFAULT_CASE_STATE).queue).toBe("waitingClient");
    expect(stateFromLink("?reportId=r9", DEFAULT_CASE_STATE).filters.reportId).toBe("r9");
    expect(stateFromLink("", { ...DEFAULT_CASE_STATE, queue: "mine" }).queue).toBe("mine");
  });
  it("rejects malformed ids from a link", () => {
    expect(stateFromLink("?jobId=bad%20id", DEFAULT_CASE_STATE).filters.jobId).toBe("");
  });
});

describe("summary from a saved case", () => {
  const base: CaseDetail = {
    id: "c", title: "T", description: "", severity: "HIGH", status: "OPEN", slaBreachAt: null, caseType: "DAMAGE",
    clientVisible: true, clientCanReply: true, resolutionNote: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z",
    source: null, jobId: null, reportId: null, clientId: null, propertyId: null, attachments: [],
    comments: [
      { id: "1", body: "Please check", isInternal: false, createdAt: "2026-11-01T01:00:00Z", author: { id: "u", name: "Client", email: "c@x", role: "CLIENT" } },
      { id: "2", body: "office only", isInternal: true, createdAt: "2026-11-01T02:00:00Z", author: { id: "a", name: "A", email: "a@x", role: "ADMIN" } },
    ],
  };
  it("an internal note does not hide the client's last message", () => {
    const summary = summaryFromDetail(base);
    expect(summary.clientReplied).toBe(true);
    expect(summary.lastMessage?.excerpt).toBe("Please check");
    expect(summary.commentCount).toBe(2);
  });
});
