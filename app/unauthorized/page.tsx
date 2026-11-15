import "@/app/v2/estate.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { denialPagePath, denialPortalForRole, portalOfPath } from "@/lib/access/denial";
import { fromSearchParam, withFrom } from "@/lib/access/return-path";
import { EButton } from "@/components/v2/ui/primitives";

export const metadata = { title: "Access" };
export const dynamic = "force-dynamic";

function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * The old bare "403" destination (middleware, page guards). A signed-in person
 * is sent to their own portal's explanation (board "Access denied"), carrying
 * the validated `from`. Office staff refused an office page see the
 * administrators-only reason; refused another portal's page, the portal one.
 * Signed out or unreadable: a plain explanation with a way to sign in.
 */
export default async function UnauthorizedPage({ searchParams }: { searchParams?: { from?: string | string[] } }) {
  const from = fromSearchParam(searchParams?.from);
  let role: string | null = null;
  try {
    role = String((await requireSession()).user.role);
  } catch (error) {
    if (isNavigationSignal(error)) throw error;
  }
  const portal = denialPortalForRole(role);
  if (portal === "admin") {
    redirect(withFrom(`/v2/admin/access-denied?reason=${portalOfPath(from) === "admin" ? "role" : "portal"}`, from));
  }
  if (portal) redirect(withFrom(denialPagePath(portal), from));
  return (
    <div data-skin="estate" className="min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
      <main className="mx-auto max-w-[36rem] space-y-4 px-4 py-16">
        <p className="text-[0.75rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Access</p>
        <h1 className="e-display-md">This page needs a different account</h1>
        <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
          You are not signed in, or your account does not open this page. Sign in with the account that belongs to it.
        </p>
        <EButton asChild variant="primary">
          <Link href="/v2/login">Sign in</Link>
        </EButton>
      </main>
    </div>
  );
}
