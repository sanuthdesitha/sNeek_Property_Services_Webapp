"use client";

/**
 * Page-wide actions in the Invoices and pay header: the Xero connection state,
 * "Billing schedule" (the draft cadence settings) and "New invoice".
 *
 * The schedule opens in a dialog that stays mounted once opened, so unsaved
 * ticks survive closing it. "New invoice" offers the existing generator only;
 * blank invoices and credit notes are listed but disabled until a later step.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { InvoiceCadenceSettings } from "./invoice-cadence";

export type XeroConnectionSummary =
  | { state: "connected"; tenantName: string | null; lastSyncAt: string | null }
  | { state: "not-connected" }
  | { state: "unknown" };

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function XeroConnectionBadge({ xero }: { xero: XeroConnectionSummary }) {
  if (xero.state === "connected") {
    return (
      <EPill tone="ok">
        Xero connected{xero.lastSyncAt ? ` · last sync ${relativeTime(xero.lastSyncAt)}` : ""}
      </EPill>
    );
  }
  if (xero.state === "not-connected") return <EPill tone="warn">Xero not connected</EPill>;
  return <EPill>Xero status unknown</EPill>;
}

function BillingScheduleButton() {
  const [open, setOpen] = React.useState(false);
  const [visited, setVisited] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <EButton
        ref={triggerRef}
        variant="outline"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setVisited(true);
          setOpen(true);
        }}
      >
        Billing schedule
      </EButton>
      {visited ? (
        <div
          hidden={!open}
          className="fixed inset-0 z-50 overflow-y-auto p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]" onClick={close} />
          <ECard variant="ceremony" className="relative z-10 mx-auto my-8 w-full max-w-2xl shadow-[var(--e-elevation-3)]">
            <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--e-border))] px-6 py-4">
              <div className="min-w-0">
                <EEyebrow className="mb-1">Client invoices</EEyebrow>
                <h2 id={titleId} className="e-display-sm">
                  Billing schedule
                </h2>
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  Which clients get draft invoices prepared automatically. Saving creates, sends and exports nothing.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5">
              <InvoiceCadenceSettings />
            </div>
          </ECard>
        </div>
      ) : null}
    </>
  );
}

export function MoneyHeaderActions({ xero, canBill }: { xero: XeroConnectionSummary; canBill: boolean }) {
  const router = useRouter();
  return (
    <>
      <XeroConnectionBadge xero={xero} />
      {canBill ? (
        <>
          <BillingScheduleButton />
          <ERowMenu
            label="New invoice"
            trigger={<>New invoice <span aria-hidden>▾</span></>}
            items={[
              {
                key: "jobs",
                label: "From finished jobs",
                onSelect: () => router.push("/v2/admin/finance?tab=invoices&new=jobs", { scroll: false }),
              },
              { key: "blank", label: "Blank invoice", disabled: true, hint: "Coming in a later step" },
              { key: "credit", label: "Credit note", disabled: true, hint: "Coming in a later step" },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
