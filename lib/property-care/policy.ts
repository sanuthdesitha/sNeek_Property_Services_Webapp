import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import catalog from "./catalog.json";
export const CARE_KIND = "PROPERTY_CARE";
export const careCatalog = catalog.items;
export const assetSchema = z.object({
 id: z.string().uuid(), catalogId: z.string().refine(id => careCatalog.some(item => item.id === id)), location: z.string().trim().min(1).max(200),
 applicability: z.enum(["UNKNOWN", "APPLICABLE", "NOT_APPLICABLE"]), enabled: z.boolean(), safeAccess: z.boolean(), productsReady: z.boolean(),
 inspectionDays: z.number().int().min(1).max(3650).nullable(), cleaningDays: z.number().int().min(1).max(3650).nullable(),
 inspectionMinutes: z.number().int().min(1).max(240), cleaningMinutes: z.number().int().min(1).max(480),
 firstCleaningDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), cleaningNeeded: z.boolean().default(false),
 manualUrl: z.string().url().or(z.literal("")).default(""), product: z.string().max(300).default(""), reason: z.string().trim().min(1).max(2000),
}).strict();
export type CareAsset = z.infer<typeof assetSchema> & { conditionSince?: string };
export const jobBudgetSchema = z.object({ jobId: z.string().min(1), minutes: z.number().int().min(0).max(480), normalMinutes: z.number().int().min(1).max(1440), ready: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict();
export type JobBudget = z.infer<typeof jobBudgetSchema>;
export type CareClock = { inspectedAt: string | null; cleanedAt: string | null; inspectionTaskId?: string; cleaningTaskId?: string };
export function dueDay(timestamp: string, days: number, timezone: string) {
 const date = formatInTimeZone(new Date(timestamp), timezone, "yyyy-MM-dd");
 return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
export function careDue(asset: CareAsset, clock: CareClock, timezone: string) {
 // An unknown baseline is an inspection, never invented overdue cleaning.
 const inspect = clock.inspectedAt ? asset.inspectionDays ? dueDay(clock.inspectedAt, asset.inspectionDays, timezone) : null : "INITIAL_INSPECTION";
 const clean = asset.cleaningNeeded && (!clock.cleanedAt || !!asset.conditionSince && clock.cleanedAt < asset.conditionSince) ? "CONDITION_REVIEW" : clock.cleanedAt ? asset.cleaningDays ? dueDay(clock.cleanedAt, asset.cleaningDays, timezone) : null : asset.firstCleaningDue;
 return { INSPECT: inspect, CLEAN: clean };
}
export function suitableCareJob(job: any, budget: JobBudget | undefined, minutes: number, used: number, due: string, now: Date, timezone: string) {
 if (!["AIRBNB_TURNOVER", "GENERAL_CLEAN", "COMMERCIAL_RECURRING"].includes(job.jobType)) return false;
 if (!budget?.ready || !["UNASSIGNED", "ASSIGNED", "CONFIRMED"].includes(job.status) || job.cleanSkipStatus === "SKIPPED" || job.payrollRunId || job.cleanerPaidAt || job.isRework) return false;
 if (!job.startTime || !(job.endTime || job.dueTime) || !job.estimatedHours) return false;
 const day = new Date(job.scheduledDate).toISOString().slice(0, 10);
 const start = fromZonedTime(`${day}T${job.startTime}:00`, timezone), end = fromZonedTime(`${day}T${job.endTime || job.dueTime}:00`, timezone);
 if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start <= now || end <= start) return false;
 if (/^\d{4}-/.test(due) && day < due) return false;
 return used + minutes <= budget.minutes && budget.normalMinutes + budget.minutes <= job.estimatedHours * 60 && budget.normalMinutes + budget.minutes <= (end.getTime() - start.getTime()) / 60000;
}
export function careMetadata(value: unknown): any | null { const m = value as any; return m?.kind === CARE_KIND ? m : null; }
/** Matches are review candidates, not proof that a generic wipe fulfils asset maintenance. */
export function careCoverage(schema: any, assets: CareAsset[]) {
 const fields: any[] = [];
 function visit(rows: any[]) { for (const row of rows ?? []) { fields.push(row); if (Array.isArray(row.children)) visit(row.children); } }
 for (const section of schema?.sections ?? []) visit(section.fields);
 return careCatalog.map(item => {
  const words = item.id.split("_").filter(word => word.length > 3);
  const matches = fields.filter(field => words.some(word => String(field.label ?? "").toLowerCase().includes(word))).map(field => ({ id: field.id, label: field.label, rotational: !!field.rotationEveryNCleans }));
  const instances = assets.filter(asset => asset.catalogId === item.id);
  const status = instances.length && instances.every(asset => asset.applicability === "NOT_APPLICABLE") ? "NOT_APPLICABLE" : matches.length > 1 ? "POSSIBLE_DUPLICATE_REVIEW" : matches.length ? "EXISTING_ROUTINE_REVIEW" : item.inspection.kind === "each_turnover" ? "ROUTINE_PROPOSAL_REQUIRED" : "PERIODIC_MISSING";
  return { id: item.id, title: item.title, inspection: item.inspection_label, cleaning: item.cleaning_label, status, matches };
 });
}
