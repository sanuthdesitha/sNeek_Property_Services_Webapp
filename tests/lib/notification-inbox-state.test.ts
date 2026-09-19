// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { changeInboxState, readInboxStates, inboxStateKey } from "@/lib/notifications/inbox-state-store";
import { emptyInboxState } from "@/lib/notifications/inbox-state";
const m = vi.hoisted(() => ({ find: vi.fn(), read: vi.fn(), many: vi.fn(), write: vi.fn(), audit: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findMany: m.many }, $transaction: m.transaction } }));
let stored: unknown;
beforeEach(() => {
  vi.resetAllMocks(); stored = undefined;
  m.find.mockResolvedValue({ subject: "Job changed", body: "Please review", deliveryStatus: "FAILED" });
  m.read.mockImplementation(async () => stored === undefined ? null : { value: stored });
  m.many.mockImplementation(async () => stored === undefined ? [] : [{ key: inboxStateKey("owner", "note"), value: stored }]);
  m.transaction.mockImplementation(async callback => {
    let staged = stored;
    const result = await callback({ $executeRaw: m.lock, notification: { findFirst: m.find }, appSetting: { findUnique: m.read, upsert: async (args: any) => { m.write(args); staged = args.update.value; } }, auditLog: { create: m.audit } });
    stored = staged; return result;
  });
});
const mutate = (action: string, revision = 0) => changeInboxState("owner", Role.CLIENT, { id: "note", revision, action });
it("keeps personal follow-up independent from delivery with scoped audited writes", async () => {
  expect(await mutate("NEEDS_ACTION")).toMatchObject({ revision: 1, followUp: "NEEDS_ACTION" });
  expect(m.find).toHaveBeenCalledWith({ where: { userId: "owner", channel: "PUSH", id: "note" } });
  expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "owner", entityId: "note", action: "NOTIFICATION_INBOX_NEEDS_ACTION" }) });
  expect(m.lock).toHaveBeenCalled();
  expect(await mutate("RESOLVE", 1)).toMatchObject({ revision: 2, followUp: "RESOLVED" });
  expect(await mutate("ARCHIVE", 2)).toMatchObject({ revision: 3, archived: true, followUp: "RESOLVED" });
  expect(await mutate("RESTORE", 3)).toMatchObject({ revision: 4, archived: false });
  expect(await mutate("CLEAR_FOLLOW_UP", 4)).toMatchObject({ followUp: "NONE" });
});
it.each([null, { subject: "Email sent to client", body: "delivery" }])("rejects missing, foreign, or hidden notifications", async row => {
  m.find.mockResolvedValue(row); await expect(mutate("ARCHIVE")).rejects.toMatchObject({ status: 404 }); expect(m.write).not.toHaveBeenCalled();
});
it("rejects conflicts and resolution without active personal follow-up", async () => {
  await expect(mutate("RESOLVE")).rejects.toMatchObject({ status: 409 });
  await mutate("NEEDS_ACTION"); await expect(mutate("ARCHIVE")).rejects.toMatchObject({ status: 409 });
  expect(stored).toMatchObject({ archived: false });
});
it("rejects invalid input before storage", async () => {
  await expect(mutate("SEND_EMAIL")).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
});
it("fails closed on corrupt state without resetting it", async () => {
  stored = { version: 999 }; await expect(mutate("ARCHIVE")).rejects.toMatchObject({ status: 503 });
  await expect(readInboxStates("owner", ["note"])).rejects.toMatchObject({ status: 503 }); expect(m.write).not.toHaveBeenCalled();
});
it("rolls back when audit fails", async () => {
  m.audit.mockRejectedValue(new Error("audit unavailable")); await expect(mutate("ARCHIVE")).rejects.toThrow("audit unavailable"); expect(stored).toBeUndefined();
});
it("reads only requested recipient keys and returns defaults without writes", async () => {
  expect(await readInboxStates("owner", [])).toEqual({}); expect(m.many).not.toHaveBeenCalled();
  expect(await readInboxStates("owner", ["note"])).toEqual({ note: emptyInboxState() });
  await mutate("ARCHIVE"); expect(await readInboxStates("owner", ["note", "other"])).toMatchObject({ note: { archived: true }, other: { revision: 0 } });
  expect(m.many).toHaveBeenLastCalledWith({ where: { key: { in: [inboxStateKey("owner", "note"), inboxStateKey("owner", "other")] } } });
});

