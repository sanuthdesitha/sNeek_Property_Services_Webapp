import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkCalendarMove } from "@/lib/calendar/check-move";
import { mediumDayLabel } from "@/lib/calendar/range";
import { CaseLinkError, validateCaseLinks } from "@/lib/cases/link-validation";
import { readNeed } from "@/lib/inventory/urgent-stock-store";
import { URGENT_STAGE_LABEL } from "@/lib/inventory/urgent-stock-actions";
import { validateUrgentStockTransition } from "@/lib/inventory/urgent-stock-policy";
import type { AgentWriteScopeKey } from "./write-scopes";

/**
 * The agent ACTIONS (step 6): what each write tool accepts and its dry run.
 *
 * Nothing in this module writes. `preview` reads the entity through the same
 * read-only check the office uses (the Calendar move check for a reschedule,
 * the case link check for a new case, the urgent stock transition rule for an
 * acknowledgement) and returns the plain-language change the approver will
 * see, plus the state it was made against (`fingerprint`). Approval
 * (lib/agents/action-execute.ts, never imported by the MCP server) runs the
 * preview again and refuses when that state has changed.
 *
 * Left out on purpose (see docs/SYSTEM.md): assigning or reassigning a
 * cleaner, an internal note on a job and drafting a client message. They have
 * no domain service to execute through (the rules live in route handlers, the
 * job note is a single field read to cleaners, and a client message only
 * exists once sent), and reimplementing them here is not allowed.
 */

export type AgentActionTool = "request_reschedule_job" | "request_case_note" | "request_create_case" | "request_acknowledge_stock_need";

export const AGENT_ACTION_TOOLS: readonly AgentActionTool[] = ["request_reschedule_job", "request_case_note", "request_create_case", "request_acknowledge_stock_need"];

export function isAgentActionTool(value: string): value is AgentActionTool {
  return (AGENT_ACTION_TOOLS as readonly string[]).includes(value);
}

export type ActionEntity = { type: "Job" | "IssueTicket" | "UrgentStockNeed" | "NewCase"; id: string | null; label: string };

/** What the approver sees, and the state it was made against. */
export type ActionPreview = {
  /** One sentence naming the exact change. */
  summary: string;
  /** Facts behind it: from and to, links, warnings from the check. */
  details: string[];
  /** What approving also does, as the same action by a person does today. */
  effects: string[];
  entity: ActionEntity;
  /** Entity state the preview was made against; a different state at approval refuses it. */
  fingerprint: Record<string, string | number | null>;
  /** The exact input the domain service gets on approval, where the check produced one (reschedule plan). */
  execution: Record<string, unknown> | null;
};

/** The dry run refused: the agent is told why and no request is created. */
export class ActionPreconditionError extends Error {
  constructor(message: string) { super(message); this.name = "ActionPreconditionError"; }
}

const idempotencyKey = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/, "use letters, digits and _ . : - only");
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "write the date as YYYY-MM-DD");
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "write the time as HH:mm (24 hours)");
const plainText = (max: number) => z.string().trim().min(1).max(max);

export const rescheduleArgs = z.object({ jobId: z.string().min(1).max(128), toDate: dayKey, startTime: clockTime.optional(), reason: plainText(500) }).strict();
export const caseNoteArgs = z.object({ caseId: z.string().min(1).max(128), note: plainText(4000) }).strict();
export const createCaseArgs = z.object({
  title: plainText(180),
  description: z.string().trim().max(6000).optional(),
  /** Never DAMAGE (it raises a repair and tells the client) or a client dispute. */
  caseType: z.enum(["OPS", "LOST_FOUND", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  jobId: z.string().min(1).max(128).optional(),
  propertyId: z.string().min(1).max(128).optional(),
}).strict();
export const acknowledgeStockArgs = z.object({ needId: z.string().uuid(), reason: plainText(500) }).strict();

export type RescheduleArgs = z.infer<typeof rescheduleArgs>;
export type CaseNoteArgs = z.infer<typeof caseNoteArgs>;
export type CreateCaseArgs = z.infer<typeof createCaseArgs>;
export type AcknowledgeStockArgs = z.infer<typeof acknowledgeStockArgs>;

export type AgentActionDefinition = {
  tool: AgentActionTool;
  title: string;
  description: string;
  writeScope: AgentWriteScopeKey;
  /** JSON schema for tools/list (idempotencyKey included). */
  inputSchema: Record<string, unknown>;
  /** The action's own arguments (without idempotencyKey). */
  input: z.ZodType<Record<string, unknown>>;
  auditKeys: string[];
  preview: (args: Record<string, unknown>) => Promise<ActionPreview>;
};

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties: { ...properties, idempotencyKey: { type: "string", minLength: 8, maxLength: 100, description: "Your own key for this request. Sending the same key again returns the same request instead of a new one." } },
  required: [...required, "idempotencyKey"],
  additionalProperties: false,
});

