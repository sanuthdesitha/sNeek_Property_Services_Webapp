import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import type { ReactNode } from "react";

export default async function NewFormLayout({ children }: { children: ReactNode }) {
  await requireRole([Role.ADMIN]);
  return children;
}