it("persists and audits snooze without changing personal follow-up or notification delivery", async () => {
  const until = new Date(Date.now() + 3600000).toISOString();
  await mutate("NEEDS_ACTION");
  const next = await changeInboxState("owner", Role.CLIENT, { id: "note", revision: 1, action: "SNOOZE", snoozedUntil: until });
  expect(next).toMatchObject({ revision: 2, followUp: "NEEDS_ACTION", archived: false, snoozedUntil: until });
  expect(m.audit).toHaveBeenLastCalledWith({ data: expect.objectContaining({ action: "NOTIFICATION_INBOX_SNOOZE", after: next }) });
  expect(await mutate("UNSNOOZE", 2)).toMatchObject({ followUp: "NEEDS_ACTION", snoozedUntil: null, revision: 3 });
});
it.each([undefined, "bad-date", new Date(0).toISOString(), new Date(Date.now() + 31 * 86400000).toISOString()])("rejects invalid or out-of-policy snooze %s", async snoozedUntil => {
  await expect(changeInboxState("owner", Role.CLIENT, { id: "note", revision: 0, action: "SNOOZE", snoozedUntil })).rejects.toMatchObject({ status: 400 }); expect(m.write).not.toHaveBeenCalled();
});
it("rejects snooze of archived notification and unexpected date on another action", async () => {
  await mutate("ARCHIVE"); const until = new Date(Date.now() + 3600000).toISOString();
  await expect(changeInboxState("owner", Role.CLIENT, { id: "note", revision: 1, action: "SNOOZE", snoozedUntil: until })).rejects.toMatchObject({ status: 400 });
  await expect(changeInboxState("owner", Role.CLIENT, { id: "note", revision: 1, action: "RESTORE", snoozedUntil: until })).rejects.toMatchObject({ status: 400 });
});
it("legacy state remains readable and snooze expiry is read-only", async () => {
  const { isInboxSnoozed } = await import("@/lib/notifications/inbox-state");
  stored = emptyInboxState(); expect((await readInboxStates("owner", ["note"])).note).toEqual(emptyInboxState());
  expect(isInboxSnoozed(undefined)).toBe(false); expect(isInboxSnoozed(emptyInboxState())).toBe(false);
  const until = new Date(Date.now() + 3600000).toISOString(); stored = { ...emptyInboxState(), snoozedUntil: until };
  const state = (await readInboxStates("owner", ["note"])).note;
  expect(isInboxSnoozed(state, Date.parse(until) - 1)).toBe(true); expect(isInboxSnoozed(state, Date.parse(until))).toBe(false); expect(m.write).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
it("archiving ends snooze and stale snooze revisions cannot overwrite newer state", async () => {
  await changeInboxState("owner", Role.CLIENT, { id: "note", revision: 0, action: "SNOOZE", snoozedUntil: new Date(Date.now() + 3600000).toISOString() });
  await expect(mutate("UNSNOOZE", 0)).rejects.toMatchObject({ status: 409 });
  expect(await mutate("ARCHIVE", 1)).toMatchObject({ archived: true, snoozedUntil: null });
});
it("audits explicit recipient acknowledgement independently from read, delivery and follow-up", async () => {
  await mutate("NEEDS_ACTION"); const result = await mutate("ACKNOWLEDGE", 1);
  expect(result).toMatchObject({ followUp: "NEEDS_ACTION", archived: false, revision: 2, acknowledgedAt: expect.any(String) });
  expect(m.audit).toHaveBeenLastCalledWith({ data: expect.objectContaining({ userId: "owner", action: "NOTIFICATION_INBOX_ACKNOWLEDGE", entityId: "note", after: result }) });
  expect(await mutate("RESOLVE", 2)).toMatchObject({ followUp: "RESOLVED", acknowledgedAt: result.acknowledgedAt });
  await expect(mutate("ACKNOWLEDGE", 3)).rejects.toMatchObject({ status: 409 });
});
