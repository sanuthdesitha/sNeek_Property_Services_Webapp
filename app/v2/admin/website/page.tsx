import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { WebsiteCmsEditor } from "@/components/v2/admin/website/editor/website-editor";

export const metadata = { title: "Website · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Estate WEBSITE CMS. Loads the current `websiteContent` from AppSettings and
 * renders the native Estate editor. Saves flow through PATCH /api/admin/settings
 * (which requires ADMIN); OPS_MANAGER can view read-only.
 */
export default async function V2AdminWebsitePage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const settings = await getAppSettings();

  return (
    <WebsiteCmsEditor
      initialContent={settings.websiteContent}
      companyName={settings.companyName || "sNeek Property Services"}
      logoUrl={settings.logoUrl}
      readOnly={!isAdmin}
    />
  );
}
