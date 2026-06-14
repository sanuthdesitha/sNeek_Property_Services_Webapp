import { NextResponse } from "next/server";
import { getServerMapsKey } from "@/lib/maps/server-key";

// Resolves the key at RUNTIME (Settings credential → server env) so the live
// site picks it up without a rebuild. The key can change in Settings, so this
// must not be statically cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = await getServerMapsKey();

  return NextResponse.json(
    {
      enabled: Boolean(apiKey),
      apiKey,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    }
  );
}
