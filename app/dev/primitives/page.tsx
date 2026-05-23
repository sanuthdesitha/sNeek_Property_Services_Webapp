import { DensityProvider } from "@/lib/density/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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

      <section id="button" className="space-y-4">
        <h2 className="text-lg font-semibold">Button</h2>
        <div className="flex flex-wrap gap-3">
          {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map((v) => (
            <Button key={v} variant={v}>{v}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(["xs", "sm", "default", "lg", "icon"] as const).map((s) => (
            <Button key={s} size={s} aria-label={s === "icon" ? "icon" : undefined}>
              {s === "icon" ? "★" : s}
            </Button>
          ))}
        </div>
        <div className="flex gap-3">
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>Disabled outline</Button>
        </div>
      </section>

      <section id="input" className="space-y-4">
        <h2 className="text-lg font-semibold">Input / Textarea / Label</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@example.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" placeholder="Anything you want to add…" />
          </div>
        </div>
      </section>
    </div>
  );
}
