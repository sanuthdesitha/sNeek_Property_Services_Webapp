import { Role } from "@prisma/client";
import { requireRealSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EAlert, ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader } from "@/components/v2/ui/primitives";
import { TestAsPicker, type TestAsCandidate } from "@/components/admin/test-as-picker";

export const metadata = { title: "Test as · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Admin-only "see what they see" console.
 *
 * Gated on requireRealSession (not requireRole/requireSession): while
 * impersonating, the session role IS the target's, so a role check against the
 * swapped session would 403 the admin out of the page they need to get back.
 */

/** The portals an admin can step into. ADMIN is absent on purpose. */
const TESTABLE_ROLES: { role: Role; label: string; portal: string }[] = [
  { role: Role.CLEANER, label: "Cleaner", portal: "/v2/cleaner" },
  { role: Role.CLIENT, label: "Client", portal: "/v2/client" },
  { role: Role.QA_INSPECTOR, label: "QA inspector", portal: "/v2/qa" },
  { role: Role.LAUNDRY, label: "Laundry", portal: "/v2/laundry" },
  { role: Role.MAINTENANCE, label: "Maintenance", portal: "/v2/maintenance" },
  { role: Role.OPS_MANAGER, label: "Ops manager", portal: "/v2/admin" },
];

export default async function TestAsPage() {
  const session = await requireRealSession();
  if (session.user.role !== Role.ADMIN) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow="Testing" title="Test as" />
        <EAlert tone="danger" title="Admins only">
          Only a full admin can open another portal for testing.
        </EAlert>
      </div>
    );
  }

  const users = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: TESTABLE_ROLES.map((r) => r.role) },
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const groups = TESTABLE_ROLES.map((r) => ({
    ...r,
    users: users.filter((u) => u.role === r.role) as TestAsCandidate[],
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Testing"
        title="Test as"
        description="Open any portal exactly as one of your users sees it, then come back."
      />

      <EAlert tone="warning" title="This is the real production app, not a sandbox">
        You are signed in as yourself the whole time — every action is recorded in
        the activity log against your account. Read-only is the default and blocks
        anything that would change data. Choose full access only when you need to
        test a flow end to end, and remember that anything you do then is real:
        real clock-ins, real submissions, real messages, under that person&apos;s
        name. Test sessions expire on their own after an hour.
      </EAlert>

      {groups.every((g) => g.users.length === 0) ? (
        <ECard>
          <ECardBody>
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No active non-admin accounts to test as yet.
            </p>
          </ECardBody>
        </ECard>
      ) : (
        groups
          .filter((g) => g.users.length > 0)
          .map((g) => (
            <ECard key={g.role}>
              <ECardHeader>
                <ECardTitle>
                  {g.label}
                  <span className="ml-2 text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                    {g.portal}
                  </span>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="pt-0">
                <TestAsPicker users={g.users} />
              </ECardBody>
            </ECard>
          ))
      )}
    </div>
  );
}
