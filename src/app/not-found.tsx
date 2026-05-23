import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 px-6">
      <div className="w-full max-w-xl rounded-3xl bg-white p-10 text-center shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-600">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-brand-900">Page not found</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          The page you requested does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}