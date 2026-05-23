"use client";

import { DensityProvider } from "@/lib/density/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/ui/form-field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { FAB } from "@/components/ui/fab";

// Note: dev/layout.tsx already gates this route (admin + non-prod) and is
// dynamic via getServerSession, so this client page doesn't need its own
// `export const dynamic = "force-dynamic"`.

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

      <section id="form-field" className="space-y-4">
        <h2 className="text-lg font-semibold">FormField</h2>
        <div className="grid max-w-md gap-4">
          <FormField id="ff-email" label="Email" hint="We never share it.">
            <Input id="ff-email" type="email" />
          </FormField>
          <FormField id="ff-pw" label="Password" required error="Too short.">
            <Input id="ff-pw" type="password" />
          </FormField>
        </div>
      </section>

      <section id="card" className="space-y-4">
        <h2 className="text-lg font-semibold">Card</h2>
        <Card>
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description goes here.</CardDescription>
          </CardHeader>
          <CardContent>Card content body.</CardContent>
          <CardFooter><Button size="sm">Action</Button></CardFooter>
        </Card>
      </section>

      <section id="status-pill" className="space-y-4">
        <h2 className="text-lg font-semibold">StatusPill</h2>
        <div className="flex flex-wrap gap-2">
          {(["neutral", "info", "success", "warning", "danger", "primary", "accent", "purple"] as const).map(
            (v) => (
              <StatusPill key={v} variant={v}>{v}</StatusPill>
            )
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill variant="success" withDot>Completed</StatusPill>
          <StatusPill variant="warning" withDot>At risk</StatusPill>
          <StatusPill variant="danger" withDot>Breached</StatusPill>
        </div>
      </section>

      <section id="dialog" className="space-y-4">
        <h2 className="text-lg font-semibold">Dialog + Drawer</h2>
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Example dialog</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Body text inside the dialog.</p>
            </DialogContent>
          </Dialog>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline">Open right drawer</Button>
            </DrawerTrigger>
            <DrawerContent side="right">
              <DrawerHeader>
                <DrawerTitle>Right drawer</DrawerTitle>
              </DrawerHeader>
              <p className="text-sm text-muted-foreground">Right-side drawer for desktop.</p>
            </DrawerContent>
          </Drawer>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline">Open bottom drawer</Button>
            </DrawerTrigger>
            <DrawerContent side="bottom">
              <DrawerHeader>
                <DrawerTitle>Bottom drawer</DrawerTitle>
              </DrawerHeader>
              <p className="text-sm text-muted-foreground">Bottom sheet drawer for mobile.</p>
            </DrawerContent>
          </Drawer>
        </div>
      </section>

      <section id="states" className="space-y-4">
        <h2 className="text-lg font-semibold">Empty / Loading / Error states</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <EmptyState title="No jobs scheduled" body="Create one to get started." action={<Button size="sm">Create job</Button>} />
          <LoadingState variant="card" />
          <ErrorState message="Couldn't reach the server — check your connection." onRetry={() => {}} />
        </div>
      </section>

      <section id="fab" className="space-y-4">
        <h2 className="text-lg font-semibold">FAB</h2>
        <p className="text-xs text-muted-foreground">
          Floating Action Button. Rendered fixed bottom-right of the page. Hides when modal opens
          or virtual keyboard appears.
        </p>
        <FAB aria-label="Create" icon={<span className="text-xl">+</span>} onClick={() => {}} />
      </section>
    </div>
  );
}
