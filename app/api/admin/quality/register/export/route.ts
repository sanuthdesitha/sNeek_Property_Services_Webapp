import { NextRequest, NextResponse } from "next/server";
import { readSort } from "@/lib/quality/http";
import { readRegisterRequest, registerErrorResponse, requireRegisterViewer } from "@/lib/quality/register/http";
import { REGISTER_SORTS } from "@/lib/quality/register/model";
import { buildRegisterCsv } from "@/lib/quality/register/service";

export const dynamic = "force-dynamic";

/** CSV of the register for the period and filters on screen (same gate and sources as the list). */
export async function GET(req: NextRequest) {
  try {
    const viewer = await requireRegisterViewer();
    const params = req.nextUrl.searchParams;
    const { sort, dir } = readSort(params, REGISTER_SORTS, "date");
    const { csv } = await buildRegisterCsv(readRegisterRequest(params, viewer.allowed), sort, dir);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="issues-register-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return registerErrorResponse(error, "Could not export the issues register.");
  }
}
