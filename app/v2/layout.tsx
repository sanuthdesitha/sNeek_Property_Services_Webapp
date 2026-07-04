import "./estate.css";

/**
 * v2 root layout. Nested inside the app root layout (which owns <html>/<body>
 * and Providers), so this only mounts the Estate skin scope. Individual portal
 * layouts under app/v2/** set their own data-portal-accent.
 */
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" className="min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
      {children}
    </div>
  );
}
