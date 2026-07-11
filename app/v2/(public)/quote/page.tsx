import { getAppSettings } from "@/lib/settings";
import { RequestQuotePage } from "@/components/quote/request-quote-page";

export const metadata = { title: "Instant Quote · sNeek Property Services" };

export default async function V2QuotePage() {
  const settings = await getAppSettings().catch(() => null);
  // Reuse the live quote wizard — v2 is presentation only, no forking of lib/
  // The wizard renders inside the Estate public shell inherited from layout.tsx
  return <RequestQuotePage mode="public" />;
}
