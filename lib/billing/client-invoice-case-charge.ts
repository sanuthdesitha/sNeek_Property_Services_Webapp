/**
 * Cases → "Add charge to invoice" (Wave F, carried from Wave E).
 *
 * A manual charge line (description, amount ex GST; GST follows the invoice's
 * own GST setting) goes onto the case client's existing DRAFT invoice chosen
 * in a picker, or onto a new blank draft (createBlankInvoice, the existing
 * numbering). The line is added through the invoice PATCH action
 * (patchClientInvoice: row lock, content lock, stale-write guard, totals,
 * audit), which also re-checks under the lock that the invoice is still a
 * DRAFT of the case's client (client-invoice-case-charge-rules.ts). The line
 * records the case (ClientInvoiceLine.caseId); nothing is approved or sent,
 * and a sent or approved invoice is never touched.
 *
 * Roles: exactly those that may edit invoices today: ADMIN, and an operations
 * manager whose finance feature is at "manage" (the invoice PATCH / create
 * path rule, checked here because this route lives under Cases).
 * Idempotent per request key (receipt in AppSetting; a retry after a failure
 * reuses the draft it already created).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { createBlankInvoice } from "./client-invoice-create";
import { patchClientInvoice } from "./client-invoice-patch";
import { caseClientId } from "./client-invoice-case-charge-rules";
import { actionError, type InvoiceActor } from "./invoice-action-result";

export const CASE_CHARGE_MAX = 100_000;

export const caseChargeInput = z.object({
  requestKey: z.string().uuid(),
  /** An existing DRAFT of the case's client, or null for a new blank draft. */
  invoiceId: z.string().min(1).max(64).nullable(),
  description: z.string().trim().min(1, "Describe the charge.").max(300),
  amount: z.number().finite().min(0.01, "Enter an amount above zero.").max(CASE_CHARGE_MAX),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export type CaseChargeLine = { lineId: string; invoiceId: string; invoiceNumber: string; status: string; description: string; lineTotal: number };
export type CaseDraftOption = { id: string; invoiceNumber: string; totalAmount: number; gstEnabled: boolean; updatedAt: string; periodStart: string | null; periodEnd: string | null };
export type CaseChargeContext = {
  clientId: string | null;
  clientName: string | null;
  canManage: boolean;
  drafts: CaseDraftOption[];
  charges: CaseChargeLine[];
};
export type CaseChargeResult = { invoiceId: string; invoiceNumber: string; lineId: string | null; createdDraft: boolean };

type AccessUser = { id: string; role: string; heldRoles?: string[] };

/** The invoice rules: ADMIN always; an operations manager by their finance feature. */
export async function invoiceRights(user: AccessUser): Promise<{ canView: boolean; canManage: boolean }> {
  const levels = await getOpsAccess(user);
  if (!levels) return { canView: user.role === "ADMIN" || user.role === "OPS_MANAGER", canManage: user.role === "ADMIN" || user.role === "OPS_MANAGER" };
  return { canView: canUseOpsPath(levels, "/api/admin/invoices", "GET"), canManage: canUseOpsPath(levels, "/api/admin/invoices", "POST") };
}

/** What the case panel shows: the client's drafts to choose from and the charges already added from this case. */
export async function caseChargeContext(user: AccessUser, caseId: string): Promise<CaseChargeContext> {
  const rights = await invoiceRights(user);
  const clientId = await caseClientId(db, caseId);
  if (clientId === undefined) throw new Error("NOT_FOUND");
  if (!rights.canView) return { clientId, clientName: null, canManage: false, drafts: [], charges: [] };
  const [client, drafts, lines] = await Promise.all([
    clientId ? db.client.findUnique({ where: { id: clientId }, select: { name: true } }) : Promise.resolve(null),
    clientId ? db.clientInvoice.findMany({ where: { clientId, status: "DRAFT", kind: "INVOICE" }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, invoiceNumber: true, totalAmount: true, gstEnabled: true, updatedAt: true, periodStart: true, periodEnd: true } }) : Promise.resolve([]),
    db.clientInvoiceLine.findMany({ where: { caseId }, orderBy: { createdAt: "asc" }, select: { id: true, description: true, lineTotal: true, invoice: { select: { id: true, invoiceNumber: true, status: true } } } }),
  ]);
  return {
    clientId,
    clientName: client?.name ?? null,
    canManage: rights.canManage,
    drafts: drafts.map((row) => ({ id: row.id, invoiceNumber: row.invoiceNumber, totalAmount: row.totalAmount, gstEnabled: row.gstEnabled, updatedAt: row.updatedAt.toISOString(), periodStart: row.periodStart?.toISOString() ?? null, periodEnd: row.periodEnd?.toISOString() ?? null })),
    charges: lines.map((line) => ({ lineId: line.id, invoiceId: line.invoice.id, invoiceNumber: line.invoice.invoiceNumber, status: line.invoice.status, description: line.description, lineTotal: line.lineTotal })),
  };
}

