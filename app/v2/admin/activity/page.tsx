import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isListQueryError } from "@/lib/admin/list-query";
import { listActivity, parseActivityFilters, parseActivityQuery, type ActivityPage } from "@/lib/admin/activity";
import { EAlert, EPageHeader } from "@/components/v2/ui/primitives";
import { ActivityLog } from "@/components/v2/admin/activity/activity-log";

export const metadata = { title: "Activity · Estate admin" };
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Activity log (2026-11 redesign, board "Activity"): plain sentences, kind-of-
 * change chips with counts, the actual person and the person they were testing
 * as shown apart, field-by-field changes with the raw before / after kept,
 * server paging through list-query and a capped server CSV. Administrators only.
 * Old links (?entity= &q= &user= &page=) keep their meaning.
 */
export default async function V2AdminActivityPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole([Role.ADMIN]);
  const settings = await getAppSettings().catch(() => null);
  const timezone = settings?.timezone || "Australia/Sydney";
  let page: ActivityPage | null = null;
  let problem: string | null = null;
  try {
    const filters = parseActivityFilters(searchParams);
    page = await listActivity(filters, parseActivityQuery(searchParams));
  } catch (error) {
    problem = isListQueryError(error) ? error.message : "The activity log could not be read. Try again.";
  }
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Setup" title="Activity log" description={`Every recorded change: who did it, as whom, what changed and when · times in ${timezone.replace(/_/g, " ")} time`} />
      {problem || !page ? (
        <EAlert tone="danger" title="Not shown">{problem}</EAlert>
      ) : (
        <ActivityLog page={page} searchParams={searchParams} timezone={timezone} />
      )}
    </div>
  );
}