const ASKS_ONLY = "This never changes anything by itself: it creates a request that waits for a person to approve it in the app (Approvals › Agent requests). Poll get_action_request for the outcome.";

/** "10:00" or "no start time" — never an invented time. */
function timeText(value: string | null | undefined): string {
  return value ? value : "no start time";
}

function quoted(text: string): string {
  return `"${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`;
}

async function previewReschedule(raw: Record<string, unknown>): Promise<ActionPreview> {
  const args = rescheduleArgs.parse(raw);
  const outcome = await checkCalendarMove({ jobId: args.jobId, toDate: args.toDate, toStartTime: args.startTime ?? null });
  if (outcome.kind === "not_found") throw new ActionPreconditionError("No job with that id.");
  if (outcome.kind === "invalid") throw new ActionPreconditionError(outcome.message);
  const result = outcome.result;
  const plan = result.plan.reschedule;
  if (result.blockers.length > 0 || !plan) throw new ActionPreconditionError(result.blockers.join(" ") || "Nothing would change.");
  const job = await db.job.findUnique({ where: { id: args.jobId }, select: { jobNumber: true, startTime: true } });
  const reference = job?.jobNumber ? `job ${job.jobNumber}` : "the job";
  const fromStart = result.time ? result.time.fromStart : job?.startTime ?? null;
  const toStart = result.time ? result.time.toStart : job?.startTime ?? null;
  const details = [
    `From ${mediumDayLabel(result.fromDate)}, ${timeText(fromStart)}`,
    `To ${mediumDayLabel(result.toDate)}, ${timeText(toStart)}`,
    ...(result.time && result.time.fromDue !== result.time.toDue ? [`Finish by: ${timeText(result.time.fromDue)} → ${timeText(result.time.toDue)}`] : []),
    `Reason given by the agent: ${quoted(args.reason)}`,
    ...result.warnings.filter((warning) => warning.kind !== "notice").map((warning) => warning.text),
  ];
  return {
    summary: `Reschedule ${reference} at ${result.propertyName} from ${mediumDayLabel(result.fromDate)} ${timeText(fromStart)} to ${mediumDayLabel(result.toDate)} ${timeText(toStart)}.`,
    details,
    effects: result.warnings.filter((warning) => warning.kind === "notice").map((warning) => warning.text),
    entity: { type: "Job", id: args.jobId, label: `${job?.jobNumber ?? "Job"} · ${result.propertyName}` },
    fingerprint: { jobUpdatedAt: plan.expectedUpdatedAt, date: plan.date, startTime: plan.startTime ?? null, dueTime: plan.dueTime ?? null, endTime: plan.endTime ?? null },
    execution: { ...plan },
  };
}

async function previewCaseNote(raw: Record<string, unknown>): Promise<ActionPreview> {
  const args = caseNoteArgs.parse(raw);
  const item = await db.issueTicket.findUnique({
    where: { id: args.caseId },
    select: { id: true, title: true, state: true, updatedAt: true, job: { select: { jobNumber: true } }, property: { select: { name: true } } },
  });
  if (!item) throw new ActionPreconditionError("No case with that id.");
  const where = [item.job?.jobNumber ? `job ${item.job.jobNumber}` : null, item.property?.name ?? null].filter(Boolean).join(", ");
  return {
    summary: `Add an internal note to the case ${quoted(item.title)}${where ? ` (${where})` : ""}.`,
    details: [`Note: ${quoted(args.note)}`, `Case state now: ${item.state}`, "Internal: only the office sees it; the client is not told."],
    effects: ["The office is told about the case update as when a person adds an internal note."],
    entity: { type: "IssueTicket", id: item.id, label: item.title },
    fingerprint: { caseUpdatedAt: item.updatedAt.toISOString(), state: item.state },
    execution: null,
  };
}

async function previewCreateCase(raw: Record<string, unknown>): Promise<ActionPreview> {
  const args = createCaseArgs.parse(raw);
  let links: Awaited<ReturnType<typeof validateCaseLinks>>;
  try {
    links = await validateCaseLinks({ jobId: args.jobId ?? null, propertyId: args.propertyId ?? null, clientId: null });
  } catch (error) {
    if (error instanceof CaseLinkError) throw new ActionPreconditionError(error.message);
    throw error;
  }
  const [job, property] = await Promise.all([
    links.jobId ? db.job.findUnique({ where: { id: links.jobId }, select: { jobNumber: true } }) : null,
    links.propertyId ? db.property.findUnique({ where: { id: links.propertyId }, select: { name: true } }) : null,
  ]);
  const linked = [job?.jobNumber ? `job ${job.jobNumber}` : null, property?.name ?? null].filter(Boolean).join(", ");
  return {
    summary: `Open a ${args.caseType.replace(/_/g, " ").toLowerCase()} case ${quoted(args.title)}${linked ? ` for ${linked}` : ""}, severity ${args.severity ?? "MEDIUM"}.`,
    details: [
      ...(args.description ? [`Description (kept as an internal note): ${quoted(args.description)}`] : ["No description given."]),
      linked ? `Linked to ${linked}.` : "Not linked to a job or property.",
      "Not visible to the client.",
    ],
    effects: ["The office is told about the new case as when a person opens one."],
    entity: { type: "NewCase", id: null, label: args.title },
    fingerprint: { jobId: links.jobId, propertyId: links.propertyId },
    execution: null,
  };
}

