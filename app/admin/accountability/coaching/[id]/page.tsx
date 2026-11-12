import { redirect } from "next/navigation";
import { QUALITY_COACHING_HREF } from "@/lib/quality/redirects";

/**
 * Old "Coaching record acknowledged" emails linked to
 * /admin/accountability/coaching/[id], which never existed as a page (parity
 * audit 2026-11-12). Coaching records are followed up on the Quality hub's
 * Coaching tab, which applies its own role and pack guards.
 */
export default function AdminAccountabilityCoachingRedirect() {
  redirect(QUALITY_COACHING_HREF);
}
