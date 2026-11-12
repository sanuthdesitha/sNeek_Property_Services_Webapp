import { describe, expect, it } from "vitest";
import {
  buildClientMoneyRow, isPortalPayable, shortCalendarDay, summarizeToPay, type ClientMoneyInvoiceFacts, type ClientMoneyTerms,
} from "@/lib/billing/client-portal-money";
import { dueLabel, moneyBadge } from "@/components/v2/client/money/money-format";

const TERMS: ClientMoneyTerms = { clientTermsDays: null, organisationDefaultDays: 14, timezone: "Australia/Sydney" };
const TODAY = "2026-11-12";

function invoice(extra: Partial<ClientMoneyInvoiceFacts> = {}): ClientMoneyInvoiceFacts {
  return {
    id: "inv", invoiceNumber: "INV-1", status: "SENT", kind: "INVOICE", totalAmount: 1870, paidAmount: null,
    paidDate: null, paidAt: null, createdAt: new Date("2026-11-01T01:00:00Z"), periodStart: null, periodEnd: null,
    paymentTermsDays: 14, creditNotes: [], ...extra,
  };
}

describe("client Money states", () => {
  it("shows a sent invoice as due on the day the PDF prints, and pays its owing amount", () => {
    const row = buildClientMoneyRow(invoice(), TERMS, TODAY);
    expect(row).toMatchObject({ state: "DUE", owing: 1870, dueDay: "2026-11-15", payable: true, dueProvisional: false });
    expect(dueLabel(row)).toBe("Due 15 Nov");
    expect(moneyBadge(row)).toEqual({ label: "Due", tone: "warning" });
  });

  it("marks an outstanding invoice overdue after its due day", () => {
    const row = buildClientMoneyRow(invoice({ createdAt: new Date("2026-10-01T01:00:00Z") }), TERMS, TODAY);
    expect(row.state).toBe("OVERDUE");
    expect(dueLabel(row)).toBe("Overdue since 15 Oct");
  });

  it("shows Paid only for a recorded payment, with the recorded day, and never offers payment", () => {
    const paid = buildClientMoneyRow(invoice({ status: "PAID", paidAmount: 1870, paidDate: new Date("2026-10-08T00:00:00Z") }), TERMS, TODAY);
    expect(paid).toMatchObject({ state: "PAID", owing: 0, payable: false });
    expect(paid.paidOn?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(moneyBadge(paid).label).toBe("Paid");
    // Fully paid by credit note is not "Paid".
    const credited = buildClientMoneyRow(invoice({ creditNotes: [{ status: "SENT", totalAmount: -1870 }] }), TERMS, TODAY);
    expect(credited).toMatchObject({ state: "FULLY_CREDITED", owing: 0, payable: false });
    expect(moneyBadge(credited).label).toBe("Fully credited");
  });

  it("keeps part-paid balances owing without offering the online payment the route refuses", () => {
    const row = buildClientMoneyRow(invoice({ status: "PART_PAID", paidAmount: 870 }), TERMS, TODAY);
    expect(row).toMatchObject({ state: "PART_PAID", owing: 1000, payable: false });
    expect(isPortalPayable({ status: "PART_PAID", kind: "INVOICE" })).toBe(false);
  });

  it("labels an approved, unsent invoice's due day as provisional", () => {
    const row = buildClientMoneyRow(invoice({ status: "APPROVED", paymentTermsDays: null }), { ...TERMS, clientTermsDays: 7 }, TODAY);
    expect(row).toMatchObject({ state: "NOT_SENT", dueDay: "2026-11-08", dueProvisional: true, payable: true });
    expect(dueLabel(row)).toBe("Due 8 Nov (fixed when sent)");
  });

  it("never guesses a due day when terms are unknown, and never owes on a credit note", () => {
    expect(dueLabel(buildClientMoneyRow(invoice(), null, TODAY))).toBe("Due date unavailable");
    const note = buildClientMoneyRow(invoice({ kind: "CREDIT_NOTE", totalAmount: -200 }), TERMS, TODAY);
    expect(note).toMatchObject({ state: "CREDIT_NOTE", owing: 0, dueDay: null, payable: false });
  });

  it("sums what is owed and pays the overdue invoice first", () => {
    const rows = [
      buildClientMoneyRow(invoice({ id: "due" }), TERMS, TODAY),
      buildClientMoneyRow(invoice({ id: "late", totalAmount: 100, createdAt: new Date("2026-10-01T01:00:00Z") }), TERMS, TODAY),
      buildClientMoneyRow(invoice({ id: "paid", status: "PAID" }), TERMS, TODAY),
    ];
    expect(summarizeToPay(rows)).toMatchObject({ total: 1970, outstandingCount: 2, primary: { id: "late" } });
    expect(summarizeToPay([rows[2]])).toEqual({ total: 0, primary: null, outstandingCount: 0 });
  });

  it("prints calendar days without shifting them", () => {
    expect(shortCalendarDay("2026-11-14")).toBe("14 Nov");
  });
});
