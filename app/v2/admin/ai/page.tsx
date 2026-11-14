import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getRecognitionConfiguration } from "@/lib/ai/property-photo-model";
import { getPhotoReviewAgreement } from "@/lib/ai/photo-review-evaluation";
import { AiConfigurationWorkspace } from "@/components/v2/admin/ai/ai-configuration-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI configuration | Estate admin" };

/**
 * The one AI page (2026-11-15 rebuild). Old links keep working: Settings › AI
 * (`?tab=ai`) and the Ollama tab (`?tab=ollama` → `?section=ollama`) redirect
 * here, and `#photo-checks` opens the former "Photo checks and memory" page's
 * section. ADMIN and OPS_MANAGER (with the "AI tools" pack, enforced by
 * `requireRole`) may open it; only an administrator acting as themselves can
 * change anything, and every write route re-checks that.
 */
export default async function AiConfigurationPage({ searchParams }: { searchParams?: { section?: string } } = {}) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = (session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN);
  const canEdit = isAdmin && !session.impersonation;
  const readOnlyReason = canEdit ? null : isAdmin ? "Changes are off while testing as someone." : "Administrators change these settings. You can read everything here; provider keys are never shown.";
  const [settings, agreement] = await Promise.all([
    getAppSettings().catch(() => null),
    getPhotoReviewAgreement().catch(() => null),
  ]);
  return (
    <AiConfigurationWorkspace
      canEdit={canEdit}
      readOnlyReason={readOnlyReason}
      timezone={settings?.timezone || "Australia/Sydney"}
      agreement={agreement}
      recognitionConfigured={getRecognitionConfiguration().configured}
      initialSection={searchParams?.section === "ollama" ? "ollama" : null}
    />
  );
}
