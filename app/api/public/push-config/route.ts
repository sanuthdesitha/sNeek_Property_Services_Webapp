import { NextResponse } from "next/server";
import { getServerVapidPublicKey } from "@/lib/notifications/web-push";

// Resolves the VAPID public key at RUNTIME (Settings credential → server env) so
// the browser can subscribe to push without a rebuild. NEXT_PUBLIC_* is inlined
// at build time and is empty in prod Docker images, which is why the client
// must fetch this instead of relying on the build-time value.
export const dynamic = "force-dynamic";

export async function GET() {
  const vapidPublicKey = await getServerVapidPublicKey();
  return NextResponse.json(
    { enabled: Boolean(vapidPublicKey), vapidPublicKey },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
