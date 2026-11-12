/**
 * Shapes the Client report PDFs manager reads from /api/admin/reports and
 * /api/admin/report-themes, with the guards applied before a body is trusted.
 */
export type ReportRow = {
  id: string;
  jobId: string;
  clientVisible: boolean;
  cleanerVisible: boolean;
  laundryVisible: boolean;
  sentToClient: boolean;
  visibilityUpdatedAt?: string | null;
  job: {
    id: string;
    jobNumber: string | null;
    scheduledDate: string | null;
    jobType: string | null;
    property: { id: string; name: string; suburb: string | null; client: { name: string } | null } | null;
  } | null;
};

export type PropertyOption = { id: string; name: string; suburb: string | null };

export type ReportPagination = { page: number; limit: number; totalCount: number; totalPages: number; hasMore: boolean };

export type ReportListBody = { reports: ReportRow[]; properties: PropertyOption[]; pagination: ReportPagination };

export type ThemeOption = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  primaryColorHsl?: string | null;
  accentColorHsl?: string | null;
};

export type VisibilityPatch = { clientVisible?: boolean; cleanerVisible?: boolean; laundryVisible?: boolean };

export const DEFAULT_THEME_ID = "__default__";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isReportList(body: unknown): body is ReportListBody {
  return isObject(body) && Array.isArray(body.reports) && Array.isArray(body.properties) && isObject(body.pagination);
}

export function readThemes(body: unknown): ThemeOption[] {
  return isObject(body) && Array.isArray(body.themes) ? (body.themes as ThemeOption[]) : [];
}

export function errorText(body: unknown, fallback: string): string {
  return isObject(body) && typeof body.error === "string" && body.error ? body.error : fallback;
}
