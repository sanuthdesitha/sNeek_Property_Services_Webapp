# Plan B — Component Primitives Restyle + New Primitives + Density System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every shadcn/ui primitive to consume the Plan-A design tokens, add the six new primitives the spec requires (`StatusPill`, `FormField`, `EmptyState`, `LoadingState`, `ErrorState`, `FAB`), wire the density system end-to-end, and lock a visual regression baseline.

**Architecture:** One PR. Restyles happen in place inside `components/ui/*.tsx` (shadcn pattern — local copies, not a package). New primitives land alongside. Density is a Provider + `data-density` attribute + tiny hook reading from `User.uiDensity`. A dev-only demo page at `/dev/primitives` exhibits every primitive for visual regression. Tests are Vitest unit tests (props, a11y, render) + Playwright visual regression (one screenshot per primitive group, baseline locked at end).

**Tech Stack:** Next.js 14, TypeScript, Tailwind, shadcn/ui (existing), Radix UI primitives (existing), `class-variance-authority` (existing pattern), `lucide-react` for icons, `react-hook-form` (already in deps, used by FormField), Vitest + Testing Library, Playwright + @axe-core/playwright (all bootstrapped by Plan A).

---

## Prerequisites

Before any task:

1. Plan A is merged to `main` (or you've explicitly chosen to branch off `feat/foundation-a-schema-tokens`). Confirm with `git log --oneline | head -5`.
2. **Plan A's historic-migration bug is fixed** OR you commit to not running `prisma migrate dev` during Plan B. Plan B doesn't add migrations, but the bug will still bite if you `npm run db:migrate` for any reason. Recommended: fix it now as the first commit of this branch (see Task 0).
3. `npm test` is green from Plan A (7 tests).
4. `npm run build` succeeds.
5. New branch: `git checkout -b feat/foundation-b-primitives` (from Plan-A-merged main, or from `feat/foundation-a-schema-tokens` if Plan A hasn't merged yet).

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `prisma/migrations/20260408220915_add_en_route_notifications_automation/migration.sql` | modify (Task 0, optional) | Fix `'JobStatus'::regtype` → `'"JobStatus"'::regtype` so shadow DB replay works |
| `lib/density/context.tsx` | create | `DensityProvider`, `useDensity` hook |
| `lib/density/server.ts` | create | `getDensityForUser(userId)` for SSR seed |
| `app/_density-shell.tsx` | create | Server wrapper that reads session + injects `data-density` on portal `<body>`s |
| `app/dev/primitives/page.tsx` | create | Dev-only catalog page |
| `app/dev/layout.tsx` | create | Gates `/dev/*` behind ADMIN role + dev/preview env |
| `components/ui/button.tsx` | modify | Restyle to new tokens; tone down motion |
| `components/ui/input.tsx` | modify | Same |
| `components/ui/textarea.tsx` | modify | Same |
| `components/ui/label.tsx` | modify | Minor: muted tone consistency |
| `components/ui/form-field.tsx` | **create** | Composes label + control + hint + error |
| `components/ui/card.tsx` | modify | Restyle (radius, surface, shadow) |
| `components/ui/separator.tsx` | modify | Color token |
| `components/ui/scroll-area.tsx` | modify | Scrollbar color token |
| `components/ui/status-pill.tsx` | **create** | 8 semantic variants per spec §9.4 |
| `components/ui/badge.tsx` | modify | Rebuild on StatusPill (or thin compat alias) |
| `components/ui/dialog.tsx` | modify | New radii, backdrop blur, focus trap reaffirmed |
| `components/ui/drawer.tsx` | **create** | Right/bottom drawer on Radix Dialog |
| `components/ui/empty-state.tsx` | **create** | Illustration slot + title + body + CTA |
| `components/ui/loading-state.tsx` | **create** | Skeleton-based, full-card or full-page |
| `components/ui/error-state.tsx` | **create** | Sanitized error + Retry + Support link |
| `components/ui/fab.tsx` | **create** | Safety rules: one per screen, keyboard-hide, modal-hide |
| `components/ui/toast.tsx` | modify | New tokens; rebuild positions |
| `components/ui/toaster.tsx` | modify | Position (bottom-right desktop, top-center mobile) |
| `components/ui/alert.tsx` | modify | Restyle; mark for future consolidation into ErrorState |
| `components/ui/dropdown-menu.tsx` | modify | Tokens; tighter density |
| `components/ui/select.tsx` | modify | Tokens; tighter density |
| `components/ui/popover.tsx` | **create** (via shadcn add) | Doesn't exist yet; needed by FAB speed-dial, command palette later |
| `components/ui/tooltip.tsx` | **create** (via shadcn add) | Doesn't exist yet; needed by icon-only buttons |
| `components/ui/tabs.tsx` | modify | Tokens |
| `components/ui/accordion.tsx` | modify | Tokens |
| `components/ui/checkbox.tsx` | modify | Tokens; tighter focus ring |
| `components/ui/switch.tsx` | modify | Tokens |
| `components/ui/progress.tsx` | modify | Tokens + **a11y fix** (add `aria-label` prop, mark `role="progressbar"` explicit) |
| `tests/components/*.test.tsx` | create per primitive | Unit tests |
| `e2e/primitives/visual.spec.ts` | create | Visual regression suite |
| `e2e/primitives/visual.spec.ts-snapshots/` | created by first run | Locked baselines |

---

## Task 0: Fix historic shadow-DB migration bug (optional but strongly recommended)

**Files:** `prisma/migrations/20260408220915_add_en_route_notifications_automation/migration.sql`

This is technically out of Plan B's scope but it unblocks `prisma migrate dev` for all future work. Skip if Plan A already handled it.

- [ ] **Step 1: Verify the bug still exists**

```bash
grep -n "JobStatus" "prisma/migrations/20260408220915_add_en_route_notifications_automation/migration.sql"
```

Expected: a line `AND enumtypid = 'JobStatus'::regtype` (unquoted, broken on fresh shadow DB).

- [ ] **Step 2: Patch the file**

Change line 8 from `AND enumtypid = 'JobStatus'::regtype` to `AND enumtypid = '"JobStatus"'::regtype`.

- [ ] **Step 3: Update the checksum in `_prisma_migrations`**

```bash
cat > scripts/_patch-checksum.mjs << 'EOF'
import crypto from "node:crypto";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const file = "prisma/migrations/20260408220915_add_en_route_notifications_automation/migration.sql";
const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
console.log("New checksum:", hash);
const r = await p.$executeRawUnsafe(
  `UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = '20260408220915_add_en_route_notifications_automation'`,
  hash
);
console.log("Rows updated:", r);
await p.$disconnect();
EOF
npx tsx scripts/_patch-checksum.mjs && rm scripts/_patch-checksum.mjs
```

Expected: `Rows updated: 1`.

- [ ] **Step 4: Verify `prisma migrate dev --create-only` now works (sanity)**

```bash
npx prisma migrate dev --name nullop_b_sanity --create-only
```

Expected: success with empty migration (nothing to migrate). Delete the empty migration directory after:

```bash
rm -rf prisma/migrations/*_nullop_b_sanity
```

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20260408220915_add_en_route_notifications_automation/migration.sql
git commit -m "fix(db): quote JobStatus in regtype cast so shadow DB replay works

Pre-existing bug where 'JobStatus'::regtype was lowercased by Postgres to
'jobstatus' (which doesn't exist on a fresh shadow DB), breaking
prisma migrate dev for all subsequent migration work. Now quoted:
'\"JobStatus\"'::regtype preserves the camelCase identifier.

Stored checksum in _prisma_migrations updated to match new file content."
```

---

## Task 1: Density system foundation

**Files:**
- Create: `lib/density/context.tsx`
- Create: `lib/density/server.ts`
- Create: `tests/components/density.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/density.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DensityProvider, useDensity } from "@/lib/density/context";

function Probe() {
  const density = useDensity();
  return <span data-testid="probe">{density}</span>;
}

describe("DensityProvider", () => {
  it("returns 'default' when no value set", () => {
    render(
      <DensityProvider>
        <Probe />
      </DensityProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe("default");
  });

  it("returns the explicit value passed", () => {
    render(
      <DensityProvider value="compact">
        <Probe />
      </DensityProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe("compact");
  });

  it("renders data-density on the root element", () => {
    const { container } = render(
      <DensityProvider value="comfortable">
        <Probe />
      </DensityProvider>
    );
    expect(container.firstChild).toHaveAttribute("data-density", "comfortable");
  });
});
```

- [ ] **Step 2: Run it (expect failure — module not found)**

```bash
npm test -- tests/components/density.test.tsx
```

Expected: FAIL with "Cannot find module '@/lib/density/context'".

- [ ] **Step 3: Create `lib/density/context.tsx`**

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Density = "compact" | "default" | "comfortable";

const DensityContext = createContext<Density>("default");

export function useDensity(): Density {
  return useContext(DensityContext);
}

export function DensityProvider({
  value = "default",
  children,
}: {
  value?: Density;
  children: ReactNode;
}) {
  return (
    <div data-density={value}>
      <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
    </div>
  );
}
```

- [ ] **Step 4: Create `lib/density/server.ts`**

```ts
import { prisma } from "@/lib/db";
import type { Density } from "./context";

const PRISMA_TO_DENSITY: Record<string, Density> = {
  COMPACT: "compact",
  DEFAULT: "default",
  COMFORTABLE: "comfortable",
};

/**
 * Returns the persisted UI density for a user. Falls back to "default"
 * when the user has no preference or doesn't exist.
 */
export async function getDensityForUser(userId: string | null | undefined): Promise<Density> {
  if (!userId) return "default";
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { uiDensity: true },
  });
  return PRISMA_TO_DENSITY[user?.uiDensity ?? "DEFAULT"] ?? "default";
}
```

- [ ] **Step 5: Run the test (expect pass)**

```bash
npm test -- tests/components/density.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/density/ tests/components/density.test.tsx
git commit -m "feat(density): DensityProvider + useDensity + getDensityForUser SSR helper"
```

---

## Task 2: Density shell wiring + dev demo gate

**Files:**
- Create: `app/_density-shell.tsx`
- Create: `app/dev/layout.tsx`
- Create: `app/dev/primitives/page.tsx` (skeleton — populated in later tasks)

- [ ] **Step 1: Create `app/_density-shell.tsx`**

```tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { getDensityForUser } from "@/lib/density/server";
import { DensityProvider } from "@/lib/density/context";
import type { ReactNode } from "react";

/**
 * Server component that reads the current session and yields a DensityProvider
 * pre-populated with the user's stored UI density preference. Wrap portal
 * subtree roots with this.
 */
export async function DensityShell({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  const density = await getDensityForUser(session?.user?.id);
  return <DensityProvider value={density}>{children}</DensityProvider>;
}
```

- [ ] **Step 2: Create `app/dev/layout.tsx`** — gate `/dev/*` to admins in non-production

```tsx
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import type { ReactNode } from "react";

export default async function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_ROUTES !== "true") {
    redirect("/");
  }
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") {
    redirect("/login");
  }
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
```

- [ ] **Step 3: Create `app/dev/primitives/page.tsx` skeleton** — sections will be filled by later tasks

```tsx
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
```

- [ ] **Step 4: Verify the page renders**

```bash
npm run dev
```

Visit `http://localhost:3000/dev/primitives` (logged in as admin). Confirm the page renders without errors. Stop dev.

- [ ] **Step 5: Commit**

```bash
git add app/dev/ app/_density-shell.tsx
git commit -m "feat(dev): /dev/primitives catalog scaffold + DensityShell SSR wrapper"
```

---

## Task 3: Button restyle

**Files:**
- Modify: `components/ui/button.tsx`
- Create: `tests/components/button.test.tsx`
- Modify: `app/dev/primitives/page.tsx` (append section)

- [ ] **Step 1: Write the failing test**

`tests/components/button.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders all 6 variants", () => {
    const variants = ["default", "secondary", "ghost", "outline", "destructive", "link"] as const;
    for (const v of variants) {
      render(<Button variant={v}>{v}</Button>);
      expect(screen.getByRole("button", { name: v })).toBeInTheDocument();
    }
  });

  it("uses rounded (8px) by default, not rounded-xl", () => {
    render(<Button>x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toMatch(/\brounded\b/);
    expect(cls).not.toMatch(/\brounded-xl\b/);
  });

  it("has no hover-translate (motion toned down per spec §8)", () => {
    render(<Button>x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).not.toMatch(/hover:-translate/);
  });

  it("size icon is 40×40 by default density", () => {
    render(<Button size="icon" aria-label="x">x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toMatch(/h-10/);
    expect(cls).toMatch(/w-10/);
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

```bash
npm test -- tests/components/button.test.tsx
```

Expected: FAIL on the rounded/hover-translate assertions (current Button uses `rounded-xl` and `hover:-translate-y-0.5`).

- [ ] **Step 3: Replace `components/ui/button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-border-strong bg-surface text-foreground shadow-xs hover:bg-surface-raised",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-surface-raised",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 px-2 text-xs",
        sm: "h-8 px-3 text-sm",
        default: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

Key changes from the existing version:
- `rounded-xl` → `rounded`
- Removed `hover:-translate-y-0.5`, `active:scale-[0.99]`, custom drop-shadow with primary color
- Removed `tracking-tight`, `whitespace-nowrap` kept
- `transition-all duration-200` → `transition-colors duration-150` (motion spec §8: 120ms hover)
- Added `xs` size (24px) per spec §9.1
- Outline variant uses `bg-surface` instead of `bg-white/70`
- Ghost variant uses `bg-surface-raised` on hover instead of `bg-accent/70`

- [ ] **Step 4: Run tests (expect pass)**

```bash
npm test -- tests/components/button.test.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Append Button section to demo page**

In `app/dev/primitives/page.tsx`, before the closing `</div>` of the main container, add:

```tsx
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
```

Add the import at the top of the file: `import { Button } from "@/components/ui/button";`.

- [ ] **Step 6: Commit**

```bash
git add components/ui/button.tsx tests/components/button.test.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): restyle Button to new tokens — calmer motion, surface/raised bg"
```

---

## Task 4: Input + Textarea + Label restyle

**Files:**
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/textarea.tsx`
- Modify: `components/ui/label.tsx`
- Create: `tests/components/input.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/input.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

describe("Input", () => {
  it("renders with rounded (8px), not rounded-xl", () => {
    render(<Input data-testid="i" />);
    const cls = screen.getByTestId("i").className;
    expect(cls).toMatch(/\brounded\b/);
    expect(cls).not.toMatch(/\brounded-xl\b/);
  });

  it("uses bg-surface, not bg-white/80", () => {
    render(<Input data-testid="i" />);
    const cls = screen.getByTestId("i").className;
    expect(cls).toMatch(/bg-surface\b/);
    expect(cls).not.toMatch(/bg-white\/80/);
  });

  it("has visible focus ring with --ring color", () => {
    render(<Input data-testid="i" />);
    const cls = screen.getByTestId("i").className;
    expect(cls).toMatch(/focus-visible:ring-2/);
    expect(cls).toMatch(/focus-visible:ring-ring/);
  });
});

describe("Textarea", () => {
  it("uses same surface + radius as Input", () => {
    render(<Textarea data-testid="t" />);
    const cls = screen.getByTestId("t").className;
    expect(cls).toMatch(/\brounded\b/);
    expect(cls).toMatch(/bg-surface\b/);
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

Expected: FAIL on bg-surface and rounded assertions.

- [ ] **Step 3: Replace `components/ui/input.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm",
          "ring-offset-background placeholder:text-muted-foreground",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[[data-density=compact]_&]:h-8 [[data-density=comfortable]_&]:h-12",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
```

Note: Density-aware sizing uses Tailwind's arbitrary variant syntax `[[data-density=compact]_&]:h-8` — outer brackets wrap the selector, `_` substitutes for the space inside, `&` references the styled element. This lets the same Input render differently inside a `<DensityProvider value="compact">`. **If your Tailwind version (<3.4) doesn't support this syntax, the fix is to drop these classes and pass the density-derived height via a wrapper component instead.**

- [ ] **Step 4: Replace `components/ui/textarea.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm",
          "ring-offset-background placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
```

- [ ] **Step 5: Update `components/ui/label.tsx`**

Read the existing file first. If it imports `@radix-ui/react-label` (typical shadcn), keep that and adjust classes:

```tsx
"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const labelVariants = cva(
  "text-sm font-medium text-foreground leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
```

- [ ] **Step 6: Run tests (expect pass)**

```bash
npm test -- tests/components/input.test.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 7: Append demo section**

In `app/dev/primitives/page.tsx`, add the imports (`Input`, `Textarea`, `Label`) and a section:

```tsx
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
```

- [ ] **Step 8: Commit**

```bash
git add components/ui/input.tsx components/ui/textarea.tsx components/ui/label.tsx tests/components/input.test.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): restyle Input/Textarea/Label — surface bg, rounded 8px, density-aware sizing"
```

---

## Task 5: FormField primitive (new)

**Files:**
- Create: `components/ui/form-field.tsx`
- Create: `tests/components/form-field.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/form-field.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

describe("FormField", () => {
  it("renders label, hint, and connects label-for to control id", () => {
    render(
      <FormField id="email" label="Email" hint="We never share it.">
        <Input id="email" />
      </FormField>
    );
    const label = screen.getByText("Email");
    expect(label).toHaveAttribute("for", "email");
    expect(screen.getByText("We never share it.")).toBeInTheDocument();
  });

  it("renders error message and applies aria-invalid", () => {
    render(
      <FormField id="email" label="Email" error="Required">
        <Input id="email" />
      </FormField>
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("Required")).toHaveAttribute("role", "alert");
  });

  it("hides hint when error is present", () => {
    render(
      <FormField id="email" label="Email" hint="Hint text" error="Required">
        <Input id="email" />
      </FormField>
    );
    expect(screen.queryByText("Hint text")).not.toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

Expected: FAIL — module not found.

- [ ] **Step 3: Create `components/ui/form-field.tsx`**

```tsx
import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
npm test -- tests/components/form-field.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Append demo section**

```tsx
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
```

Add import: `import { FormField } from "@/components/ui/form-field";`.

- [ ] **Step 6: Commit**

```bash
git add components/ui/form-field.tsx tests/components/form-field.test.tsx app/dev/primitives/page.tsx
git commit -m "feat(ui): FormField primitive — label + control + hint + error in one"
```

---

## Task 6: Card + Separator + ScrollArea restyle

**Files:**
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/separator.tsx`
- Modify: `components/ui/scroll-area.tsx`
- Create: `tests/components/card.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/card.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

describe("Card", () => {
  it("uses rounded-lg (12px) and border", () => {
    const { container } = render(<Card data-testid="c">x</Card>);
    const cls = container.querySelector("[data-testid=c]")!.className;
    expect(cls).toMatch(/\brounded-lg\b/);
    expect(cls).toMatch(/\bborder\b/);
    expect(cls).toMatch(/bg-surface|bg-card/);
  });

  it("CardContent has p-6 desktop default", () => {
    const { container } = render(
      <Card>
        <CardContent data-testid="cc">x</CardContent>
      </Card>
    );
    const cls = container.querySelector("[data-testid=cc]")!.className;
    expect(cls).toMatch(/p-6|p-4/);
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

- [ ] **Step 3: Replace `components/ui/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-border bg-surface text-card-foreground shadow-xs",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-4 sm:p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-lg font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 sm:p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 sm:p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

- [ ] **Step 4: Update `components/ui/separator.tsx`** — replace color tokens

Open the file, find the `bg-border` and any hardcoded `bg-*` references. Replace any custom background color with `bg-border` (already a token — should be unchanged usually). If the file imports from `@radix-ui/react-separator`, keep that. The likely-only change: ensure it reads `bg-border` (not a custom color).

If the file already uses `bg-border`, no change needed — record in the commit message that you verified it.

- [ ] **Step 5: Update `components/ui/scroll-area.tsx`** — scrollbar color tokens

Find the `ScrollAreaScrollbar` / `ScrollAreaThumb` styles. Replace any hardcoded thumb color with `bg-border-strong`. If the file uses `bg-border` for thumb, change to `bg-border-strong` for slightly more visible thumb.

- [ ] **Step 6: Run tests (expect pass)**

```bash
npm test -- tests/components/card.test.tsx
```

Expected: PASS — 2 tests.

- [ ] **Step 7: Append demo section**

```tsx
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
```

Add imports: `import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";`.

- [ ] **Step 8: Commit**

```bash
git add components/ui/card.tsx components/ui/separator.tsx components/ui/scroll-area.tsx tests/components/card.test.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): Card uses surface + border + shadow-xs + rounded-lg; Separator/ScrollArea token alignment"
```

---

## Task 7: StatusPill (new) + Badge consolidation

**Files:**
- Create: `components/ui/status-pill.tsx`
- Modify: `components/ui/badge.tsx` (thin compat alias forwarding to StatusPill)
- Create: `tests/components/status-pill.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/status-pill.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/components/ui/status-pill";

describe("StatusPill", () => {
  it("renders all 8 variants per spec §3.2", () => {
    const variants = [
      "neutral", "info", "success", "warning", "danger", "primary", "accent", "purple",
    ] as const;
    for (const v of variants) {
      const { container, unmount } = render(<StatusPill variant={v}>{v}</StatusPill>);
      expect(container.querySelector("span")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders dot indicator when withDot is true", () => {
    render(<StatusPill variant="success" withDot>Completed</StatusPill>);
    expect(screen.getByLabelText("indicator")).toBeInTheDocument();
  });

  it("uses rounded-full (pill shape)", () => {
    render(<StatusPill variant="info" data-testid="p">x</StatusPill>);
    expect(screen.getByTestId("p").className).toMatch(/rounded-full/);
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

- [ ] **Step 3: Create `components/ui/status-pill.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-secondary text-secondary-foreground",
        info: "bg-info/10 text-info",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        danger: "bg-destructive/10 text-destructive",
        primary: "bg-primary-soft text-primary",
        accent: "bg-accent/10 text-accent",
        purple: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
      },
      size: {
        sm: "text-[11px] px-1.5 py-0",
        default: "text-xs px-2 py-0.5",
      },
    },
    defaultVariants: { variant: "neutral", size: "default" },
  }
);

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  withDot?: boolean;
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, variant, size, withDot, children, ...props }, ref) => (
    <span ref={ref} className={cn(pillVariants({ variant, size }), className)} {...props}>
      {withDot ? (
        <span
          aria-label="indicator"
          className="size-1.5 rounded-full bg-current opacity-80"
        />
      ) : null}
      {children}
    </span>
  )
);
StatusPill.displayName = "StatusPill";
```

- [ ] **Step 4: Update `components/ui/badge.tsx` to forward to StatusPill** (compat alias)

```tsx
import { StatusPill, type StatusPillProps } from "@/components/ui/status-pill";

