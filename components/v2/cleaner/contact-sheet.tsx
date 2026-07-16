"use client";

/**
 * ESTATE cleaner — Contact sheet. A bottom sheet listing the tap-to-dial
 * numbers for a job (client / office / guest). Pure props, mobile-first, 48px
 * tap targets. Rows without a phone number are hidden. Styled on Estate tokens.
 */
import * as React from "react";
import { Phone, X } from "lucide-react";

export interface JobContact {
  clientName?: string | null;
  clientPhone?: string | null;
  companyPhone?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
}

type Row = { key: string; label: string; sublabel?: string | null; phone: string };

function buildRows(contact: JobContact): Row[] {
  const rows: Row[] = [];
  const clientPhone = (contact.clientPhone ?? "").trim();
  if (clientPhone) {
    rows.push({
      key: "client",
      label: (contact.clientName ?? "").trim() || "Client",
      sublabel: "Client",
      phone: clientPhone,
    });
  }
  const companyPhone = (contact.companyPhone ?? "").trim();
  if (companyPhone) {
    rows.push({ key: "office", label: "Office", sublabel: "Dispatch", phone: companyPhone });
  }
  const guestPhone = (contact.guestPhone ?? "").trim();
  if (guestPhone) {
    rows.push({
      key: "guest",
      label: (contact.guestName ?? "").trim() || "Guest",
      sublabel: "Guest",
      phone: guestPhone,
    });
  }
  return rows;
}

export function ContactRows({ contact }: { contact: JobContact }) {
  const rows = buildRows(contact);
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        No contact numbers configured
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <a
            href={`tel:${row.phone.replace(/\s+/g, "")}`}
            className="flex min-h-[48px] items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 transition-colors hover:bg-[hsl(var(--e-muted))]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-primary))]">
              <Phone className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">
                {row.label}
              </span>
              <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {row.sublabel ? `${row.sublabel} · ` : ""}
                {row.phone}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ContactSheet({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: JobContact;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]" onClick={onClose} />
      <div className="e-rise relative z-10 w-full max-w-md rounded-t-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)] sm:rounded-[var(--e-radius-lg)]">
        <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--e-border))] px-5 py-3.5">
          <h2 className="text-[0.9375rem] font-[600]">Contact</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <ContactRows contact={contact} />
        </div>
      </div>
    </div>
  );
}
