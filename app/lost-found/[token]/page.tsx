import { GuestReturnPage } from "@/components/lost-found-public/guest-return-page";

export const metadata = { title: "Your found item · sNeek", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

export default function LostFoundGuestPage({ params }: { params: { token: string } }) {
  return <GuestReturnPage token={params.token} />;
}
