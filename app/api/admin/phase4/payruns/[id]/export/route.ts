import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getPayRunById } from "@/lib/phase4/payruns";

function escapeCsv(value: string | number) {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const run = await getPayRunById(params.id);
    if (!run) return NextResponse.json({ error: "Pay run not found." }, { status: 404 });

    const headers = ["Cleaner", "Email", "Jobs", "Paid Hours", "Amount"];
    const rows = run.lines.map((line) => [
      line.cleanerName,
      line.cleanerEmail,
      line.jobsCount,
      line.paidHours.toFixed(2),
      line.amount.toFixed(2),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => escapeCsv(value)).join(","))
      .join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"payrun-${run.id}.csv\"`,
      },
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not export pay run." }, { status });
  }
}

