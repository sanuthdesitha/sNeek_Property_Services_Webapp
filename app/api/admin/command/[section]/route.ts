import { NextResponse } from "next/server";
import { isCommandSection, loadCommandSection, requireCommandViewer, SectionForbiddenError } from "@/lib/dashboard/command-access";

export const dynamic = "force-dynamic";

/**
 * One Command section, re-read on its own (the page refreshes each section
 * independently). The live session and role guard run on every request and
 * the viewer's ops packs decide which rows, tiles and actions come back.
 */
export async function GET(_req: Request, { params }: { params: { section: string } }) {
  try {
    const viewer = await requireCommandViewer();
    if (!isCommandSection(params.section)) return NextResponse.json({ error: "Unknown section." }, { status: 404 });
    const data = await loadCommandSection(params.section, viewer);
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    if (message === "FORBIDDEN" || err instanceof SectionForbiddenError) {
      return NextResponse.json({ error: "This account cannot view this section." }, { status: 403 });
    }
    return NextResponse.json({ error: "This section could not be loaded." }, { status: 500 });
  }
}
