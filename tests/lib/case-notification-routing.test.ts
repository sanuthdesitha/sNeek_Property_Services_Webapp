import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ users: vi.fn(), create: vi.fn(), allowed: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: m.users }, notification: { create: m.create } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Case", html: "Case" }) }));
vi.mock("@/lib/notification-templates", () => ({ renderNotificationTemplate: () => ({ webSubject: "Case update", webBody: "Review case" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.allowed }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn(() => { throw new Error("SMS must remain disabled"); }) }));
vi.mock("@/lib/inventory/client-shopping-notifications", () => ({ notifyClientsShoppingCompleted: vi.fn() }));
import { notifyStockRunRequested } from "@/lib/inventory/notifications";
import { notifyCaseCreated, notifyCaseUpdated } from "@/lib/cases/notifications";
const caseItem = { id: "case", title: "Damage", caseType: "DAMAGE", status: "OPEN", jobId: "job", clientId: "client", clientVisible: false };
beforeEach(() => { vi.resetAllMocks(); m.allowed.mockImplementation(async ({ channel }) => channel === "WEB"); m.users.mockImplementation(async ({ where }) => where.role === "CLIENT" ? [{ id: "client-user", role: "CLIENT", email: null }] : [{ id: "admin", role: "ADMIN", email: null }]); });
it("marks private case office notices for cases push without notifying clients", async () => {
 await notifyCaseCreated({ caseItem, actorLabel: "Cleaner" });
 expect(m.create).toHaveBeenCalledTimes(1); expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: "admin", jobId: "job", externalId: "mobile-outbox:pending:cases" });
 expect(m.users).toHaveBeenCalledTimes(1); expect(m.email).not.toHaveBeenCalled();
});
it("routes a released case update to linked client users with category and preferences intact", async () => {
 await notifyCaseUpdated({ caseItem: { ...caseItem, clientVisible: true }, actorLabel: "Office", updateNote: "Repair booked" });
 expect(m.create.mock.calls.map(([args]) => args.data.userId)).toEqual(["admin", "client-user"]);
 expect(m.create.mock.calls[1][0].data.externalId).toBe("mobile-outbox:pending:cases");
 expect(m.allowed).toHaveBeenCalledWith(expect.objectContaining({ userId: "client-user", category: "cases", channel: "WEB" })); expect(m.email).not.toHaveBeenCalled();
});
it("respects an explicit private update even for a released case", async () => {
 await notifyCaseUpdated({ caseItem: { ...caseItem, clientVisible: true }, actorLabel: "Office", updateNote: "Internal note", notifyClient: false });
 expect(m.users).toHaveBeenCalledTimes(1); expect(m.create).toHaveBeenCalledTimes(1);
});
it("preserves shopping category and preferences on a stock-count request", async () => {
 await notifyStockRunRequested({ run: { id: "run", title: "Weekly count", property: { id: "property", name: "Home", suburb: null } }, actorLabel: "Cleaner" });
 expect(m.create.mock.calls[0][0].data).toMatchObject({ userId: "admin", externalId: "mobile-outbox:pending:shopping", channel: "PUSH" });
 expect(m.allowed).toHaveBeenCalledWith(expect.objectContaining({ category: "shopping", channel: "WEB", userId: "admin" })); expect(m.email).not.toHaveBeenCalled();
});
