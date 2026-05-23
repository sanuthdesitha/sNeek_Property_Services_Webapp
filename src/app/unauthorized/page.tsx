import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 px-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-10 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <ShieldAlert size={28} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-600">403</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-brand-900">Access denied</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t have permission to view this page. If you think this is a mistake, contact your administrator.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Go home
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center rounded-lg border border-brand-200 bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}