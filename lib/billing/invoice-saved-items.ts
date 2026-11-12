/**
 * "Saved invoice items" (Wave D): a short list of charges the office adds to
 * invoices often (name, default rate, GST flag), offered in the editor's
 * add-line box. Stored in settings JSON (AppSetting "invoice-saved-items"); no
 * schema change. Managed under Billing schedule on Invoices and pay.
 *
 * No existing catalogue fits: the price book is per job type and bedroom
 * count, and property rates are per property and job type, neither a free
 * line item. The GST flag does not change any arithmetic: GST is set per
 * invoice (the GST switch applies to every line except agency disbursements),
 * so the editor shows a note when an item's flag differs from the invoice's
 * switch, and the switch decides.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const SAVED_ITEMS_KEY = "invoice-saved-items";
export const SAVED_ITEMS_MAX = 100;

export const savedItemSchema = z.object({
  id: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1, "Give the item a name.").max(200),
  rate: z.number().finite().min(0, "A rate is zero or more.").max(1_000_000),
  gst: z.boolean(),
});

export const savedItemsSchema = z.object({
  items: z.array(savedItemSchema).max(SAVED_ITEMS_MAX, `Keep at most ${SAVED_ITEMS_MAX} saved items.`),
  /** The list's version the editor read (its updatedAt); a stale save is refused. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type SavedInvoiceItem = z.infer<typeof savedItemSchema>;
export type SavedItemsPayload = { items: SavedInvoiceItem[]; updatedAt: string | null };

/** The stored list; an unreadable value reads as empty, never as invented items. */
export async function readSavedItems(client: Pick<typeof db, "appSetting"> = db): Promise<SavedItemsPayload> {
  const row = await client.appSetting.findUnique({ where: { key: SAVED_ITEMS_KEY } });
  if (!row) return { items: [], updatedAt: null };
  const parsed = z.object({ items: z.array(savedItemSchema) }).safeParse(row.value);
  return { items: parsed.success ? parsed.data.items : [], updatedAt: row.updatedAt.toISOString() };
}

export type SaveItemsResult = { ok: true; payload: SavedItemsPayload } | { ok: false; status: number; error: string };

export async function writeSavedItems(input: { items: SavedInvoiceItem[]; expectedUpdatedAt?: string | null; actorId: string }): Promise<SaveItemsResult> {
  const ids = new Set(input.items.map((item) => item.id));
  if (ids.size !== input.items.length) return { ok: false, status: 400, error: "Two saved items share an id." };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SAVED_ITEMS_KEY}))`;
    const before = await tx.appSetting.findUnique({ where: { key: SAVED_ITEMS_KEY } });
    const current = before?.updatedAt.toISOString() ?? null;
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current) {
      return { ok: false as const, status: 409, error: "The saved items were changed somewhere else. Reload them before saving." };
    }
    const value = { items: input.items } as unknown as Prisma.InputJsonObject;
    const row = await tx.appSetting.upsert({ where: { key: SAVED_ITEMS_KEY }, create: { key: SAVED_ITEMS_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "INVOICE_SAVED_ITEMS_UPDATED",
        entity: "AppSetting",
        entityId: SAVED_ITEMS_KEY,
        before: (before?.value ?? {}) as Prisma.InputJsonValue,
        after: value,
      },
    });
    return { ok: true as const, payload: { items: input.items, updatedAt: row.updatedAt.toISOString() } };
  });
}
