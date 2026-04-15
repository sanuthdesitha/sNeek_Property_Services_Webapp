import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    const h = await headers();
    const url = h.get("x-invoke-path") || "/login";
    redirect(`/login?callbackUrl=${encodeURIComponent(url)}`);
  }
  return session;
}

export async function requireRole(...roles: string[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    redirect("/unauthorized");
  }
  return session;
}

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}
