// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), transaction: vi.fn(), lock: vi.fn(),
  user: vi.fn(), admins: vi.fn(), clients: vi.fn(), notify: vi.fn(),
  audit: vi.fn(), email: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  appSetting: { findUnique: mocks.read, upsert: mocks.write },
  $transaction: mocks.transaction,
  user: { findUnique: mocks.user, findMany: mocks.admins },
  client: { findMany: mocks.clients },
  notification: { createMany: mocks.notify },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "user" } }) }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: mocks.audit }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: mocks.email }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Test" }) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { clientApprovalVersion, type ClientApprovalRecord } from "@/lib/commercial/client-approvals";
import { GET } from "@/app/api/client/approvals/route";
import { POST as respond } from "@/app/api/client/approvals/[id]/respond/route";
import { POST as counter } from "@/app/api/client/approvals/[id]/counter/route";

function record(): ClientApprovalRecord {
  return {
    id: "approval", clientId: "client", propertyId: null, jobId: null, quoteId: null,
    title: "Work", description: "Reviewed scope", amount: 100, currency: "AUD",
    status: "PENDING", requestedByUserId: "admin", requestedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null, respondedByUserId: null, respondedAt: null, responseNote: null,
    counterAmount: null, counterNote: null, counterAt: null, counterByUserId: null,
    metadata: { recipientUserIds: ["user"], recipientEmails: ["user@example.com"] },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
let current: ClientApprovalRecord;
beforeEach(() => {
  vi.clearAllMocks();
  current = record();
  mocks.read.mockImplementation(async () => ({ value: { approvals: [structuredClone(current)] } }));
  mocks.user.mockResolvedValue({ clientId: "client", name: "Client", email: "user@example.com" });
  mocks.clients.mockResolvedValue([]);
  mocks.admins.mockResolvedValue([{ id: "admin", email: "admin@example.com" }]);
  mocks.transaction.mockImplementation(async (callback) => callback({
    $executeRaw: mocks.lock,
    appSetting: { findUnique: mocks.read, upsert: mocks.write },
  }));
});

describe("client approval snapshot version", () => {
  it("is a deterministic SHA256 of the sanitized snapshot", () => {
    expect(clientApprovalVersion(current)).toMatch(/^[a-f0-9]{64}$/);
    expect(clientApprovalVersion(structuredClone(current))).toBe(clientApprovalVersion(current));
    expect(clientApprovalVersion({ ...current, title: "  Work  " })).toBe(clientApprovalVersion(current));
  });

  it.each([
    { amount: 101 }, { currency: "USD" }, { title: "New work" }, { description: "New scope" },
    { propertyId: "property" }, { jobId: "job" }, { quoteId: "quote" }, { clientId: "other" },
    { expiresAt: "2027-01-01T00:00:00.000Z" }, { status: "CANCELLED" },
    { metadata: { recipientUserIds: ["other"] } },
    { metadata: { recipientEmails: ["other@example.com"] } },
  ] satisfies Partial<ClientApprovalRecord>[])("detects same-timestamp edit %j", (patch) => {
    expect(clientApprovalVersion({ ...current, ...patch })).not.toBe(clientApprovalVersion(current));
  });

  it("GET exposes the version of the approval snapshot", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expect.objectContaining({ id: current.id, version: clientApprovalVersion(current) })]);
  });
});

describe.each([
  ["approve", respond, { decision: "APPROVE" }],
  ["decline", respond, { decision: "DECLINE" }],
  ["counter", counter, { amount: 80 }],
] as const)("%s review guard", (_, post, body) => {
  const request = (expectedVersion: unknown) => post(new NextRequest("http://localhost/api/client/approvals/approval", {
    method: "POST", body: JSON.stringify({ ...body, expectedVersion }),
  }), { params: { id: "approval" } });

  function noSideEffects() {
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  }

  it.each([undefined, null, "", " ", "a".repeat(63), "g".repeat(64), 123])("rejects invalid version %j without side effects", async (version) => {
    const response = await request(version);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STALE_APPROVAL", error: expect.stringContaining("Refresh") });
    expect(mocks.transaction).not.toHaveBeenCalled();
    noSideEffects();
  });

  it.each([{ amount: 200 }, { metadata: { recipientUserIds: ["replacement"] } }])("checks current snapshot inside the lock after an edit %j", async (patch) => {
    const version = clientApprovalVersion(current);
    const before = structuredClone(current);
    mocks.lock.mockImplementationOnce(async () => { current = { ...current, ...patch }; });
    const response = await request(version);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "STALE_APPROVAL" });
    expect(current).toEqual({ ...before, ...patch });
    expect(mocks.lock).toHaveBeenCalledOnce();
    noSideEffects();
  });

  it("accepts the current version and records the decision", async () => {
    const response = await request(clientApprovalVersion(current));
    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.email).toHaveBeenCalledOnce();
  });
});
