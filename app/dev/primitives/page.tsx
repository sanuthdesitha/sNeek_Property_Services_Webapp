import { DensityProvider } from "@/lib/density/context";

export const dynamic = "force-dynamic";

export default function PrimitivesDemoPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Primitives Catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dev-only. One section per primitive. Visual regression baseline lives in
          e2e/primitives/visual.spec.ts.
        </p>
      </header>

      <section id="density-modes" className="space-y-4">
        <h2 className="text-lg font-semibold">Density modes</h2>
        <div className="grid grid-cols-3 gap-4">
          {(["compact", "default", "comfortable"] as const).map((d) => (
            <DensityProvider key={d} value={d}>
              <div className="rounded border border-border bg-surface p-4">
                <div className="text-xs text-muted-foreground">{d}</div>
                <div className="mt-2 h-8 rounded bg-primary-soft" />
              </div>
            </DensityProvider>
          ))}
        </div>
      </section>

      {/* Other primitive sections appended by tasks 3-13 */}
    </div>
  );
}
