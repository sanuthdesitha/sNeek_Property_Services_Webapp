import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { resolveJobFormTemplate } from "@/lib/forms/resolve-job-template";
import { CARE_KIND, assetSchema, jobBudgetSchema, careCatalog, careCoverage, careDue, careMetadata, suitableCareJob, type CareAsset, type CareClock, type JobBudget } from "./policy";
type Tx = Prisma.TransactionClient;
const PREFIX = "property_care_v1:", key = (id: string) => PREFIX + id;
const json = (x: unknown) => x as Prisma.InputJsonValue;
type Memory = { id: string; kind: "MEMORY" | "CODE_IDEA"; text: string; recordedAt: string; actorId: string };
type Profile = { version: number; timezone: string; assets: CareAsset[]; budgets: JobBudget[]; memory: Memory[] };
async function profile(tx: Tx, id: string): Promise<Profile> {
 const row = await tx.appSetting.findUnique({ where: { key: key(id) } });
 return row?.value as unknown as Profile ?? { version: 0, timezone: (await getAppSettings()).timezone || "Australia/Sydney", assets: [], budgets: [], memory: [] };
}
async function access(tx: Tx, actorId: string, propertyId: string, write = false) {
 const [user, property] = await Promise.all([tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true, clientId: true, extraRoles: { select: { role: true } } } }), tx.property.findUnique({ where: { id: propertyId } })]);
 if (!property || !user?.isActive) throw Error("NOT_FOUND");
 const admin = [user.role, ...user.extraRoles.map(x => x.role)].some(role => role === "ADMIN" || role === "OPS_MANAGER");
 if (!admin && (write || user.role !== "CLIENT" || !user.clientId || user.clientId !== property.clientId)) throw Error("FORBIDDEN");
 return { property, admin };
}
async function save(tx: Tx, id: string, value: Profile) { await tx.appSetting.upsert({ where: { key: key(id) }, create: { key: key(id), value: json(value) }, update: { value: json(value) } }); }
function clocks(tasks: any[], assetId: string): CareClock {
 const out: CareClock = { inspectedAt: null, cleanedAt: null };
 for (const task of tasks) {
  const meta = careMetadata(task.metadata);
  if (meta?.assetId !== assetId || task.executionStatus !== "COMPLETED" || !task.completedAt || !(task.attachments ?? []).some((a: any) => a.kind === "COMPLETION_PROOF" && a.mediaType === "PHOTO")) continue;
  const date = new Date(task.completedAt).toISOString();
  if (meta.action === "INSPECT" && (!out.inspectedAt || date > out.inspectedAt)) { out.inspectedAt = date; out.inspectionTaskId = task.id; }
  if (meta.action === "CLEAN" && (!out.cleanedAt || date > out.cleanedAt)) { out.cleanedAt = date; out.cleaningTaskId = task.id; }
 }
 return out;
}
const taskInclude = { attachments: true, events: { orderBy: { createdAt: "asc" as const } }, job: true };
export async function careWorkspace(actorId: string, propertyId: string) {
 const allowed = await access(db, actorId, propertyId), config = await profile(db, propertyId);
 const tasks = await db.jobTask.findMany({ where: { propertyId, metadata: { path: ["kind"], equals: CARE_KIND } }, include: taskInclude, orderBy: { createdAt: "desc" } });
 const summaries = tasks.map(task => ({ id: task.id, title: task.title, description: task.description, executionStatus: task.executionStatus, completedAt: task.completedAt, jobId: task.jobId, plannedDate: task.job?.scheduledDate ?? null, due: careMetadata(task.metadata)?.due ?? null, evidence: task.executionStatus === "COMPLETED" ? task.attachments.some(a => a.kind === "COMPLETION_PROOF" && a.mediaType === "PHOTO") ? "PHOTO_RECORDED" : "EVIDENCE_MISSING" : "NOT_COMPLETED", ...(allowed.admin ? { metadata: task.metadata, events: task.events } : {}) }));
 if (!allowed.admin) return { admin: false, property: { id: propertyId, name: allowed.property.name }, tasks: summaries };
 const settings = await getAppSettings(); const templates = await db.formTemplate.findMany({ where: { isActive: true, serviceType: "AIRBNB_TURNOVER" } });
 const resolved = resolveJobFormTemplate({ propertyId, jobType: "AIRBNB_TURNOVER", overrides: settings.propertyFormTemplateOverrides, templates });
 return { admin: true, property: { id: propertyId, name: allowed.property.name }, config, tasks: summaries, catalog: careCatalog,
  assets: config.assets.map(asset => ({ ...asset, clock: clocks(tasks, asset.id), due: careDue(asset, clocks(tasks, asset.id), config.timezone) })),
  coverage: careCoverage(resolved.template?.schema, config.assets), template: { id: resolved.template?.id ?? null, source: resolved.source, name: resolved.template?.name ?? null },
  jobs: await db.job.findMany({ where: { propertyId, status: { in: ["UNASSIGNED", "ASSIGNED"] }, scheduledDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } }, select: { id: true, jobNumber: true, scheduledDate: true, startTime: true, endTime: true, dueTime: true, estimatedHours: true }, orderBy: { scheduledDate: "asc" }, take: 100 }) };
}
export async function configureCare(actorId: string, propertyId: string, raw: unknown) {
 const input = z.object({ version: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(2000), asset: assetSchema.optional(), budget: jobBudgetSchema.optional(), timezone: z.string().optional(), memory: z.object({ kind: z.enum(["MEMORY", "CODE_IDEA"]), text: z.string().trim().min(1).max(4000) }).optional() }).strict().parse(raw);
 return db.$transaction(async tx => {
  await access(tx, actorId, propertyId, true); await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId} FOR UPDATE`;
  const before = await profile(tx, propertyId); if (before.version !== input.version) throw Error("CONFLICT: property care changed; reload.");
  const next = { ...before, version: before.version + 1 };
  if (input.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { throw Error("Use an IANA timezone"); } next.timezone = input.timezone; }
  if (input.asset) { if (before.assets.some(a => a.id !== input.asset!.id && a.catalogId === input.asset!.catalogId && a.location.toLowerCase().trim() === input.asset!.location.toLowerCase().trim())) throw Error("Asset/location already configured; edit the existing asset."); const existing = before.assets.find(a => a.id === input.asset!.id); if (existing && (existing.catalogId !== input.asset.catalogId || existing.location.toLowerCase().trim() !== input.asset.location.toLowerCase().trim())) throw Error("Create a separate asset to preserve its history"); next.assets = [...before.assets.filter(a => a.id !== input.asset!.id), { ...input.asset, conditionSince: input.asset.cleaningNeeded ? existing?.cleaningNeeded ? existing.conditionSince : new Date().toISOString() : undefined }]; }
  if (input.budget) { const job = await tx.job.findFirst({ where: { id: input.budget.jobId, propertyId, status: { in: ["UNASSIGNED", "ASSIGNED"] } } }); if (!job) throw Error("Budget requires an unfinished job at this property"); next.budgets = [...before.budgets.filter(b => b.jobId !== input.budget!.jobId), input.budget]; }
  if (input.memory) next.memory = [...before.memory, { ...input.memory, id: randomUUID(), recordedAt: new Date().toISOString(), actorId }];
  await save(tx, propertyId, next); await tx.auditLog.create({ data: { userId: actorId, action: "PROPERTY_CARE_CONFIGURED", entity: "Property", entityId: propertyId, before: json(before), after: json({ config: next, reason: input.reason }) } }); return next;
 });
}
/** Own task cycles remain JobTask rows; no second execution/evidence engine. */
export async function planPropertyCare(propertyId: string, actorId?: string, now = new Date()) {
 return db.$transaction(async tx => {
  if (actorId) await access(tx, actorId, propertyId, true);
  await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId} FOR UPDATE`;
  const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId } }); if (!property.isActive) return { attached: 0 };
  const config = await profile(tx, propertyId);
  const tasks = await tx.jobTask.findMany({ where: { propertyId, metadata: { path: ["kind"], equals: CARE_KIND } }, include: taskInclude });
  const lockIds = await tx.job.findMany({ where: { propertyId, status: { in: ["UNASSIGNED", "ASSIGNED"] } }, select: { id: true }, orderBy: { id: "asc" } });
  for (const job of lockIds) await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${job.id} FOR UPDATE`;
  const jobs = await tx.job.findMany({ where: { propertyId, status: { in: ["UNASSIGNED", "ASSIGNED"] }, scheduledDate: { gte: new Date(now.toISOString().slice(0, 10)) }, invoiceLines: { none: { invoice: { status: { not: "VOID" } } } } }, orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }] });
  const used: Record<string, number> = {}; let attached = 0;
  // Release invalid future attachments and preserve the original row/cycle/audit.
  for (const task of tasks.filter(t => t.executionStatus === "OPEN" && t.jobId)) {
   const meta = careMetadata(task.metadata), job = jobs.find(j => j.id === task.jobId), asset = config.assets.find(a => a.id === meta.assetId);
   // Never rewrite started/historical jobs. Unfinished work is carried after the job closes.
   const active = task.job && ["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"].includes(task.job.status);
   if (active) { used[task.jobId!] = (used[task.jobId!] ?? 0) + meta.minutes; continue; }
   if (task.job && ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(task.job.status)) {
    await tx.jobTask.update({ where: { id: task.id }, data: { executionStatus: "NOT_COMPLETED", events: { create: { actorUserId: actorId, action: "CARE_MISSED", note: "Job closed without task completion; history retained for carry-forward." } } } }); task.executionStatus = "NOT_COMPLETED"; continue;
   }
   const valid = asset ? asset.enabled && asset.applicability === "APPLICABLE" && asset.safeAccess && asset.productsReady : meta.special === true;
   if (valid && job && suitableCareJob(job, config.budgets.find(b => b.jobId === job.id), meta.minutes, used[job.id] ?? 0, meta.special ? "UNSCHEDULED" : meta.due, now, config.timezone)) { used[job.id] = (used[job.id] ?? 0) + meta.minutes; continue; }
   await tx.jobTask.update({ where: { id: task.id }, data: { jobId: null, visibleToCleaner: false, events: { create: { actorUserId: actorId, action: "CARE_ATTACHMENT_RELEASED", note: `Unfinished cycle released from ${task.jobId}; original due date retained.` } } } }); task.jobId = null;
  }
  for (const missed of tasks.filter(t => t.executionStatus === "NOT_COMPLETED" && careMetadata(t.metadata)?.special)) {
   const meta = careMetadata(missed.metadata);
   if (tasks.some(t => t.id !== missed.id && careMetadata(t.metadata)?.cycle === meta.cycle && ["OPEN", "COMPLETED"].includes(t.executionStatus))) continue;
   const child = await tx.jobTask.create({ data: { propertyId, clientId: property.clientId, source: "ADMIN", approvalStatus: "APPROVED", executionStatus: "OPEN", visibleToCleaner: false, title: missed.title, description: missed.description, requiresPhoto: true, requiresNote: true, parentTaskId: missed.id, metadata: json(meta), events: { create: { actorUserId: actorId, action: "CARE_CARRIED_FORWARD", note: "Same unfinished special-task cycle; original due retained." } } }, include: taskInclude }); tasks.push(child);
  }
  // Released and explicit one-off tasks carry their same cycle to the next suitable job.
  for (const task of tasks.filter(t => t.executionStatus === "OPEN" && !t.jobId).sort((a, b) => ({ URGENT: 0, HIGH: 1, NORMAL: 2 }[careMetadata(a.metadata)?.priority as "URGENT"] ?? 3) - ({ URGENT: 0, HIGH: 1, NORMAL: 2 }[careMetadata(b.metadata)?.priority as "URGENT"] ?? 3))) {
   const meta = careMetadata(task.metadata), asset = config.assets.find(a => a.id === meta.assetId);
   if (!meta.special && (!asset?.enabled || asset.applicability !== "APPLICABLE" || !asset.safeAccess || !asset.productsReady)) continue;
   const job = jobs.find(j => suitableCareJob(j, config.budgets.find(b => b.jobId === j.id), meta.minutes, used[j.id] ?? 0, meta.special ? "UNSCHEDULED" : meta.due, now, config.timezone));
   if (job) { await tx.jobTask.update({ where: { id: task.id }, data: { jobId: job.id, visibleToCleaner: true, events: { create: { actorUserId: actorId, action: "CARE_REATTACHED", note: "Same unfinished cycle attached to next suitable job." } } } }); used[job.id] = (used[job.id] ?? 0) + meta.minutes; attached++; }
  }
  for (const asset of config.assets.filter(a => a.enabled && a.applicability === "APPLICABLE" && a.safeAccess && a.productsReady)) {
   const item = careCatalog.find(i => i.id === asset.catalogId)!; const clock = clocks(tasks, asset.id), due = careDue(asset, clock, config.timezone);
   for (const action of ["INSPECT", "CLEAN"] as const) {
    if (action === "CLEAN" && item.cleaning.kind === "manual_required" && !asset.manualUrl) continue;
    if (!due[action]) continue;
    const cycle = `${propertyId}:${asset.id}:${action}:${action === "INSPECT" ? clock.inspectionTaskId ?? "initial" : clock.cleaningTaskId ?? "initial"}`;
    const related = tasks.filter(t => careMetadata(t.metadata)?.cycle === cycle);
    // Work claimed done without photos stays for review; never reset clocks or fabricate a replacement completion.
    if (related.some(t => ["OPEN", "COMPLETED"].includes(t.executionStatus))) continue;
    const minutes = action === "INSPECT" ? asset.inspectionMinutes : asset.cleaningMinutes;
    const job = jobs.find(j => suitableCareJob(j, config.budgets.find(b => b.jobId === j.id), minutes, used[j.id] ?? 0, due[action]!, now, config.timezone));
    if (!job) continue;
    const generation = related.length, id = "care-" + createHash("sha256").update(cycle + ":" + generation).digest("hex").slice(0, 40);
    const task = await tx.jobTask.create({ data: { id, propertyId, clientId: property.clientId, jobId: job.id, source: "ADMIN", approvalStatus: "APPROVED", executionStatus: "OPEN", visibleToCleaner: true, title: `${action === "INSPECT" ? "Inspect" : "Clean"}: ${item.title} — ${asset.location}`, description: `${item.procedure}\n${action === "INSPECT" ? "Record observations; inspection does not attest cleaning." : "Complete only this named asset/location."}\nPhoto: ${item.photo_requirement}. Approved product: ${asset.product || "see property instructions"}. Manual: ${asset.manualUrl || "see property instructions"}.`, requiresPhoto: true, requiresNote: true, requestedByUserId: actorId, parentTaskId: related.at(-1)?.id,
     metadata: json({ kind: CARE_KIND, assetId: asset.id, action, cycle, due: related[0] ? careMetadata(related[0].metadata).due : due[action], minutes, configVersion: config.version }), events: { create: { actorUserId: actorId, action: "CARE_ATTACHED", note: "Due care fits approved booked time, access and readiness." } } }, include: taskInclude });
    tasks.push(task); used[job.id] = (used[job.id] ?? 0) + minutes; attached++;
   }
  }
  return { attached };
 });
}
export async function createCareSpecial(actorId: string, propertyId: string, raw: unknown) {
 const input = z.object({ requestId: z.string().uuid(), title: z.string().trim().min(1).max(300), description: z.string().trim().max(4000), priority: z.enum(["NORMAL", "HIGH", "URGENT"]), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), minutes: z.number().int().min(1).max(480) }).strict().parse(raw);
 return db.$transaction(async tx => { const { property } = await access(tx, actorId, propertyId, true); await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId} FOR UPDATE`;
  const id = `care-special-${propertyId}-${input.requestId}`, existing = await tx.jobTask.findUnique({ where: { id } });
  if (existing) { if ((existing.metadata as any)?.request !== JSON.stringify(input)) throw Error("CONFLICT: request ID reused"); return existing; }
  return tx.jobTask.create({ data: { id, propertyId, clientId: property.clientId, source: "ADMIN", approvalStatus: "APPROVED", executionStatus: "OPEN", visibleToCleaner: false, title: input.title, description: input.description, requiresPhoto: true, requiresNote: true, requestedByUserId: actorId, metadata: json({ kind: CARE_KIND, special: true, priority: input.priority, due: input.due ?? "UNSCHEDULED", minutes: input.minutes, cycle: id, request: JSON.stringify(input) }), events: { create: { actorUserId: actorId, action: "SPECIAL_TASK_RECORDED", note: "Owner/office instruction captured; completion not asserted." } } } });
 });
}
export async function dispatchPropertyCare() { const rows = await db.appSetting.findMany({ where: { key: { startsWith: PREFIX } }, select: { key: true } }); for (const row of rows) await planPropertyCare(row.key.slice(PREFIX.length)); return { properties: rows.length }; }
