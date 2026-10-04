// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markMobileOutboxRows, mobilePendingMarker, MOBILE_PENDING, MOBILE_CLAIMED, MOBILE_REVIEW_REQUIRED } from "@/lib/notifications/mobile-outbox-marker";
import { dispatchMobileOutbox } from "@/lib/notifications/mobile-outbox";
const m = vi.hoisted(() => ({ rows: [] as any[], deliver: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/notifications/mobile-push", () => ({ deliverMobilePushNotification: m.deliver }));
vi.mock("@/lib/db", () => ({ db: { notification: {
  findMany: async ({ where }: any) => m.rows.filter(row => row.channel === where.channel && row.externalId?.startsWith(where.externalId.startsWith)).map(row => ({ ...row })),
  updateMany: (...args: any[]) => m.update(...args),
} } }));
const NOW = new Date("2026-10-03T01:00:00Z");
const row = (overrides = {}) => ({ id: "n1", userId: "u1", channel: "PUSH", status: "SENT", subject: "Job", body: "Update", jobId: "j1", externalId: mobilePendingMarker("jobs"), ...overrides });
beforeEach(() => {
  m.rows = []; vi.clearAllMocks(); m.deliver.mockResolvedValue("ACCEPTED");
  m.update.mockImplementation(async ({ where, data }: any) => {
    const match = m.rows.find(r => r.id === where.id && r.externalId === where.externalId);
    if (!match) return { count: 0 };
    Object.assign(match, data); return { count: 1 };
  });
});
describe("post-commit mobile outbox", () => {
  it("only marks inserts; aborted/uncommitted inserts never become dispatchable", async () => {
    const pendingTransaction = markMobileOutboxRows(row());
    expect(pendingTransaction.externalId).toBe(mobilePendingMarker("jobs"));
    await dispatchMobileOutbox(NOW);
    expect(m.deliver).not.toHaveBeenCalled(); // No row committed by producer.
    m.rows.push(pendingTransaction);
    await dispatchMobileOutbox(NOW);
    expect(m.deliver).toHaveBeenCalledTimes(1);
  });
  it("marks real createMany rows without synthesizing a send for skipDuplicates", async () => {
    const candidates = markMobileOutboxRows([row(), row({ id: "n2" })]);
    m.rows.push(candidates[0]); // Database inserts only the first candidate.
    await dispatchMobileOutbox(NOW);
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(m.deliver.mock.calls[0][1].id).toBe("n1");
  });
  it("does not replay historical rows or implicitly push an INBOX intent", async () => {
    expect(markMobileOutboxRows({ ...row({ id: "intent-i1" }), externalId: undefined }).externalId).toBeUndefined();
    expect(markMobileOutboxRows({ channel: "EMAIL", externalId: "resend-id" }).externalId).toBe("resend-id");
    m.rows = [row({ externalId: null }), row({ externalId: "old-provider-id" })];
    await dispatchMobileOutbox(NOW); expect(m.deliver).not.toHaveBeenCalled();
  });
  it("conditionally claims once across competing workers and repeated runs", async () => {
    m.rows = [row({ externalId: mobilePendingMarker("jobs") })];
    await Promise.all([dispatchMobileOutbox(NOW), dispatchMobileOutbox(NOW)]);
    await dispatchMobileOutbox(NOW);
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(m.deliver.mock.calls[0][2]).toBe("jobs");
    expect(m.rows[0].externalId).toBe("mobile-outbox:ACCEPTED");
  });
  it("does not resend ambiguous outcomes or expired claims", async () => {
    m.rows = [row(), row({ id: "expired", externalId: `${MOBILE_CLAIMED}${NOW.getTime() - 180000}:token` })];
    m.deliver.mockResolvedValue("UNCERTAIN");
    await dispatchMobileOutbox(NOW); await dispatchMobileOutbox(NOW);
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(m.rows.every(r => r.externalId === "mobile-outbox:UNCERTAIN")).toBe(true);
  });
  it("keeps a claim when acceptance-ledger write fails; no blind retry", async () => {
    m.rows = [row()]; const realUpdate = m.update.getMockImplementation()!;
    m.update.mockImplementation(async args => {
      if (args.data.externalId === "mobile-outbox:ACCEPTED") throw new Error("write unavailable");
      return realUpdate(args);
    });
    await expect(dispatchMobileOutbox(NOW)).rejects.toThrow("write unavailable");
    await dispatchMobileOutbox(new Date(NOW.getTime() + 180000));
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(m.rows[0].externalId).toBe("mobile-outbox:UNCERTAIN");
  });
});

it("holds uncategorized messages for visible review without bypassing preferences", async () => {
  const marked = markMobileOutboxRows({ ...row(), externalId: undefined });
  expect(marked.externalId).toBe(MOBILE_REVIEW_REQUIRED);
  expect(marked.status).toBe("SENT"); // Inbox retained.
  m.rows = [row({ externalId: MOBILE_PENDING })];
  await dispatchMobileOutbox(NOW);
  expect(m.deliver).not.toHaveBeenCalled();
  expect(m.rows[0].externalId).toBe(MOBILE_REVIEW_REQUIRED);
});
