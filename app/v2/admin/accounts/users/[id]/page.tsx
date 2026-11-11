import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadPersonProfile } from "@/lib/accounts/person-profile";
import { toPersonProfile } from "@/lib/accounts/person-types";
import { personCapabilities, resolveAccountsViewer } from "@/lib/accounts/viewer";
import { PersonFullPage } from "@/components/v2/admin/accounts/person/person-full-page";

export const metadata = { title: "Account · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Full-page view of one account. Kept (rather than redirected to the panel)
 * because it has room for Work and Documents side by side; it renders the
 * same section components as the Accounts panel. Client logins have a page
 * too now (they used to 404 here).
 */
export default async function EstateAccountDetailPage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const raw = await loadPersonProfile(params.id);
  if (!raw) notFound();
  const viewer = await resolveAccountsViewer(session.user);
  return <PersonFullPage profile={toPersonProfile(raw)} caps={personCapabilities(viewer)} />;
}
