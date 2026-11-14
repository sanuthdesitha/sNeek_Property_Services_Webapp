import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveAccountCreator } from "@/lib/accounts/account-creator";
import { loadApplicationView } from "@/lib/hiring/application-view";
import { getSmsProviderState } from "@/lib/notifications/sms";
import { getAppSettings } from "@/lib/settings";
import { CandidateWorkspace } from "@/components/v2/admin/hiring/application/candidate-workspace";

export const metadata = { title: "Application · Estate admin" };
export const dynamic = "force-dynamic";

/** Hiring application (boards "Hiring application" and "Hiring on a phone", 2026-11-16). */
export default async function V2CandidateDetailPage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [creator, settings, sms] = await Promise.all([resolveAccountCreator(session), getAppSettings(), getSmsProviderState()]);
  const view = await loadApplicationView(params.id, creator, settings.timezone || "Australia/Sydney");
  if (!view) notFound();
  return (
    <CandidateWorkspace
      key={view.id}
      view={view}
      smsReady={sms.provider !== "none" && Boolean(sms.configured)}
      isAdmin={creator.heldRoles.includes("ADMIN")}
    />
  );
}
