import { NextRequest, NextResponse } from "next/server";
import { leadSchema } from "@/lib/validations/quote";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = leadSchema.parse(await req.json());
    const lead = await db.quoteLead.create({ data: body });
    return NextResponse.json(lead, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
