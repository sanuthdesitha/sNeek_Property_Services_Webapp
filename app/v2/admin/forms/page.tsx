import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { canActAs } from "@/lib/auth/roles";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { resolveFormsTab, type FormsLibraryTab } from "@/lib/admin/forms-redirects";
import { getFormsTabCounts } from "@/lib/forms/library-tab-counts";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QaTemplatesManager } from "@/components/v2/admin/qa/qa-templates-manager";
import { FormsTabNav } from "@/components/v2/admin/forms/library/forms-tab-nav";
import { FORMS_TAB_LABEL } from "@/components/v2/admin/forms/library/forms-tab-labels";
import { JobFormsLibrary } from "@/components/v2/admin/forms/library/job-forms-library";
import { FormsHeaderActions } from "@/components/v2/admin/forms/library/forms-header-actions";
import { ValidationEnforcementCard } from "@/components/v2/admin/forms/library/validation-enforcement-card";
import { getAppSettings } from "@/lib/settings";
import { FormStatsPanel } from "@/components/v2/admin/forms/library/form-stats-panel";
import { ChecklistBlocksTab, MessageTemplatesTab, ResultsViewChips } from "@/components/v2/admin/forms/library/forms-subviews";
import { SubmissionsView } from "@/components/v2/admin/forms/submissions/submissions-view";
import { readSubmissionsView } from "@/components/v2/admin/forms/submissions/submissions-query";

export const metadata = { title: "Forms · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Forms library: job forms, QA templates, checklist blocks, message templates
 * and results on one page. /v2/admin/qa-templates, /v2/admin/templates,
 * /v2/admin/checklists and /v2/admin/forms/stats redirect to their tabs.
 * Old `?tab=` values still land on their content (`templates` → Job forms,
 * `checklists` → the per-service checklists view of Checklist blocks).
 *
 * ADMIN: every tab and every write. OPS_MANAGER: the tabs their packs allow
 * (QA templates = quality, Message templates = communications, the rest =
 * forms, mirrored in lib/rbac/ops-catalog.ts), read-only wherever the API
 * refuses them a write.
 */
const TAB_ORDER: FormsLibraryTab[] = ["forms", "qa", "blocks", "messages", "stats"];

type SearchParams = Record<string, string | string[] | undefined> & { tab?: string; view?: string; templateId?: string; weeks?: string };

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The request's query as a string, for the Submissions view's first render. */
function searchString(searchParams: SearchParams | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  return params.toString();
}

export default async function EstateFormsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const canWrite = canActAs(session.user.heldRoles ?? [session.user.role], [Role.ADMIN]);

  const levels = await getOpsAccess(session.user);
  const allowed = TAB_ORDER.filter((key) => !levels || canUseOpsPath(levels, `/v2/admin/forms?tab=${key}`));
  const requested = resolveFormsTab(searchParams?.tab);
  const tab: FormsLibraryTab | null = searchParams?.tab
    ? allowed.includes(requested.tab)
      ? requested.tab
      : null
    : (allowed[0] ?? null);
  const counts = await getFormsTabCounts({ forms: allowed.includes("forms"), qa: allowed.includes("qa") });

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Forms"
        description="Every form in one library: job checklists, QA inspection templates and message templates"
        actions={
          canWrite ? (
            <FormsHeaderActions canImport={allowed.includes("forms")} canQa={allowed.includes("qa")} canMessages={allowed.includes("messages")} />
          ) : undefined
        }
      />
      <FormsTabNav active={tab ?? "forms"} tabs={allowed} counts={{ forms: counts.forms, qa: counts.qa }} />
      <div className="min-w-0">
        <h2 className="sr-only">{tab ? FORMS_TAB_LABEL[tab] : "Not available"}</h2>
        {tab === null ? (
          <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            This section is not available to your account.
          </p>
        ) : null}
        {tab === "forms" ? <JobFormsLibrary canWrite={canWrite} /> : null}
        {tab === "qa" ? (
          <div className="space-y-4">
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Inspection scoring forms per job type, with optional per-property overrides.
            </p>
            <QaTemplatesManager canWrite={canWrite} />
          </div>
        ) : null}
        {tab === "blocks" ? <ChecklistBlocksTab view={requested.legacyChecklists || searchParams?.view === "service" ? "service" : "library"} /> : null}
        {tab === "messages" ? <MessageTemplatesTab view={searchParams?.view === "messages" ? "messages" : "notifications"} /> : null}
        {tab === "stats" ? (
          <div className="space-y-4">
            <ResultsViewChips view={searchParams?.view === "submissions" ? "submissions" : "stats"} />
            {searchParams?.view === "submissions" ? (
              <SubmissionsView initial={readSubmissionsView(searchString(searchParams))} canWrite={canWrite} />
            ) : (
              <>
                <ValidationEnforcementCard canWrite={canWrite} timezone={(await getAppSettings()).timezone || "Australia/Sydney"} />
                <FormStatsPanel searchParams={{ templateId: firstParam(searchParams?.templateId), weeks: firstParam(searchParams?.weeks) }} />
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
