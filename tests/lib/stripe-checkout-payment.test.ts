// @vitest-environment node
/**
 * Pre-existing fix (2026-11-11): a completed Stripe checkout records the amount
 * charged and settles the invoice only when payments plus approved/sent credits
 * reach its total (the existing owing rule). Idempotent across webhook retries.
 */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), findMany: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: vi.fn(), clientInvoice: { findUnique: m.find, findMany: m.findMany, update: m.update } };
  return { db: { $transaction: async (work: (client: unknown) => unknown) => work(tx) } };
});
import { applyStripeCheckoutPayment, readCheckoutSession } from "@/lib/finance/stripe-checkout-payment";

let invoice: Record<string, unknown>;
const now = new Date("2026-11-11T00:00:00Z");
const session = (cents: number | null = 10000, extra = {}) => ({ invoiceId: "i", sessionId: "cs_1", paymentIntentId: "pi_1", amountTotalCents: cents, paymentStatus: "paid", ...extra });
beforeEach(() => {
  vi.clearAllMocks();
  invoice = { id: "i", kind: "INVOICE", status: "SENT", totalAmount: 220, paidAmount: 20, paidAt: null, metadata: { payments: [] } };
  m.find.mockImplementation(async () => invoice);
  m.findMany.mockResolvedValue([{ status: "SENT", totalAmount: -100 }]);
  m.update.mockResolvedValue({});
});

it("reads the session facts and refuses to invent an amount", () => {
  expect(readCheckoutSession({ id: "cs", metadata: { invoiceId: "i" }, amount_total: 500, payment_intent: "pi", payment_status: "paid" }))
    .toEqual({ invoiceId: "i", sessionId: "cs", paymentIntentId: "pi", amountTotalCents: 500, paymentStatus: "paid" });
  expect(readCheckoutSession({ metadata: {} })).toBeNull();
  expect(readCheckoutSession({ metadata: { invoiceId: "i" } })?.amountTotalCents).toBeNull();
});

it("settles PAID when payments plus credits reach the total, recording the amount charged", async () => {
  expect(await applyStripeCheckoutPayment(session(10000), now)).toEqual({ outcome: "recorded", status: "PAID", paidAmount: 120 });
  const data = m.update.mock.calls[0][0].data;
  expect(data).toMatchObject({ status: "PAID", paidAmount: 120, paymentMethod: "STRIPE", paidAt: now, stripePaymentIntentId: "pi_1" });
  expect(data.metadata.payments[0]).toMatchObject({ amount: 100, source: "STRIPE", stripeSessionId: "cs_1" });
});

it("a partial charge leaves the invoice PART_PAID (and a PART_PAID invoice is now updated)", async () => {
  m.findMany.mockResolvedValue([]);
  invoice.status = "PART_PAID";
  expect(await applyStripeCheckoutPayment(session(5000), now)).toMatchObject({ status: "PART_PAID", paidAmount: 70 });
  expect(m.update.mock.calls[0][0].data.paidAt).toBeUndefined();
});

it("is idempotent across webhook retries", async () => {
  invoice.metadata = { payments: [{ stripeSessionId: "cs_1" }] };
  expect((await applyStripeCheckoutPayment(session(), now)).outcome).toBe("duplicate");
  expect(m.update).not.toHaveBeenCalled();
});

it("never marks paid without an amount, before payment clears, or on a paid/void invoice", async () => {
  expect((await applyStripeCheckoutPayment(session(null), now)).outcome).toBe("unreadable");
  expect((await applyStripeCheckoutPayment(session(100, { paymentStatus: "unpaid" }), now)).outcome).toBe("not-paid");
  invoice.status = "VOID";
  expect((await applyStripeCheckoutPayment(session(), now)).outcome).toBe("not-payable");
  expect(m.update).not.toHaveBeenCalled();
});
