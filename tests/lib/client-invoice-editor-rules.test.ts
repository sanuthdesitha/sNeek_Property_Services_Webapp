import { describe, expect, it } from "vitest";
import { clientInvoiceStages, type StageFacts } from "@/lib/billing/client-invoice-stage";
import {
  editorMenuActions,
  editorPrimaryAction,
  primaryInvoiceAction,
  type InvoiceRow,
} from "@/components/v2/admin/finance/invoices/invoice-model";
import { invoiceEditorHref, invoiceListHref } from "@/components/v2/admin/finance/invoices/invoice-links";
import { buildLineUpdates, pruneDrafts, validateNewLine } from "@/components/v2/admin/finance/invoices/editor/line-drafts";
import { reorderWithinSection, lineSections } from "@/components/v2/admin/finance/invoices/editor/line-sections";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";

function facts(overrides: Partial<StageFacts> = {}): StageFacts {
  return { status: "DRAFT", sentAt: null, xeroInvoiceId: null, xeroState: "NONE", ...overrides };
}

function states(input: Partial<StageFacts>) {
  const view = clientInvoiceStages(facts(input));
  return view.terminal ? view.terminal.title : view.stages.map((stage) => `${stage.key}:${stage.state}`).join(" ");
}

describe("stage bar mapping", () => {
  it.each([
    [{ status: "DRAFT" }, "draft:current approved:todo sent:todo xero:todo paid:todo"],
    [{ status: "APPROVED" }, "draft:done approved:current sent:todo xero:todo paid:todo"],
    [{ status: "SENT", sentAt: "2026-11-01T00:00:00Z" }, "draft:done approved:passed sent:current xero:todo paid:todo"],
    [{ status: "PART_PAID", sentAt: "2026-11-01T00:00:00Z" }, "draft:done approved:passed sent:done xero:todo paid:current"],
    [{ status: "PAID", sentAt: "2026-11-01T00:00:00Z", xeroInvoiceId: "X", xeroState: "PUSHED" }, "draft:done approved:passed sent:done xero:done paid:done"],
    [{ status: "PAID", sentAt: null }, "draft:done approved:passed sent:skipped xero:todo paid:done"],
    [{ status: "SENT", sentAt: "2026-11-01T00:00:00Z", xeroState: "PENDING" }, "draft:done approved:passed sent:current xero:pending paid:todo"],
    [{ status: "VOID" }, "Void"],
    [{ status: "VOID", xeroInvoiceId: "X", xeroState: "PUSHED" }, "Void"],
  ] as const)("%j", (input, expected) => {
    expect(states(input as Partial<StageFacts>)).toBe(expected);
  });

  it("never marks In Xero done without a Xero invoice id", () => {
    const view = clientInvoiceStages(facts({ status: "APPROVED", xeroState: "PENDING" }));
    expect(view.stages.find((stage) => stage.key === "xero")?.state).toBe("pending");
  });
});

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv", invoiceNumber: "INV-1", status: "DRAFT", totalAmount: 100, paidAmount: null, amountOwing: 100,
    periodStart: null, periodEnd: null, sentAt: null, paidAt: null, paidDate: null, paymentMethod: null, paymentReference: null,
    createdAt: "2026-11-01T00:00:00Z", dueDate: "2026-11-15", overdue: false, xeroInvoiceId: null, xeroExportedAt: null,
    xeroState: "NONE", client: { id: "c", name: "Client", email: null }, ...overrides,
  };
}

describe("editor primary action reuses the list's choice", () => {
  it.each([
    [{ status: "DRAFT" }, "approve"],
    [{ status: "APPROVED" }, "send"],
    [{ status: "SENT" }, "record-payment"],
    [{ status: "SENT", overdue: true }, "resend"],
    [{ status: "PART_PAID", xeroState: "PENDING" }, "xero-retry"],
    [{ status: "PAID" }, "receipt"],
    [{ status: "VOID" }, null],
  ] as const)("%j → %s", (overrides, expected) => {
    const invoice = row(overrides as Partial<InvoiceRow>);
    expect(editorPrimaryAction(invoice)).toBe(expected);
    const listChoice = primaryInvoiceAction(invoice);
    if (listChoice !== "edit" && listChoice !== "pdf") expect(editorPrimaryAction(invoice)).toBe(listChoice);
  });

  it("keeps every other existing action in the menu, without Edit", () => {
    expect(editorMenuActions(row())).toEqual(["pdf", "send", "record-payment", "mark-paid", "xero-push", "delete"]);
    expect(editorMenuActions(row({ status: "SENT", xeroInvoiceId: "X", xeroState: "PUSHED" }))).toEqual([
      "pdf", "resend", "mark-paid", "xero-push", "reconcile",
    ]);
    expect(editorMenuActions(row({ status: "VOID" }))).toEqual(["pdf"]);
  });
});

