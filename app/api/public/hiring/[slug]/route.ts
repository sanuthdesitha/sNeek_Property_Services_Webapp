import { NextRequest, NextResponse } from "next/server";
import { getPublicHiringPosition, submitHiringApplication } from "@/lib/workforce/service";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const position = await getPublicHiringPosition(params.slug);
    if (!position || !position.isPublished) {
      return NextResponse.json({ error: "Position not found." }, { status: 404 });
    }
    return NextResponse.json(position);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load position." }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!fullName || !email || !email.includes("@")) {
      return NextResponse.json({ error: "Full name and valid email are required." }, { status: 400 });
    }
    const application = await submitHiringApplication({
      slug: params.slug,
      fullName,
      email,
      phone: typeof body?.phone === "string" ? body.phone : null,
      answers: body?.answers && typeof body.answers === "object" ? body.answers : {},
      resumeUrl: typeof body?.resumeUrl === "string" ? body.resumeUrl : null,
      resumeKey: typeof body?.resumeKey === "string" ? body.resumeKey : null,
      coverLetter: typeof body?.coverLetter === "string" ? body.coverLetter : null,
    });
    return NextResponse.json({ ok: true, applicationId: application.id });
  } catch (err: any) {
    const status = err.message === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: err.message ?? "Application failed." }, { status });
  }
}

