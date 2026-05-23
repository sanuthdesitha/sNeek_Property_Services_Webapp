import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import type { ReactNode } from "react";

export default async function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_ROUTES !== "true") {
    redirect("/");
  }
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") {
    redirect("/login");
  }
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
