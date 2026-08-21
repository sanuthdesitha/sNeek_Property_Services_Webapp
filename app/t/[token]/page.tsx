import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { TapCheckIn } from "@/components/nfc/tap-check-in";

/**
 * What a property's NFC tag opens.
 *
 * The tag holds this URL and nothing else, which is the only design that works
 * on both platforms: an iPhone reads a URL record from the lock screen and
 * offers to open it, with no app installed and no permission dance. Android
 * does the same, and can additionally read the tag in-page via Web NFC.
 *
 * Deliberately short (`/t/…`), matching the existing public `/q/[token]` quote
 * links — the string has to be written into a chip with limited memory, and
 * every character of path is a character not available to the token.
 *
 * Signed-out visitors are sent to log in and BACK here. That is the whole
 * security model for commodity tags: the token is public and clonable, so a
 * tap only means something when it arrives with a session saying who is
 * holding the phone.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check in · sNeek",
  // A tag is a physical object in someone's building. Its URL should never
  // turn up in a search result.
  robots: { index: false, follow: false },
};

export default async function NfcTagPage({ params }: { params: { token: string } }) {
  const session = await getSession();

  if (!session?.user) {
    // Return here after signing in, so the cleaner does not have to walk back
    // to the door and tap again.
    redirect(`/login?callbackUrl=${encodeURIComponent(`/t/${params.token}`)}`);
  }

  return <TapCheckIn token={params.token} />;
}
