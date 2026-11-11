// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ session: vi.fn(), findJob: vi.fn(), notify: vi.fn(), audit: vi.fn(), push: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.findJob }, notification: { create: m.notify }, auditLog: { create: m.audit } } }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.test${path}` }));
import { POST as BULK } from "@/app/api/admin/jobs/bulk-remind/route";
import { POST as SINGLE } from "@/app/api/admin/jobs/[id]/remind/route";

const cleaner = (id: string, email: string | null = `${id}@test`) => ({ userId: id, user: { id, name: id === "c1" ? "Ana" : "Ben", email } });
const jobs: Record<string, unknown> = {
  paused: { id: "paused", jobNumber: "J-1", status: "PAUSED", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: "10:00", property: { name: "Bondi", address: "" }, assignments: [cleaner("c1")] },
  emailGap: { id: "emailGap", jobNumber: "J-2", status: "IN_PROGRESS", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: null, property: { name: "Manly", address: "" }, assignments: [cleaner("c1"), cleaner("c2", null)] },
  assigned: { id: "assigned", jobNumber: "J-3", status: "ASSIGNED", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: null, property: { name: "Coogee", address: "" }, assignments: [cleaner("c1")] },
  nobody: { id: "nobody", jobNumber: "J-4", status: "SUBMITTED", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: null, property: { name: "Paddington", address: "" }, assignments: [] },
};
const post = (body: unknown) => BULK(new NextRequest("http://localhost/api/admin/jobs/bulk-remind", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
  m.findJob.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(jobs[where.id] ?? null));
  m.email.mockResolvedValue({ ok: true });
});

describe("POST /api/admin/jobs/bulk-remind", () => {
  it("reminds through the single service and returns a truthful outcome per job", async () => {
    const response = await post({ jobIds: ["paused", "assigned", "missing", "nobody", "paused"], method: "PUSH" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows.map((row: { jobId: string; outcome: string }) => [row.jobId, row.outcome])).toEqual([
      ["paused", "requested"], ["assigned", "skipped"], ["missing", "not_found"], ["nobody", "skipped"],
    ]);
    expect(body.rows[0].message).toBe("Push requested for Ana; delivery is not confirmed.");
    expect(body.rows[0].message).not.toMatch(/delivered/i);
    expect(body.rows[1].message).toContain("not in a remindable state");
    expect(body.rows[3].message).toBe("No assigned cleaners to remind.");
    expect(body.summary).toEqual({ requested: 1, partial: 0, failed: 0, skipped: 2, notFound: 1 });
    // One inbox record + push per reminded cleaner, one audit per reminded job.
    expect(m.notify).toHaveBeenCalledTimes(1);
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "admin", action: "JOB_REMINDER_SENT", jobId: "paused" });
  });

  it("reports a partly sent email job and keeps queued apart from delivered", async () => {
    const body = await (await post({ jobIds: ["emailGap"], method: "EMAIL" })).json();
    expect(body.rows[0]).toMatchObject({ outcome: "partial", requested: ["Ana"], failed: ["Ben"] });
    expect(body.rows[0].message).toBe("Email accepted by the provider for Ana; delivery is not confirmed. Not sent to Ben.");
    expect(m.email).toHaveBeenCalledTimes(1);
    expect(m.email.mock.calls[0][0]).toMatchObject({ kind: "job_reminder", to: "c1@test" });
    m.email.mockResolvedValue({ ok: false, error: "RESEND_API_KEY is not configured" });
    const failed = await (await post({ jobIds: ["paused"], method: "EMAIL" })).json();
    expect(failed.rows[0]).toMatchObject({ outcome: "failed", requested: [] });
  });

  it.each([
    [{ jobIds: [], method: "PUSH" }],
    [{ jobIds: ["paused"], method: "SMS" }],
    [{ jobIds: Array.from({ length: 201 }, (_, index) => `job-${index}`), method: "PUSH" }],
    [null],
  ])("refuses malformed input %# without sending", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(m.findJob).not.toHaveBeenCalled();
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("refuses %s before reading or sending", async (message, status) => {
    m.session.mockRejectedValue(new Error(String(message)));
    expect((await post({ jobIds: ["paused"], method: "PUSH" })).status).toBe(status);
    expect(m.findJob).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it("admits administrators and operations managers only", async () => {
    await post({ jobIds: ["paused"], method: "PUSH" });
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });
});

describe("single-job reminder keeps its responses", () => {
  const single = (id: string, body: unknown = { method: "PUSH" }) =>
    SINGLE(new NextRequest(`http://localhost/api/admin/jobs/${id}/remind`, { method: "POST", body: JSON.stringify(body) }), { params: { id } });
  it("answers 200, 409 notRemindable, 400 and 404 as before", async () => {
    expect(await (await single("paused")).json()).toEqual({ sent: ["Ana"], failed: [] });
    const conflict = await single("assigned");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ notRemindable: true });
    expect((await single("nobody")).status).toBe(400);
    expect((await single("missing")).status).toBe(404);
  });
});
