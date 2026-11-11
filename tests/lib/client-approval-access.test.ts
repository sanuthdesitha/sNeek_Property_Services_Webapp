// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findUser: vi.fn(), findClients: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.findUser }, client: { findMany: m.findClients } } }));
vi.mock("@/lib/commercial/client-approvals", () => ({ listClientApprovals: m.list }));

import {
  canAccessClientApproval,
  countPendingApprovalsForUser,
  listApprovalsForViewer,
  resolveApprovalViewer,
} from "@/lib/commercial/client-approval-access";

const viewer = { userId: "user-1", email: "owner@example.test", clientIds: new Set(["client-1"]) };
const approval = (overrides: Record<string, unknown> = {}) => ({
  id: "a", clientId: "client-1", status: "PENDING", metadata: null, ...overrides,
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m.findUser.mockResolvedValue({ clientId: "client-1", email: " Owner@Example.test ", emailVerified: new Date("2026-01-01") });
  m.findClients.mockResolvedValue([]);
});

describe("who may see a client approval", () => {
  it("allows the client the request was raised for", () => {
    expect(canAccessClientApproval(approval(), viewer)).toBe(true);
  });

  it("refuses another client's request", () => {
    expect(canAccessClientApproval(approval({ clientId: "client-2" }), viewer)).toBe(false);
  });

  it("allows a named recipient by user id or by email, ignoring case", () => {
    expect(canAccessClientApproval(approval({ clientId: "client-2", metadata: { recipientUserIds: ["user-1"] } }), viewer)).toBe(true);
    expect(canAccessClientApproval(approval({ clientId: "client-2", metadata: { recipientEmails: ["OWNER@example.test"] } }), viewer)).toBe(true);
  });

  it("does not match a recipient email for an account without one", () => {
    const anonymous = { ...viewer, email: null, clientIds: new Set<string>() };
    expect(canAccessClientApproval(approval({ metadata: { recipientEmails: [""] } }), anonymous)).toBe(false);
  });

  it("ignores malformed recipient metadata", () => {
    expect(canAccessClientApproval(approval({ clientId: "client-2", metadata: { recipientUserIds: "user-1", recipientEmails: [7, null] } }), viewer)).toBe(false);
  });
});

describe("the viewer", () => {
  it("normalises the email and includes client records that share it", async () => {
    m.findClients.mockResolvedValue([{ id: "client-9" }]);
    const resolved = await resolveApprovalViewer("user-1");
    expect(resolved?.email).toBe("owner@example.test");
    expect(Array.from(resolved!.clientIds).sort()).toEqual(["client-1", "client-9"]);
    expect(m.findClients).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: "owner@example.test", mode: "insensitive" } },
    }));
  });

  it("grants nothing by email when the address is unverified, such as after a self-service change", async () => {
    m.findUser.mockResolvedValue({ clientId: "client-1", email: "victim@example.test", emailVerified: null });
    const resolved = await resolveApprovalViewer("user-1");
    expect(resolved?.email).toBeNull();
    expect(Array.from(resolved!.clientIds)).toEqual(["client-1"]);
    expect(m.findClients).not.toHaveBeenCalled();
    // Addressed to that email, or raised for the client record that uses it: both refused.
    expect(canAccessClientApproval(approval({ clientId: "client-2", metadata: { recipientEmails: ["victim@example.test"] } }), resolved!)).toBe(false);
    // Their own client's requests are still theirs.
    expect(canAccessClientApproval(approval(), resolved!)).toBe(true);
  });

  it("is absent for an unknown account", async () => {
    m.findUser.mockResolvedValue(null);
    expect(await resolveApprovalViewer("ghost")).toBeNull();
  });
});

describe("the navigation badge and the page agree", () => {
  const rows = [
    approval({ id: "mine-pending" }),
    approval({ id: "other-pending", clientId: "client-2" }),
  ];

  it("counts exactly the pending requests the page lists for this person", async () => {
    m.list.mockImplementation(async ({ status }: any) => rows.filter((row) => !status || row.status === status));
    expect(await countPendingApprovalsForUser("user-1")).toBe(1);
    expect(m.list).toHaveBeenCalledWith({ status: "PENDING", strict: true });
    const listed = await listApprovalsForViewer(viewer, { status: "PENDING" });
    expect(listed.map((row) => row.id)).toEqual(["mine-pending"]);
  });

  it("fails rather than reporting zero when stored requests cannot be read", async () => {
    m.list.mockRejectedValue(new Error("CLIENT_APPROVALS_UNAVAILABLE"));
    await expect(countPendingApprovalsForUser("user-1")).rejects.toThrow("CLIENT_APPROVALS_UNAVAILABLE");
  });
});
