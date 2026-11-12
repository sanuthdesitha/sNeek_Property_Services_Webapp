import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Suppliers has its own entry in the rail. The directory itself lives on the
 * Stock page's Suppliers tab; this route keeps one address for it and carries
 * any query string (search, type, open panel) across.
 */
export default function V2AdminSuppliersPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "tab" || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
  }
  params.set("tab", "suppliers");
  redirect(`/v2/admin/inventory?${params.toString()}`);
}