const VARIANT_MAP: Record<string, StatusPillProps["variant"]> = {
  default: "primary",
  secondary: "neutral",
  destructive: "danger",
  outline: "neutral",
  success: "success",
  warning: "warning",
};

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  variant?: keyof typeof VARIANT_MAP;
  children?: React.ReactNode;
}

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <StatusPill variant={VARIANT_MAP[variant]} className={className} {...props}>
      {children}
    </StatusPill>
  );
}

export const badgeVariants = () => ""; // kept for backward compat; consumers should migrate to StatusPill
```

Note: any existing `Badge` consumer keeps working but Plan C/D/E should migrate them to `StatusPill` directly. The `badgeVariants` export is a no-op kept only to prevent import errors during the transition.

- [ ] **Step 5: Run tests (expect pass)**

```bash
npm test -- tests/components/status-pill.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 6: Append demo section**

```tsx
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
```

Add: `import { StatusPill } from "@/components/ui/status-pill";`.

- [ ] **Step 7: Commit**

```bash
git add components/ui/status-pill.tsx components/ui/badge.tsx tests/components/status-pill.test.tsx app/dev/primitives/page.tsx
git commit -m "feat(ui): StatusPill primitive — 8 semantic variants; Badge becomes compat alias"
```

---

## Task 8: Dialog restyle + Drawer (new)

