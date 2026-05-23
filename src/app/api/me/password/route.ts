import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { upsertAuthUserState } from "@/lib/auth/account-state";

export const runtime = "nodejs";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: z.infer<typeof schema>;
  try {
    payload = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user || !user.passwordHash) {
    return NextResponse.json(
      { error: "Password login is not configured for this account." },
      { status: 400 }
    );
  }

  const matches = await bcrypt.compare(payload.currentPassword, user.passwordHash);
  if (!matches) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const newHash = await bcrypt.hash(payload.newPassword, 12);
  await db.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
  await upsertAuthUserState(user.id, { requiresPasswordReset: false });

  return NextResponse.json({ ok: true });
}