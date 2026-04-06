import { NextRequest, NextResponse } from "next/server";
import { getAvailabilitySuggestions } from "@/lib/public-site/availability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const query = new URL(req.url).searchParams.get("q") ?? "";
    return NextResponse.json({ items: getAvailabilitySuggestions(query) });
  } catch (error: any) {
    return NextResponse.json({ items: [], error: error?.message ?? "Could not load suggestions." }, { status: 200 });
  }
}
