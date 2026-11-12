import { redirect } from "next/navigation";
import { normalizePeopleTab, peopleRedirectTarget } from "@/lib/people/tabs";

// Mirrors legacy app/admin/users: merged into People (the Accounts route).
// Keeps the query string; an old `?tab=` keeps its meaning.
export const dynamic = "force-dynamic";

export default function EstateUsersRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const raw = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  redirect(peopleRedirectTarget(normalizePeopleTab(raw, "everyone"), searchParams));
}