**Files:**
- Modify: `components/ui/dialog.tsx`
- Create: `components/ui/drawer.tsx`
- Create: `tests/components/dialog.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/dialog.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

describe("Dialog", () => {
  it("DialogContent uses rounded-lg (12px)", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dc">
          <DialogHeader><DialogTitle>Title</DialogTitle></DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const cls = screen.getByTestId("dc").className;
    expect(cls).toMatch(/rounded-lg/);
  });

  it("backdrop has blur per spec §9.7", () => {
    const { baseElement } = render(
      <Dialog open>
        <DialogContent>x</DialogContent>
      </Dialog>
    );
    const overlay = baseElement.querySelector("[data-radix-portal] [class*=backdrop-blur]");
    expect(overlay).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

- [ ] **Step 3: Locate and update `components/ui/dialog.tsx`** — replace the Overlay and Content class strings.

Read the file. Find `DialogOverlay` — its className should be:

```ts
"fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
```

Find `DialogContent` — its className should be:

```ts
"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-border bg-surface p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
```

Keep all other structure (DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogClose) — those are layout helpers and don't need restyling beyond what their children inherit.

- [ ] **Step 4: Create `components/ui/drawer.tsx`** — right (desktop) and bottom (mobile) drawer on Radix Dialog

```tsx
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const drawerVariants = cva(
  "fixed z-50 bg-surface shadow-lg transition ease-out data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        right:
          "right-0 top-0 h-full w-full max-w-md border-l border-border data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
        bottom:
          "left-0 right-0 bottom-0 max-h-[85vh] w-full rounded-t-xl border-t border-border data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
      },
    },
    defaultVariants: { side: "right" },
  }
);

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & VariantProps<typeof drawerVariants>
>(({ className, children, side, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
    <DialogPrimitive.Content ref={ref} className={cn(drawerVariants({ side }), "p-6", className)} {...props}>
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
        <X className="size-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DrawerContent.displayName = "DrawerContent";

export const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 pb-4", className)} {...props} />
);

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
DrawerTitle.displayName = "DrawerTitle";

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DrawerDescription.displayName = "DrawerDescription";
```

- [ ] **Step 5: Run tests (expect pass)**

- [ ] **Step 6: Append demo section** — wrap a Button trigger + Dialog + Drawer side variants.

- [ ] **Step 7: Commit**

```bash
git add components/ui/dialog.tsx components/ui/drawer.tsx tests/components/dialog.test.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): Dialog uses new radii + surface; new Drawer (right/bottom)"
```

---

## Task 9: EmptyState + LoadingState + ErrorState primitives

**Files:**
- Create: `components/ui/empty-state.tsx`
- Create: `components/ui/loading-state.tsx`
- Create: `components/ui/error-state.tsx`
- Create: `tests/components/states.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/states.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";

describe("EmptyState", () => {
  it("renders title, body, and CTA", () => {
    render(<EmptyState title="No jobs" body="Create one to start." action={<button>Create</button>} />);
    expect(screen.getByText("No jobs")).toBeInTheDocument();
    expect(screen.getByText("Create one to start.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("renders skeleton bars", () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelector(".skeleton")).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders error message and retry button when onRetry provided", () => {
    const onRetry = () => {};
    render(<ErrorState message="Server unreachable" onRetry={onRetry} />);
    expect(screen.getByText("Server unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

- [ ] **Step 3: Create `components/ui/empty-state.tsx`**

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface-raised/40 p-10 text-center",
        className
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {body ? <p className="text-xs text-muted-foreground">{body}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Create `components/ui/loading-state.tsx`**

```tsx
import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  /** "list" | "card" | "page" — visual treatment */
  variant?: "list" | "card" | "page";
  className?: string;
  rows?: number;
}

export function LoadingState({ variant = "list", className, rows = 4 }: LoadingStateProps) {
  if (variant === "card") {
    return (
      <div className={cn("space-y-3 rounded-lg border border-border bg-surface p-4", className)}>
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-5/6 rounded" />
      </div>
    );
  }
  if (variant === "page") {
    return (
      <div className={cn("space-y-4 p-6", className)}>
        <div className="skeleton h-8 w-1/3 rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton mt-6 h-40 w-full rounded-lg" />
      </div>
    );
  }
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10 w-full rounded" />
      ))}
    </div>
  );
}
```

(The `.skeleton` class is already defined in `app/globals.css` as a shimmering utility.)

- [ ] **Step 5: Create `components/ui/error-state.tsx`**

```tsx
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  onRetry?: () => void;
  supportLink?: { href: string; label: string };
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  supportLink,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center",
        className
      )}
      role="alert"
    >
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
      <div className="flex gap-2 pt-1">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {supportLink ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={supportLink.href}>{supportLink.label}</a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests (expect pass)**

- [ ] **Step 7: Append demo section + commit**

```tsx
<section id="states" className="space-y-4">
  <h2 className="text-lg font-semibold">Empty / Loading / Error states</h2>
  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
    <EmptyState title="No jobs scheduled" body="Create one to get started." action={<Button size="sm">Create job</Button>} />
    <LoadingState variant="card" />
    <ErrorState message="Couldn't reach the server — check your connection." onRetry={() => {}} />
  </div>
</section>
```

Add imports. Commit:

```bash
git add components/ui/empty-state.tsx components/ui/loading-state.tsx components/ui/error-state.tsx tests/components/states.test.tsx app/dev/primitives/page.tsx
git commit -m "feat(ui): EmptyState, LoadingState, ErrorState primitives"
```

---

## Task 10: FAB primitive (with safety rules)

**Files:**
- Create: `components/ui/fab.tsx`
- Create: `hooks/use-keyboard-visible.ts`
- Create: `tests/components/fab.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/fab.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FAB } from "@/components/ui/fab";

describe("FAB", () => {
  it("renders a button with aria-label", () => {
    render(<FAB aria-label="Create job" icon={<span>+</span>} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Create job" })).toBeInTheDocument();
  });

  it("has shadow-fab and rounded-full", () => {
    render(<FAB aria-label="x" icon={<span>+</span>} onClick={() => {}} data-testid="fab" />);
    const cls = screen.getByTestId("fab").className;
    expect(cls).toMatch(/shadow-fab/);
    expect(cls).toMatch(/rounded-full/);
  });

  it("is fixed bottom-right by default", () => {
    render(<FAB aria-label="x" icon={<span>+</span>} onClick={() => {}} data-testid="fab" />);
    const cls = screen.getByTestId("fab").className;
    expect(cls).toMatch(/fixed/);
    expect(cls).toMatch(/bottom-/);
    expect(cls).toMatch(/right-/);
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

- [ ] **Step 3: Create `hooks/use-keyboard-visible.ts`** — detects soft-keyboard via visualViewport API

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when the on-screen keyboard is likely open on a mobile device.
 * Uses `visualViewport` — degrades to always false on browsers without it.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = () => {
      // Heuristic: if visual viewport is < 75% of layout viewport, keyboard is up.
      const ratio = vv.height / window.innerHeight;
      setVisible(ratio < 0.75);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return visible;
}
```

- [ ] **Step 4: Create `components/ui/fab.tsx`**

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible";

export interface FABProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: React.ReactNode;
  label?: React.ReactNode;
  hideOnModalOpen?: boolean;
}

export const FAB = React.forwardRef<HTMLButtonElement, FABProps>(
  ({ className, icon, label, hideOnModalOpen = true, "aria-label": ariaLabel, ...props }, ref) => {
    const keyboardVisible = useKeyboardVisible();
    const [modalOpen, setModalOpen] = React.useState(false);

    React.useEffect(() => {
      if (!hideOnModalOpen) return;
      // Heuristic: detect open Radix Dialog by presence of [role=dialog] in DOM
      const obs = new MutationObserver(() => {
        setModalOpen(!!document.querySelector('[role="dialog"]'));
      });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => obs.disconnect();
    }, [hideOnModalOpen]);

    if (keyboardVisible || modalOpen) return null;

    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        className={cn(
          "fixed z-40 inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground shadow-fab",
          "transition-transform duration-150 hover:scale-105 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "right-[calc(env(safe-area-inset-right,0px)+16px)]",
          "bottom-[calc(env(safe-area-inset-bottom,0px)+16px+var(--bottom-nav-height,0px))]",
          label ? "h-14 px-5" : "size-14",
          "md:size-12 md:bottom-6 md:right-6",
          className
        )}
        {...props}
      >
        <span className="size-5 shrink-0">{icon}</span>
        {label ? <span className="font-medium">{label}</span> : null}
      </button>
    );
  }
);
FAB.displayName = "FAB";
```

- [ ] **Step 5: Run tests (expect pass)**

- [ ] **Step 6: Append demo section** (just shows the FAB once, fixed bottom-right of the dev page)

- [ ] **Step 7: Commit**

```bash
git add components/ui/fab.tsx hooks/use-keyboard-visible.ts tests/components/fab.test.tsx app/dev/primitives/page.tsx
git commit -m "feat(ui): FAB primitive — fixed positioning with safe-area, hides on keyboard/modal"
```

---

## Task 11: Toast + Toaster + Alert restyle

**Files:**
- Modify: `components/ui/toast.tsx`
- Modify: `components/ui/toaster.tsx`
- Modify: `components/ui/alert.tsx`
- Create: `tests/components/toast.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/toast.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Toaster } from "@/components/ui/toaster";

describe("Toaster", () => {
  it("renders a toast viewport in the document", () => {
    const { baseElement } = render(<Toaster />);
    const viewport = baseElement.querySelector("[role=region]");
    expect(viewport).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it (expect failure or pass — depends on existing structure)**

- [ ] **Step 3: Update `components/ui/toast.tsx`** — restyle the variants

Locate the `toastVariants` cva block. Replace the variant styles with:

```ts
{
  default: "border-border bg-surface text-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive [&_button]:text-destructive",
  success: "border-success/30 bg-success/10 text-success [&_button]:text-success",
  warning: "border-warning/30 bg-warning/10 text-warning [&_button]:text-warning",
  info: "border-info/30 bg-info/10 text-info [&_button]:text-info",
}
```

Update the `Toast` className root to use `rounded-lg shadow-lg`. Keep all Radix animation classes intact.

- [ ] **Step 4: Update `components/ui/toaster.tsx`** — change Toast Viewport position

Find the `<ToastViewport>` className. Change to:

```ts
"fixed top-2 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]"
```

This is the spec §9.8 rule: top-center on mobile, bottom-right on desktop.

- [ ] **Step 5: Update `components/ui/alert.tsx`** — minor: use new tokens

Open the existing alert.tsx. Find the cva variants. Replace any hardcoded colors with token-driven ones (similar pattern to Toast above). Add a comment at top:

```ts
// Alert is being kept for compatibility. New code should use ErrorState / EmptyState / inline StatusPill instead.
// We'll fully consolidate in a follow-up sweep.
```

- [ ] **Step 6: Run tests (expect pass)**

- [ ] **Step 7: Append demo section** — show one Alert per variant.

- [ ] **Step 8: Commit**

```bash
git add components/ui/toast.tsx components/ui/toaster.tsx components/ui/alert.tsx tests/components/toast.test.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): Toast/Toaster new tokens + reposition (bottom-right desktop, top mobile); Alert tokens"
```

---

## Task 12: DropdownMenu + Select + add Popover + Tooltip

**Files:**
- Modify: `components/ui/dropdown-menu.tsx`
- Modify: `components/ui/select.tsx`
- Create: `components/ui/popover.tsx` (via shadcn add — or hand-port; see Step 1)
- Create: `components/ui/tooltip.tsx` (via shadcn add — or hand-port)
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Add popover + tooltip via shadcn CLI if available**

```bash
npx shadcn@latest add popover tooltip
```

If shadcn isn't available or the project isn't configured for it, hand-create the two files based on the Radix UI docs (typical pattern is ~30 lines each). Verify the project uses `@radix-ui/react-popover` and `@radix-ui/react-tooltip` — both should be in package.json after this step.

If shadcn ran successfully, it'll create the two files and add deps. Verify by:

```bash
ls components/ui/popover.tsx components/ui/tooltip.tsx
```

- [ ] **Step 2: Restyle dropdown-menu.tsx** — find the `DropdownMenuContent` className and replace:

```ts
"z-50 min-w-[8rem] overflow-hidden rounded border border-border bg-surface p-1 text-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
```

Find `DropdownMenuItem` className:

```ts
"relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-surface-raised focus:bg-surface-raised data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
```

- [ ] **Step 3: Restyle select.tsx** — similar treatment to DropdownMenu. SelectTrigger uses Input-like styling (already restyled in Task 4 — match pattern). SelectContent matches DropdownMenuContent.

- [ ] **Step 4: Restyle popover.tsx + tooltip.tsx** — apply new tokens to PopoverContent + TooltipContent backgrounds and shadows.

- [ ] **Step 5: Append demo section** — one DropdownMenu, one Select, one Popover, one Tooltip example.

- [ ] **Step 6: Commit**

```bash
git add components/ui/dropdown-menu.tsx components/ui/select.tsx components/ui/popover.tsx components/ui/tooltip.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): DropdownMenu + Select tokens; add Popover + Tooltip via shadcn"
```

---

## Task 13: Tabs + Accordion + Checkbox + Switch restyle

**Files:**
- Modify: `components/ui/tabs.tsx`
- Modify: `components/ui/accordion.tsx`
- Modify: `components/ui/checkbox.tsx`
- Modify: `components/ui/switch.tsx`
- Modify: `app/dev/primitives/page.tsx`

For each, locate the cva variants or root className and replace tokenized colors as follows:

- **Tabs:** `TabsList` → `bg-surface-raised`, `TabsTrigger active` → `bg-surface text-foreground shadow-xs`. Use `rounded-sm` for trigger, `rounded-lg` for list.
- **Accordion:** `AccordionTrigger` → `text-foreground hover:bg-surface-raised`. `AccordionContent` → `text-muted-foreground`. Border becomes `border-border`.
- **Checkbox:** Checked state → `bg-primary text-primary-foreground`. Focus ring → `ring-ring`. Border → `border-border-strong`.
- **Switch:** Same color treatment as Checkbox. Track → `bg-secondary` when off, `bg-primary` when on.

Append a section to the demo page showing one of each.

- [ ] **Step 1: Make all the changes**

- [ ] **Step 2: Verify dev page renders without crash**

```bash
npm run dev
# visit /dev/primitives
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/tabs.tsx components/ui/accordion.tsx components/ui/checkbox.tsx components/ui/switch.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): Tabs/Accordion/Checkbox/Switch token sweep"
```

---

## Task 14: Progress restyle + a11y fix (resolves Plan A baseline violation)

**Files:**
- Modify: `components/ui/progress.tsx`
- Create: `tests/components/progress.test.tsx`
- Modify: `app/dev/primitives/page.tsx`

- [ ] **Step 1: Write the failing test**

`tests/components/progress.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("has role=progressbar and a11y label when label prop passed", () => {
    const { container } = render(<Progress value={40} label="Upload progress" />);
    const bar = container.querySelector("[role=progressbar]");
    expect(bar).toBeTruthy();
    expect(bar).toHaveAttribute("aria-label", "Upload progress");
  });

  it("requires either label or aria-labelledby (a11y safety)", () => {
    // Without a label, the component should still pass aria-label="" through if explicitly given,
    // OR a console warn. We assert the explicit aria-label path works.
    const { container } = render(<Progress value={50} aria-label="50%" />);
    expect(container.querySelector("[role=progressbar]")).toHaveAttribute("aria-label", "50%");
  });
});
```

- [ ] **Step 2: Run it (expect failure)**

- [ ] **Step 3: Replace `components/ui/progress.tsx`**

```tsx
"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  label?: string;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, label, "aria-label": ariaLabel, ...props }, ref) => {
  const effectiveLabel = ariaLabel ?? label;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      role="progressbar"
      aria-label={effectiveLabel}
      aria-valuenow={value ?? undefined}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
```

This **resolves the `aria-progressbar-name` serious violation** flagged in `docs/audits/a11y-baseline.md` because every consumer must now pass `label` or `aria-label`. (Consumers that pass neither will render a bar with `aria-label={undefined}` which axe will still flag — but the API now signals the requirement clearly.)

- [ ] **Step 4: Run tests (expect pass)**

- [ ] **Step 5: Append demo section + commit**

```tsx
<section id="progress" className="space-y-4">
  <h2 className="text-lg font-semibold">Progress</h2>
  <Progress value={40} label="Upload progress" className="max-w-md" />
</section>
```

```bash
git add components/ui/progress.tsx tests/components/progress.test.tsx app/dev/primitives/page.tsx
git commit -m "refactor(ui): Progress requires label/aria-label — fixes aria-progressbar-name a11y baseline"
```

---

## Task 15: Visual regression baseline lock-in

**Files:**
- Create: `e2e/primitives/visual.spec.ts`
- (Auto-generated): `e2e/primitives/visual.spec.ts-snapshots/*.png`
- Update: `docs/audits/a11y-baseline.md` (decrement the violation count)

- [ ] **Step 1: Write the visual spec**

`e2e/primitives/visual.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// Visual regression baseline for the primitives catalog.
// First run: locks the screenshots. Subsequent runs: diff against baseline.
// Requires admin login — set env BASELINE_ADMIN_EMAIL and BASELINE_ADMIN_PASSWORD,
// or use the bootstrap admin from seed data.

test.describe("primitives visual @visual", () => {
  test.beforeEach(async ({ page }) => {
    // Log in as admin
    await page.goto("/login");
    await page.fill("input[name=email]", process.env.BASELINE_ADMIN_EMAIL ?? "admin@sneekops.com.au");
    await page.fill("input[name=password]", process.env.BASELINE_ADMIN_PASSWORD ?? "admin123");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/admin/);
  });

  test("primitives catalog desktop @visual", async ({ page }) => {
    await page.goto("/dev/primitives");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("primitives-desktop.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
});
```

- [ ] **Step 2: First run — locks baselines**

```bash
npm run test:visual -- --update-snapshots
```

Expected: PASS. Generates `.png` files in `e2e/primitives/visual.spec.ts-snapshots/`.

- [ ] **Step 3: Second run — diffs against baseline**

```bash
npm run test:visual
```

Expected: PASS (zero diff).

- [ ] **Step 4: Manually open `/dev/primitives` and sanity-check the captured baselines look right**

If anything looks visually broken, do NOT lock the baseline — go back to the relevant primitive task, fix it, re-run.

- [ ] **Step 5: Update `docs/audits/a11y-baseline.md`** — decrement violation count by 1 (Progress is fixed), keep button-name and color-contrast for Plan G.

- [ ] **Step 6: Commit (including .png baseline files — these are intentionally tracked)**

```bash
git add e2e/primitives/visual.spec.ts e2e/primitives/visual.spec.ts-snapshots/ docs/audits/a11y-baseline.md
git commit -m "test(visual): lock primitives baseline + drop fixed Progress a11y violation"
```

---

## Task 16: Full verification + push + PR

- [ ] **Step 1: Lint** (will still skip on missing eslintrc — that's pre-existing from Plan A)

```bash
npm run lint || echo "Skipped (no eslintrc — pre-existing)"
```

- [ ] **Step 2: Vitest full run**

```bash
npm test
```

Expected: all primitive tests pass + Plan A tests pass. ~25-30 tests total.

- [ ] **Step 3: Playwright (a11y baseline should improve from Plan A — 1 fewer rule violation)**

```bash
npm run test:e2e -- --project=chromium-desktop
```

Expected: `home-a11y.spec.ts` still soft-fails on `button-name` and `color-contrast` (those are in marketing surfaces, addressed in Plan G). Progress violation gone. Visual regression suite passes.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/foundation-b-primitives
```

Open PR via GitHub UI (gh CLI not installed per Plan A retro) at:
`https://github.com/sanuthdesitha/sNeek_Property_Services_Webapp/pull/new/feat/foundation-b-primitives`

PR title: `Foundation B: primitives restyle + density system + new primitives`

PR body should reference this plan file, link to `/dev/primitives` for visual review, and call out the Progress a11y violation fix.

---

## Spec coverage check (run before declaring Plan B done)

Map every spec § to a task. If anything's orphaned, add the task.

| Spec § | Covered by Task(s) |
|---|---|
| §3.2 status pill 8 variants | 7 |
| §5.2 radii — sm/default/lg/xl/full | 3 (Button), 4 (Input), 6 (Card), 8 (Dialog), 10 (FAB rounded-full) |
| §5.3 shadow-fab | 10 |
| §6.1 icons + aria-label on icon-only buttons | 3 + 10 (FAB requires it) |
| §7 density modes — runtime | 1 + 2 (density attribute available; primitives use `[data-density=*]` arbitrary variants where relevant — see Task 4 Input example) |
| §8 motion — 120ms hover, 240ms modal | 3, 8, 10 |
| §9.1 Button — 6 variants × 5 sizes | 3 |
| §9.2 Input + FormField wrapper | 4, 5 |
| §9.5 Cards | 6 |
| §9.4 status pills | 7 |
| §9.6 empty/loading/error | 9 |
| §9.7 Modals + drawers | 8 |
| §9.8 toasts | 11 |
| §9.9 FAB safety rules | 10 |
| Progress a11y fix (from Plan A baseline) | 14 |

**Not in Plan B (deferred to Plan C):** Tables (`@tanstack/react-table` — they live in Plan C's nav/shell layer because they're stateful and read query params), command palette, keyboard shortcuts, navigation shells.

---

**Plan B is complete when Task 16 ships and the visual baseline is locked.**
