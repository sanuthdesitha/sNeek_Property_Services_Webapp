import { JobType } from "@prisma/client";
import { z } from "zod";

export const jobsColumnsSchema = z.object({ client: z.boolean(), cleaner: z.boolean(), schedule: z.boolean() }).strict();
export type JobsColumns = z.infer<typeof jobsColumnsSchema>;
export const JOBS_COLUMN_KEYS = ["client", "cleaner", "schedule"] as const;
export const DEFAULT_JOBS_COLUMNS: JobsColumns = { client: true, cleaner: true, schedule: true };

export function readJobsColumns(params: URLSearchParams): { columns: JobsColumns; error: boolean } {
  const values = params.getAll("columns");
  if (values.length === 0) return { columns: { ...DEFAULT_JOBS_COLUMNS }, error: false };
  const tokens = values[0] === "none" ? [] : values[0].split(",");
  if (values.length !== 1 || new Set(tokens).size !== tokens.length
    || tokens.some(token => !(JOBS_COLUMN_KEYS as readonly string[]).includes(token))) {
    return { columns: { ...DEFAULT_JOBS_COLUMNS }, error: true };
  }
  return { columns: { client: tokens.includes("client"), cleaner: tokens.includes("cleaner"), schedule: tokens.includes("schedule") }, error: false };
}

export const DEFAULT_JOBS_STATE = {
  dateScope: "all", statusChip: "all", sort: "soonest", search: "", view: "list",
  jobType: "all", clientId: "all", propertyId: "all", cleanerId: "all",
  dateFrom: "", dateTo: "", invoiced: "all", density: "default", columns: DEFAULT_JOBS_COLUMNS, page: 1,
};
export type JobsWorkspaceState = typeof DEFAULT_JOBS_STATE;
export type JobsDensity = "compact" | "default" | "comfortable";
const enums = {
  dateScope: ["all", "today", "tomorrow", "upcoming", "past"],
  statusChip: ["all", "active", "UNASSIGNED", "IN_PROGRESS", "QA_REVIEW", "COMPLETED", "INVOICED"],
  sort: ["soonest", "latest", "created", "property", "status"],
  view: ["list", "board"], jobType: ["all", ...Object.values(JobType)],
  invoiced: ["all", "yes", "no"], density: ["compact", "default", "comfortable"],
};

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function readJobsState(params: URLSearchParams): JobsWorkspaceState {
  const state = { ...DEFAULT_JOBS_STATE };
  state.columns = readJobsColumns(params).columns;
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
    const value = params.get(key);
    if (value && enums[key].includes(value)) state[key] = value;
  }
  for (const key of ["clientId", "propertyId", "cleanerId"] as const) {
    const value = params.get(key);
    if (value && /^[a-zA-Z0-9_-]{1,128}$/.test(value)) state[key] = value;
  }
  state.search = (params.get("search") ?? "").slice(0, 200);
  state.dateFrom = validDate(params.get("dateFrom") ?? "");
  state.dateTo = validDate(params.get("dateTo") ?? "");
  if (state.dateFrom && state.dateTo && state.dateFrom > state.dateTo) {
    state.dateFrom = ""; state.dateTo = "";
  }
  const page = params.get("page") ?? "1";
  if (/^[1-9]\d*$/.test(page) && Number(page) <= Math.floor(2147483647 / 50)) state.page = Number(page);
  return state;
}

export function writeJobsState(params: URLSearchParams, state: JobsWorkspaceState): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of Object.keys(DEFAULT_JOBS_STATE) as (keyof JobsWorkspaceState)[]) {
    next.delete(key);
    if (key !== "columns" && state[key] !== DEFAULT_JOBS_STATE[key]) next.set(key, String(state[key]));
  }
  const columns = jobsColumnsSchema.parse(state.columns);
  const visible = JOBS_COLUMN_KEYS.filter(key => columns[key]);
  if (visible.length !== JOBS_COLUMN_KEYS.length) next.set("columns", visible.join(",") || "none");
  return next;
}
export function hasExplicitJobsState(params: URLSearchParams) {
  return params.has("jobsState") || Object.keys(DEFAULT_JOBS_STATE).some(key => params.has(key));
}

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const date = z.string().refine(value => value === "" || validDate(value) === value, "Invalid date");
const choice = (values: string[]) => z.string().refine(value => values.includes(value), "Invalid option");
export const jobsSnapshotSchema = z.object({
  dateScope: choice(enums.dateScope), statusChip: choice(enums.statusChip), sort: choice(enums.sort),
  search: z.string().max(200), view: choice(enums.view), jobType: choice(enums.jobType),
  clientId: identifier, propertyId: identifier, cleanerId: identifier,
  dateFrom: date, dateTo: date, invoiced: choice(enums.invoiced),
  density: z.enum(["compact", "default", "comfortable"]),
  columns: jobsColumnsSchema,
}).strict().refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, "Reversed dates");
export type JobsSnapshot = z.infer<typeof jobsSnapshotSchema>;
export function jobsSnapshot(state: JobsWorkspaceState): JobsSnapshot {
  const { page: _page, ...snapshot } = state;
  return jobsSnapshotSchema.parse(snapshot);
}
