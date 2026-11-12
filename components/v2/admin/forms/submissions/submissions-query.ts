/**
 * The Submissions view of Forms → Results and stats lives in the URL
 * (`tab=stats&view=submissions` plus filters, sort, page and the open
 * submission), so a link or refresh opens the same list. Pure.
 */
import type { SubmissionSort } from "@/lib/forms/submission-list";

export const SUBMISSION_SORT_KEYS: readonly SubmissionSort[] = ["submitted", "form", "property", "job", "cleaner"];

export type SubmissionsView = {
  q: string;
  templateId: string;
  from: string;
  to: string;
  warnings: boolean;
  sort: SubmissionSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_SUBMISSIONS_VIEW: SubmissionsView = { q: "", templateId: "", from: "", to: "", warnings: false, sort: "submitted", dir: "desc", page: 1, open: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function readSubmissionsView(search: string): SubmissionsView {
  const params = new URLSearchParams(search);
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  const open = params.get("submission");
  const templateId = params.get("templateId") ?? "";
  return {
    q: (params.get("q") ?? "").slice(0, 200),
    templateId: ID.test(templateId) ? templateId : "",
    from: DAY.test(params.get("from") ?? "") ? params.get("from")! : "",
    to: DAY.test(params.get("to") ?? "") ? params.get("to")! : "",
    warnings: params.get("warnings") === "1",
    sort: sort && (SUBMISSION_SORT_KEYS as readonly string[]).includes(sort) ? (sort as SubmissionSort) : DEFAULT_SUBMISSIONS_VIEW.sort,
    dir: params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : DEFAULT_SUBMISSIONS_VIEW.dir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID.test(open) ? open : null,
  };
}

/** The page URL's query for a view (keeps the tab and sub-view). */
export function submissionsSearch(view: SubmissionsView): string {
  const params = new URLSearchParams({ tab: "stats", view: "submissions" });
  if (view.q) params.set("q", view.q);
  if (view.templateId) params.set("templateId", view.templateId);
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  if (view.warnings) params.set("warnings", "1");
  if (view.sort !== DEFAULT_SUBMISSIONS_VIEW.sort || view.dir !== DEFAULT_SUBMISSIONS_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("submission", view.open);
  return `?${params.toString()}`;
}

/** The API query for one page. */
export function submissionsApiQuery(view: SubmissionsView, pageSize: number): string {
  const params = new URLSearchParams({ paginated: "1", sort: view.sort, dir: view.dir, page: String(view.page), pageSize: String(pageSize) });
  if (view.q) params.set("q", view.q);
  if (view.templateId) params.set("templateId", view.templateId);
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  if (view.warnings) params.set("warnings", "1");
  return params.toString();
}

export const PAGE_RESETTING: Array<keyof SubmissionsView> = ["q", "templateId", "from", "to", "warnings", "sort", "dir"];
