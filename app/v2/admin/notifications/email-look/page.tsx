import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EAlert, EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EmailLookScreen } from "@/components/v2/admin/notifications/email/email-look-screen";
import { lookView } from "@/lib/email-design/view";

export const metadata = { title: "Email look · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Settings › Company & brand › Email look. Reads: ADMIN, and OPS_MANAGER with
 * the notifications (communications) pack (middleware). Changes: ADMIN only,
 * never while impersonating; publishing with the administrator's own PIN
 * (decided by the server routes; the screen only hides what they would refuse).
 */
export default async function EmailLookPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const timeZone = (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
  const initial = await lookView(session).catch(() => null);
  return (
    <div className="min-w-0 space-y-6">
      <EPageHeader
        eyebrow="Company & brand"
        title="Email look"
        description="The logo, brand colour, button shape, sender and footer line every email uses. Words are edited per email in Notifications, Types and wording."
        actions={<EButton asChild variant="ghost" className="min-h-[44px]"><Link href="/v2/admin/notifications">All notifications</Link></EButton>}
      />
      {initial ? (
        <EmailLookScreen initial={initial} timeZone={timeZone} />
      ) : (
        <EAlert tone="danger" title="The Email look could not be read">Nothing is shown rather than a look that may not be the one in use. Reload the page to try again.</EAlert>
      )}
    </div>
  );
}
