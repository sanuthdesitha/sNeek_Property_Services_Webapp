import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Role } from "@prisma/client";

export default async function HomePage() {
  const session = await getSession();

  if (!session) return redirect("/login");

  const role = session.user.role as Role;
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) return redirect("/admin");
  if (role === Role.CLEANER) return redirect("/cleaner");
  if (role === Role.CLIENT) return redirect("/client");
  if (role === Role.LAUNDRY) return redirect("/laundry");

  return redirect("/login");
}
