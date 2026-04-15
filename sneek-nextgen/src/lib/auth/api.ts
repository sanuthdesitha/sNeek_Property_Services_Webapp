import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function requireApiSession() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

export async function requireApiRole(...roles: string[]) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!roles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

export function apiError(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function apiSuccess<T>(data: T) {
  return NextResponse.json({ data });
}
