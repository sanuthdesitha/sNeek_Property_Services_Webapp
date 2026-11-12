import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DelegatedActionDenied, requireDelegatedAction } from "@/lib/rbac/delegated-admin";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { AccessWorkspace } from "@/components/v2/admin/settings/access/access-workspace";
import type { AccessTab } from "@/components/v2/admin/settings/access/access-tabs";

export const metadata = { title: "Access and permissions · Estate admin" };
export const dynamic = "force-dynamic";

const TABS: AccessTab[] = ["person", "area", "presets", "assistants", "history"];

/**
 * Settings > Access and permissions (replaces the Roles and permissions tab,
 * whose URL redirects here). An ADMIN, or a person an administrator granted
 * "Edit access and permissions"; never while testing as someone. The API
 * re-checks every read and save.
 */
export default async function AccessPage({ searchParams }: { searchParams?: { view?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  try {
    await requireDelegatedAction(session, "access.edit_permissions");
  } catch (error) {
    const message = error instanceof DelegatedActionDenied ? error.message : "You cannot open this page.";
    return (
      <div className="space-y-4">
        <h1 className="e-display-md">Access and permissions</h1>
        <EAlert tone="warning" title="Not available">{message}</EAlert>
        <EButton asChild variant="outline"><a href="/v2/admin/settings">Back to settings</a></EButton>
      </div>
    );
  }
  const view = TABS.find((tab) => tab === searchParams?.view) ?? "person";
  return <AccessWorkspace initialTab={view} />;
}
