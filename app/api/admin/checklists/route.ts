import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getChecklists, saveChecklist } from "@/lib/checklists/store";

// ─── GET: all checklists (or ?jobType=) ────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobType = new URL(req.url).searchParams.get("jobType")?.trim();
    const all = await getChecklists();
    if (jobType) {
      return NextResponse.json({ checklist: all[jobType] ?? null });
    }
    return NextResponse.json({
      checklists: all,
      jobTypes: Object.keys(all),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed to load checklists." }, { status });
  }
}

// ─── PATCH: save one job type's checklist ──────────────────────────────────────
const itemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
  covered: z.boolean(),
  instructions: z.string().trim().max(4000).optional(),
  imageUrl: z.string().trim().max(2000).optional(),
  videoUrl: z.string().trim().max(2000).optional(),
});
const sectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  items: z.array(itemSchema).max(100),
});
const checklistSchema = z.object({
  jobType: z.string().trim().min(1),
  summary: z.string().trim().max(600).optional(),
  notCovered: z.array(z.string().trim().max(200)).max(50).optional(),
  sections: z.array(sectionSchema).max(40),
});
const patchSchema = z.object({ jobType: z.string().trim().min(1), checklist: checklistSchema });

export async function PATCH(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = patchSchema.parse(await req.json());
    await saveChecklist(body.jobType, body.checklist);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save checklist." }, { status });
  }
}
