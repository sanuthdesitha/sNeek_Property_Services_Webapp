import { z } from "zod";
import type { JobReservationContext } from "@/lib/jobs/meta";

export const stayPreparationPolicySchema = z.object({
  version: z.literal(1),
  items: z.array(z.object({ itemId: z.string().min(1).max(200), perStay: z.number().finite().min(0).max(10000), perGuestNight: z.number().finite().min(0).max(10000) }).strict()).max(100),
  extraTowels: z.number().int().min(0).max(100).nullable(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.items.map(row => row.itemId)).size !== value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Configure each inventory item once." });
});
export type StayPreparationPolicy = z.infer<typeof stayPreparationPolicySchema>;
export const emptyStayPolicy: StayPreparationPolicy = { version: 1, items: [], extraTowels: null };

function day(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
}
/** Local calendar dates, not elapsed hours: DST and exclusive all-day DTEND retain their meaning. */
export function stayNights(context?: JobReservationContext | null): number | null {
  if (context?.staySource !== "ICAL") return null;
  const start = day(context.stayStartDate), end = day(context.stayEndDate);
  return start !== null && end !== null && end > start ? (end - start) / 86400000 : null;
}
export function stayDemand(rule: StayPreparationPolicy["items"][number], guests: number | null, nights: number | null) {
  if (rule.perGuestNight > 0 && (guests === null || nights === null)) return null;
  return Math.ceil(rule.perStay + rule.perGuestNight * (guests ?? 0) * (nights ?? 0));
}
export function longStayInstruction(nights: number | null, extraTowels: number | null) {
  if (nights === null) return "Stay length unknown; confirm whether extra towels are needed.";
  if (nights <= 14) return null;
  return extraTowels === null ? "Stay exceeds 14 nights. Confirm the extra towel quantity with the office." : `Stay exceeds 14 nights. Prepare ${extraTowels} extra towels for this stay (property setting).`;
}
/** Idempotent ledger projection: duplicate joins never count a physical movement twice. */
export function suppliedFromLedger(rows: Array<{ id: string; quantity: number; txType: string }>): number | null {
  const unique = new Map(rows.filter(row => row.txType === "USED" && Number.isFinite(row.quantity) && row.quantity <= 0).map(row => [row.id, row]));
  return unique.size ? Array.from(unique.values()).reduce((sum, row) => sum + Math.abs(row.quantity), 0) : null;
}
