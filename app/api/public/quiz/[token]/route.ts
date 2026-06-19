import { NextRequest, NextResponse } from "next/server";
import { getQuizForToken, submitQuizForToken } from "@/lib/workforce/quiz";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const quiz = await getQuizForToken(params.token);
  if (!quiz) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  return NextResponse.json(quiz);
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const answers = body?.answers && typeof body.answers === "object" ? body.answers : {};
    const result = await submitQuizForToken(params.token, answers);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not submit quiz." }, { status: 400 });
  }
}
