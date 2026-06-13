import { redirect } from "next/navigation";

// Integrations now live inside admin Settings:
//   ?tab=integrations  → API credentials (Stripe, Resend, Google Maps, Xero app keys, …)
//   ?tab=ical-sync     → the iCal sync ops console that used to live on this page
//   ?tab=xero          → Xero connect/disconnect/status (the /xero subroute also
//                        redirects here, and the OAuth callback under /api/xero is untouched)
export default function IntegrationsRedirect() {
  redirect("/admin/settings?tab=integrations");
}
