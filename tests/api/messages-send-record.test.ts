// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ session: vi.fn(), email: vi.fn(), sms: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/messages/variables", () => ({ resolveTemplate: async (text: string) => text }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/db", () => ({ db: { notification: { create: m.notify } } }));
import { POST } from "@/app/api/admin/messages/send/route";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/messages/send", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.notify.mockResolvedValue({});
});

it("records a composer email with the provider's result and no account attached", async () => {
  m.email.mockResolvedValue({ ok: true, externalId: "resend-1" });
  const response = await post({ channel: "EMAIL", recipientEmail: "guest@example.invalid", recipientUserId: "someone", subject: "Hello", body: "Gate code 1234" });
  expect((await response.json()).ok).toBe(true);
  expect(m.notify.mock.calls[0][0].data).toMatchObject({ userId: null, channel: "EMAIL", status: "SENT", externalId: "resend-1", deliveryStatus: "PENDING", body: "Sent from the message composer." });
});

it("records a failed SMS as failed and skips recording a disabled one", async () => {
  m.sms.mockResolvedValue({ ok: false, status: "failed", provider: "twilio", error: "rejected" });
  await post({ channel: "SMS", recipientPhone: "+61400000000", body: "Hi" });
  expect(m.notify.mock.calls[0][0].data).toMatchObject({ channel: "SMS", status: "FAILED", errorMsg: "rejected" });
  m.sms.mockResolvedValue({ ok: false, status: "disabled", provider: "none" });
  await post({ channel: "SMS", recipientPhone: "+61400000000", body: "Hi" });
  expect(m.notify).toHaveBeenCalledTimes(1);
});

it("a failed record never changes the send's response", async () => {
  m.email.mockResolvedValue({ ok: true, externalId: "resend-2" });
  m.notify.mockRejectedValue(new Error("db down"));
  const response = await post({ channel: "EMAIL", recipientEmail: "guest@example.invalid", body: "Hi" });
  expect(response.status).toBe(200);
});
