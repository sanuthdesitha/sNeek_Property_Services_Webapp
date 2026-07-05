import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { WebsitePreviewClient } from "@/components/v2/admin/website/editor/preview-client";

export const metadata = { title: "Website preview · Estate admin" };
// Always render fresh so the preview reflects the latest saved content (and
// accepts draft overrides at runtime via postMessage).
export const dynamic = "force-dynamic";

/**
 * Native Estate framed preview of the public website content. Renders the same
 * `websiteContent` object the editor mutates, read-only, and accepts live draft
 * updates from the editor over postMessage. A "Preview" button on the editor
 * links here in a new tab.
 */
export default async function V2AdminWebsitePreviewPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  return <WebsitePreviewClient initialContent={settings.websiteContent} />;
}
