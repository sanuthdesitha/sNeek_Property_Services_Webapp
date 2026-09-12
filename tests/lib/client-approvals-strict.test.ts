import { beforeEach, expect, it, vi } from "vitest";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: read } } }));
const valid = { id: "approval", clientId: "client", requestedByUserId: "owner", propertyId: "property", status: "PENDING", expiresAt: null };
beforeEach(() => read.mockReset());
it.each([null, "broken", {}, { approvals: {} }, { approvals: [null] }, { approvals: [{ ...valid, id: "" }] }, { approvals: [{ ...valid, status: "unknown" }] }, { approvals: [{ ...valid, propertyId: 42 }] }, { approvals: [{ ...valid, expiresAt: "bad" }] }, { approvals: [valid, valid] }])("does not silently discard malformed approval storage", async value => {
  read.mockResolvedValue({ value }); await expect(listClientApprovals({ clientId: "client", strict: true })).rejects.toThrow("Approval records are unavailable.");
});
it("distinguishes missing or genuinely empty storage from corruption", async () => {
  read.mockResolvedValue(null); expect(await listClientApprovals({ strict: true })).toEqual([]);
  read.mockResolvedValue({ value: { approvals: [] } }); expect(await listClientApprovals({ strict: true })).toEqual([]);
});
it("retains canonical scope and derived expiry behavior", async () => {
  read.mockResolvedValue({ value: { approvals: [valid, { ...valid, id: "expired", expiresAt: "2000-01-01T00:00:00Z" }, { ...valid, id: "other", clientId: "other" }] } });
  expect((await listClientApprovals({ clientId: "client", status: "PENDING", strict: true })).map(row => row.id)).toEqual(["approval"]);
});
