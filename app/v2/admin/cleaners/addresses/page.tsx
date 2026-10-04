import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cleaner addresses · Route planning" };

export default async function CleanerAddressesPage() {
  await requireRole([Role.ADMIN]);
  const cleaners = await db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: { id: true, name: true, address: true, suburb: true },
    orderBy: [{ suburb: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  return <div className="space-y-4">
    <Link href="/v2/admin/cleaners" className="underline">Back to cleaners</Link>
    <h1 className="text-2xl font-semibold">Cleaner addresses for route planning</h1>
    <p>Existing residential details for active cleaners.</p>
    {cleaners.length ? <div className="overflow-x-auto"><table className="w-full text-left">
      <thead><tr><th className="p-2">Cleaner</th><th className="p-2">Residential address</th><th className="p-2">Suburb</th></tr></thead>
      <tbody>{cleaners.map(cleaner => <tr key={cleaner.id}>
        <th scope="row" className="p-2 font-medium">{cleaner.name}</th>
        <td className="p-2">{cleaner.address || "Not recorded"}</td>
        <td className="p-2">{cleaner.suburb || "Not recorded"}</td>
      </tr>)}</tbody>
    </table></div> : <p>No active cleaners.</p>}
  </div>;
}