describe("list ↔ editor links", () => {
  it("carries the list view to the editor and back", () => {
    const href = invoiceEditorHref("inv 1", "status=SENT&client=c1&page=2");
    expect(href).toBe("/v2/admin/finance/invoices/inv%201?back=status%3DSENT%26client%3Dc1%26page%3D2");
    const back = new URL(href, "http://local").searchParams.get("back");
    expect(invoiceListHref(back)).toBe("/v2/admin/finance?tab=invoices&status=SENT&client=c1&page=2");
  });

  it("keeps old deep links working and drops anything that is not a list key", () => {
    expect(invoiceEditorHref("inv")).toBe("/v2/admin/finance/invoices/inv");
    expect(invoiceListHref(undefined)).toBe("/v2/admin/finance?tab=invoices");
    expect(invoiceListHref("tab=payroll&next=https://evil.example&status=DRAFT")).toBe("/v2/admin/finance?tab=invoices&status=DRAFT");
  });
});

function line(overrides: Partial<EditorLine> = {}): EditorLine {
  return {
    id: "l1", description: "Clean", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE", note: null,
    shoppingLocked: false, job: null, propertyId: null, property: null, startedWork: null, ...overrides,
  };
}

describe("line drafts", () => {
  it("builds absolute updates with the API's limits, and only a description for a locked shopping line", () => {
    const lines = [line(), line({ id: "l2", shoppingLocked: true, description: "Supplies" }), line({ id: "l3" })];
    const result = buildLineUpdates(lines, {
      l1: { description: " Deep clean ", quantity: "2", unitPrice: "120" },
      l2: { description: "Supplies bought", quantity: "9", unitPrice: "1" },
      l3: { description: "Clean", quantity: "0", unitPrice: "100" },
    });
    expect(result.updates).toEqual([
      { id: "l1", description: "Deep clean", quantity: 2, unitPrice: 120 },
      { id: "l2", description: "Supplies bought" },
    ]);
    expect(result.invalid).toEqual({ l3: "Quantity must be more than zero." });
  });

  it("keeps a draft that still differs from the server, drops one the server now matches", () => {
    const drafts = { l1: { description: "Clean", quantity: "1", unitPrice: "100.00" }, l2: { description: "New", quantity: "1", unitPrice: "1" } };
    expect(pruneDrafts([line(), line({ id: "l2" })], drafts)).toEqual({ l2: drafts.l2 });
  });

  it("validates a new line", () => {
    expect(validateNewLine({ description: "", quantity: "1", unitPrice: "1" }).ok).toBe(false);
    expect(validateNewLine({ description: "Key cut", quantity: "1", unitPrice: "" }).ok).toBe(false);
    expect(validateNewLine({ description: "Key cut", quantity: "2", unitPrice: "15" })).toEqual({
      ok: true, line: { description: "Key cut", quantity: 2, unitPrice: 15 },
    });
  });
});

describe("sections", () => {
  const property = (name: string) => ({ id: null, name, suburb: null });
  const a1 = line({ id: "a1", job: { id: "j1", jobNumber: "J1", scheduledDay: "2026-10-01", property: property("Bondi") } });
  const b1 = line({ id: "b1", job: { id: "j2", jobNumber: "J2", scheduledDay: "2026-10-02", property: property("Coogee") } });
  const a2 = line({ id: "a2", job: { id: "j3", jobNumber: "J3", scheduledDay: "2026-10-03", property: property("Bondi") } });

  it("reorders within a section and refuses a move across sections", () => {
    const sections = lineSections([a1, b1, a2], true);
    expect(sections.map((section) => section.title)).toEqual(["Bondi", "Coogee"]);
    expect(reorderWithinSection(sections, "a2", "a1")).toEqual(["a2", "a1", "b1"]);
    expect(reorderWithinSection(sections, "a1", "b1")).toBeNull();
  });
});
