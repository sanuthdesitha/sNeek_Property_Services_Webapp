"use client";

/**
 * The client "What do you need?" sheet (board 7, "+ in header").
 *
 * One place to start any request: book, rebook, add-on, quote, fix, dispute,
 * shopping. Each entry is a link into the existing flow; the sheet never
 * creates anything itself. Entries are filtered with the same gates as the
 * navigation, so an assistant only sees what their team may open.
 */
import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestItemsFor, type ClientNavViewer } from "@/components/v2/client/portal/portal-nav";

interface RequestSheetContextValue {
  open: () => void;
  available: boolean;
}

const RequestSheetContext = React.createContext<RequestSheetContextValue>({ open: () => {}, available: false });

export function ClientRequestProvider({
  viewer,
  children,
}: {
  /** Null until the portal gate is confirmed: nothing is offered before that. */
  viewer: ClientNavViewer | null;
  children: React.ReactNode;
}) {
  const [isOpen, setOpen] = React.useState(false);
  const items = React.useMemo(() => (viewer ? requestItemsFor(viewer) : []), [viewer]);
  const value = React.useMemo<RequestSheetContextValue>(
    () => ({ open: () => setOpen(true), available: items.length > 0 }),
    [items.length],
  );
  return (
    <RequestSheetContext.Provider value={value}>
      {children}
      <Dialog.Root open={isOpen && items.length > 0} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content
            data-skin="estate"
            data-portal-accent="client"
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[1.125rem] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5 text-[hsl(var(--e-foreground))] shadow-xl sm:bottom-6 sm:rounded-[1.125rem]"
          >
            <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-[hsl(var(--e-border-strong))]" />
            <div className="flex items-center justify-between gap-2">
              <Dialog.Title className="text-[0.9375rem] font-semibold">What do you need?</Dialog.Title>
              <Dialog.Close aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] focus-visible:outline focus-visible:outline-2">
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </div>
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center justify-between gap-3 py-2 text-[0.875rem] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
                  >
                    <span className="font-[550]">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {item.hint}
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </RequestSheetContext.Provider>
  );
}

/** Header "+" (phone) or the labelled "Request" button (desktop page header). */
export function RequestButton({ variant = "icon", className }: { variant?: "icon" | "labelled"; className?: string }) {
  const { open, available } = React.useContext(RequestSheetContext);
  if (!available) return null;
  if (variant === "labelled") {
    return (
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-4 text-[0.875rem] font-[550] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2",
          className,
        )}
      >
        Request <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Request"
      aria-haspopup="dialog"
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2",
        className,
      )}
    >
      <Plus className="h-4 w-4" aria-hidden />
    </button>
  );
}
