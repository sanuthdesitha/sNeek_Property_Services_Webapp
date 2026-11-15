import { ClientOnboardingPage } from "@/components/onboarding-link/client-onboarding-page";

export const metadata = { title: "Property details · sNeek", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

export default function OnboardingLinkPage({ params }: { params: { token: string } }) {
  return <ClientOnboardingPage token={params.token} />;
}