async function previewAcknowledgeStock(raw: Record<string, unknown>): Promise<ActionPreview> {
  const args = acknowledgeStockArgs.parse(raw);
  const need = await readNeed(db, args.needId);
  if (!need) throw new ActionPreconditionError("No urgent stock need with that id.");
  try {
    validateUrgentStockTransition({ from: need.stage, to: "ACKNOWLEDGED", mayResolve: false, reason: args.reason });
  } catch (error) {
    throw new ActionPreconditionError(error instanceof Error ? error.message : "This need cannot be acknowledged now.");
  }
  return {
    summary: `Mark the urgent stock need for ${need.itemName} at ${need.propertyName} as ${URGENT_STAGE_LABEL.ACKNOWLEDGED} (now ${URGENT_STAGE_LABEL[need.stage]}).`,
    details: [`Reason given by the agent: ${quoted(args.reason)}`, "It records that the office has seen the need. It places no order and does not prove delivery."],
    effects: [],
    entity: { type: "UrgentStockNeed", id: need.id, label: `${need.itemName} · ${need.propertyName}` },
    fingerprint: { needVersion: need.version, stage: need.stage },
    execution: null,
  };
}

export const AGENT_ACTIONS: readonly AgentActionDefinition[] = [
  {
    tool: "request_reschedule_job",
    title: "Ask to reschedule a job",
    description: `Ask to move a job to another day (and optionally another start time; the job keeps its length). The same check as a Calendar move runs first; a refused move creates no request. ${ASKS_ONLY}`,
    writeScope: "jobs_reschedule",
    inputSchema: object({
      jobId: { type: "string" },
      toDate: { type: "string", description: "YYYY-MM-DD" },
      startTime: { type: "string", description: "HH:mm, optional; omit to keep the job's times" },
      reason: { type: "string", maxLength: 500, description: "Why, in plain words; shown to the approver" },
    }, ["jobId", "toDate", "reason"]),
    input: rescheduleArgs,
    auditKeys: ["jobId", "toDate", "startTime", "idempotencyKey"],
    preview: previewReschedule,
  },
  {
    tool: "request_case_note",
    title: "Ask to add an internal note to a case",
    description: `Ask to add an internal (office-only) note to a case. ${ASKS_ONLY}`,
    writeScope: "cases_write",
    inputSchema: object({ caseId: { type: "string" }, note: { type: "string", maxLength: 4000 } }, ["caseId", "note"]),
    input: caseNoteArgs,
    auditKeys: ["caseId", "idempotencyKey"],
    preview: previewCaseNote,
  },
  {
    tool: "request_create_case",
    title: "Ask to open a case",
    description: `Ask to open an office case (operations, lost property or other; never damage, never visible to the client), optionally linked to a job or property. ${ASKS_ONLY}`,
    writeScope: "cases_write",
    inputSchema: object({
      title: { type: "string", maxLength: 180 },
      description: { type: "string", maxLength: 6000 },
      caseType: { type: "string", enum: ["OPS", "LOST_FOUND", "OTHER"] },
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      jobId: { type: "string" },
      propertyId: { type: "string" },
    }, ["title", "caseType"]),
    input: createCaseArgs,
    auditKeys: ["caseType", "severity", "jobId", "propertyId", "idempotencyKey"],
    preview: previewCreateCase,
  },
  {
    tool: "request_acknowledge_stock_need",
    title: "Ask to acknowledge an urgent stock need",
    description: `Ask to mark a reported urgent stock need as acknowledged (it places no order and proves no delivery). ${ASKS_ONLY}`,
    writeScope: "stock_acknowledge",
    inputSchema: object({ needId: { type: "string", description: "The need id from stock_needs" }, reason: { type: "string", maxLength: 500 } }, ["needId", "reason"]),
    input: acknowledgeStockArgs,
    auditKeys: ["needId", "idempotencyKey"],
    preview: previewAcknowledgeStock,
  },
];

export function agentAction(tool: AgentActionTool): AgentActionDefinition {
  const found = AGENT_ACTIONS.find((action) => action.tool === tool);
  if (!found) throw new Error(`Unknown agent action ${tool}`);
  return found;
}

/**
 * JSON with object keys sorted, so a value read back from a JSONB column
 * (PostgreSQL reorders keys) compares equal to the value that was stored.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Splits a write tool's arguments into the key and the action's own arguments. */
export function splitIdempotencyKey(args: Record<string, unknown>): { key: z.SafeParseReturnType<unknown, string>; rest: Record<string, unknown> } {
  const { idempotencyKey: raw, ...rest } = args;
  return { key: idempotencyKey.safeParse(raw), rest };
}
