import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { loadComplianceData } from "@/lib/workforce/compliance-load";
import { loadWorkforceAreaSummary } from "@/lib/workforce/area-counts";
import { WorkforceArea } from "@/components/v2/admin/workforce/workforce-area";
import { ComplianceBoard, ComplianceDialogsProvider, ComplianceHeaderActions } from "@/components/v2/admin/workforce/compliance-board";

export const metadata = { title: "Compliance · Workforce" };
export const dynamic = "force-dynamic";

/** Workforce › Compliance (first tab: the only one that can stop someone working). */
export default async function WorkforceCompliancePage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [data, settings] = await Promise.all([loadComplianceData(), getAppSettings().catch(() => null)]);
  const summary = await loadWorkforceAreaSummary(data);
  const timeZone = settings?.timezone || "Australia/Sydney";
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const testingAs = session.impersonation ? session.user.name ?? session.user.email ?? "someone else" : null;
  const readOnlyReason = testingAs ? `Stop testing as ${testingAs} to send this.` : null;

  return (
    <ComplianceDialogsProvider>
      <WorkforceArea active="compliance" summary={summary} actions={data.status === "ready" ? <ComplianceHeaderActions disabledReason={readOnlyReason} /> : null}>
        {data.status === "failed" ? (
          <div role="alert" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
            <p className="font-[600]">The documents could not be loaded.</p>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Nothing is shown rather than a false all clear. Reload the page to try again.</p>
          </div>
        ) : (
          <ComplianceBoard
            rows={data.rows}
            figures={data.figures}
            documents={data.documents}
            requests={data.requests}
            staff={data.staff}
            timeZone={timeZone}
            todayKey={todayKey}
            readOnlyReason={readOnlyReason}
          />
        )}
      </WorkforceArea>
    </ComplianceDialogsProvider>
  );
}
