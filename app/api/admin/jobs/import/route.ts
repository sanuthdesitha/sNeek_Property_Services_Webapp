import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { MAX_IMPORT_BYTES } from "@/lib/jobs/csv-import";
import { ImportKeyMismatchError, applyJobImport, previewJobImport } from "@/lib/jobs/csv-import-server";

/**
 * POST /api/admin/jobs/import — Jobs CSV import, same roles as creating a job
 * (`POST /api/admin/jobs`). `mode: "preview"` validates and writes nothing;
 * `mode: "apply"` creates the valid rows through the job-create service, once
 * per row of a given file (see `lib/jobs/csv-import-server.ts`).
 */
const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview"), csv: z.string().max(MAX_IMPORT_BYTES) }).strict(),
  z.object({ mode: z.literal("apply"), csv: z.string().max(MAX_IMPORT_BYTES), key: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: `Send the CSV text (at most ${MAX_IMPORT_BYTES / 1000} KB) with mode preview, or apply with the key from the preview.` }, { status: 400 });
    if (parsed.data.mode === "preview") {
      const preview = await previewJobImport(parsed.data.csv);
      if (preview.kind === "error") return NextResponse.json({ error: preview.message }, { status: 400 });
      return NextResponse.json(preview, { headers: { "Cache-Control": "private, no-store" } });
    }
    const result = await applyJobImport(parsed.data.csv, parsed.data.key, session.user.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof ImportKeyMismatchError) return NextResponse.json({ error: err.message }, { status: 409 });
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The import could not run. Check the jobs list before retrying; rows already created are not created twice." : message }, { status });
  }
}
