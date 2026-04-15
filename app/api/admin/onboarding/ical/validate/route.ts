import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { icalValidateSchema } from "@/lib/validations/onboarding";

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = icalValidateSchema.parse(await req.json());

    const res = await fetch(body.icalUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return NextResponse.json({ valid: false, error: `Could not fetch iCal feed (HTTP ${res.status}).` });
    }

    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      return NextResponse.json({ valid: false, error: "URL does not appear to be a valid iCal feed." });
    }

    const eventCount = (text.match(/BEGIN:VEVENT/g) ?? []).length;
    const provider = text.toLowerCase().includes("hospitable") ? "ICAL_HOSPITABLE" : "ICAL_OTHER";

    return NextResponse.json({ valid: true, eventCount, provider });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