type Receipt = { state: "pending" | "failed" | "done"; at: string; invoiceId?: string; result?: CaseChargeResult };
const receiptKey = (actorId: string, requestKey: string) => "case_charge_v1:" + createHash("sha256").update(JSON.stringify([actorId, requestKey])).digest("hex");
const PENDING_FOR_MS = 120_000;

async function claimReceipt(key: string): Promise<Receipt | null> {
  try {
    await db.appSetting.create({ data: { key, value: { state: "pending", at: new Date().toISOString() } } });
    return null;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const row = await db.appSetting.findUnique({ where: { key } });
    const receipt = row?.value as Receipt | undefined;
    if (!receipt) return null;
    if (receipt.state === "pending" && Date.now() - Date.parse(receipt.at) < PENDING_FOR_MS) throw new Error("CONFLICT: This charge is still being saved. Wait a moment and refresh.");
    return receipt;
  }
}

async function writeReceipt(key: string, receipt: Receipt) {
  await db.appSetting.update({ where: { key }, data: { value: receipt as unknown as Prisma.InputJsonValue } });
}

export async function addCaseChargeToInvoice(actor: InvoiceActor & { heldRoles?: string[] }, caseId: string, raw: unknown): Promise<CaseChargeResult> {
  const input = caseChargeInput.parse(raw);
  const rights = await invoiceRights(actor);
  if (!rights.canManage) throw new Error("FORBIDDEN");
  const ticket = await db.issueTicket.findUnique({ where: { id: caseId }, select: { id: true, title: true } });
  if (!ticket) throw new Error("NOT_FOUND");
  const clientId = await caseClientId(db, caseId);
  if (!clientId) throw new Error("This case has no client, so its charge has no invoice to go on. Link the case to a client, property or job first.");

  const key = receiptKey(actor.id, input.requestKey);
  const previous = await claimReceipt(key);
  if (previous?.state === "done" && previous.result) return previous.result;
  try {
    let invoiceId = input.invoiceId ?? previous?.invoiceId ?? null;
    let createdDraft = false;
    if (!invoiceId) {
      const created = await createBlankInvoice({ clientId, periodStart: null, periodEnd: null }, actor);
      if (created.status >= 400) throw new Error(actionError(created, "Could not start a new draft invoice."));
      invoiceId = String((created.body as { id: string }).id);
      createdDraft = true;
      await writeReceipt(key, { state: "pending", at: new Date().toISOString(), invoiceId });
    }
    const patched = await patchClientInvoice({
      invoiceId,
      actor,
      body: {
        addLine: { description: input.description, quantity: 1, unitPrice: input.amount, category: "SERVICE", caseId },
        ...(input.invoiceId && input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
      },
    });
    if (patched.status >= 400) throw new Error(`CONFLICT: ${actionError(patched, "The charge could not be added.")}`);
    const [invoice, line] = await Promise.all([
      db.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { invoiceNumber: true } }),
      db.clientInvoiceLine.findFirst({ where: { invoiceId, caseId }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]);
    const result: CaseChargeResult = { invoiceId, invoiceNumber: invoice.invoiceNumber, lineId: line?.id ?? null, createdDraft: createdDraft || Boolean(previous?.invoiceId && !input.invoiceId) };
    await db.$transaction([
      db.caseComment.create({ data: { caseId, authorUserId: actor.id, isInternal: true, body: `Charge added to draft invoice ${invoice.invoiceNumber}: "${input.description}", $${input.amount.toFixed(2)} before GST. Nothing was sent to the client.` } }),
      db.auditLog.create({ data: { userId: actor.id, action: "CASE_CHARGE_ADDED_TO_INVOICE", entity: "IssueTicket", entityId: caseId, after: { invoiceId, invoiceNumber: invoice.invoiceNumber, lineId: result.lineId, amount: input.amount, description: input.description, createdDraft: result.createdDraft } as Prisma.InputJsonObject } }),
    ]);
    await writeReceipt(key, { state: "done", at: new Date().toISOString(), invoiceId, result });
    return result;
  } catch (error) {
    const current = (await db.appSetting.findUnique({ where: { key } }))?.value as Receipt | undefined;
    await writeReceipt(key, { state: "failed", at: new Date().toISOString(), invoiceId: current?.invoiceId });
    throw error;
  }
}
