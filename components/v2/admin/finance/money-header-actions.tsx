"use client";

/**
 * Page-wide actions in the Invoices and pay header: the Xero connection state,
 * "Billing schedule" (the draft cadence settings) and "New invoice".
 *
 * The schedule opens in a dialog that stays mounted once opened, so unsaved
 * ticks survive closing it. "New invoice" offers from finished jobs, a blank
 * invoice and a credit note; each opens the New invoice panel
 * (/v2/admin/finance/invoices/new) on that choice.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { InvoiceCadenceSettings } from "./invoice-cadence";
import { InvoiceSavedItems } from "./invoice-saved-items";
import { newInvoicePath } from "./invoices/new-invoice/new-invoice-format";

export type XeroConnectionSummary =
  /** lastSyncAt: the last successful whole Xero status check, or null when none is stored. */
  | { state: "connected"; tenantName: string | null; lastSyncAt: string | null; renewable?: boolean }
  /** Connected, but the access token expired and cannot be renewed. */
  | { state: "lapsed"; tenantName: string | null }
  | { state: "not-connected" }
  | { state: "unknown" };

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const XERO_SETTINGS_HREF = "/v2/admin/settings?tab=xero";

export function XeroConnectionBadge({ xero }: { xero: XeroConnectionSummary }) {
  if (xero.state === "lapsed") {
    return (
      <a href={XERO_SETTINGS_HREF} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]">
        <EPill tone="warn">Xero needs reconnecting</EPill>
      </a>
    );
  }
  if (xero.state === "connected") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <EPill tone="ok">
          Xero connected{xero.lastSyncAt ? ` · last checked ${relativeTime(xero.lastSyncAt)}` : ""}
        </EPill>
        {xero.renewable === false ? (
          <a href={XERO_SETTINGS_HREF} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]">
            <EPill tone="warn">Reconnect once to keep it connected</EPill>
          </a>
        ) : null}
      </span>
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
            <div className="space-y-4 px-6 py-5">
              <InvoiceCadenceSettings />
              <SavedItemsDisclosure />
            </div>
          </ECard>
        </div>
      ) : null}
    </>
  );
}

/** Saved invoice items, loaded only once opened (a secondary tool). */
function SavedItemsDisclosure() {
  const [opened, setOpened] = React.useState(false);
  return (
    <details
      className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="min-h-11 cursor-pointer py-2 text-[0.875rem] font-[600] sm:min-h-0">Saved invoice items</summary>
      {opened ? (
        <div className="pb-2 pt-1">
          <InvoiceSavedItems />
        </div>
      ) : null}
    </details>
  );
}

export function MoneyHeaderActions({
  xero,
  canBill,
  newInvoiceDockedOnPhone = false,
}: {
  xero: XeroConnectionSummary;
  canBill: boolean;
  /** The client-invoice tab docks "New invoice" at the bottom of a phone, so the header menu hides there below 640px. */
  newInvoiceDockedOnPhone?: boolean;
}) {
  const router = useRouter();
  return (
    <>
      <XeroConnectionBadge xero={xero} />
      {canBill ? (
        <>
          <BillingScheduleButton />
          <ERowMenu
            className={newInvoiceDockedOnPhone ? "max-sm:hidden" : undefined}
            label="New invoice"
            trigger={<>New invoice <span aria-hidden>▾</span></>}
            items={[
              {
                key: "jobs",
                label: "From finished jobs",
                onSelect: () => router.push(newInvoicePath("jobs")),
              },
              {
                key: "blank",
                label: "Blank invoice",
                onSelect: () => router.push(newInvoicePath("blank")),
              },
              {
                key: "credit",
                label: "Credit note",
                onSelect: () => router.push(newInvoicePath("credit")),
              },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
