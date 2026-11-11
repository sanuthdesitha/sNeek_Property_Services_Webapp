"use client";

/**
 * The panel's guest card, "Guest, from the job's booking": name, phone, email,
 * stay and party, booking code and source, client. Edit marks the details as
 * entered by the office (never overwritten later). "Pick another booking"
 * lists this property's bookings around the found date; choosing one copies
 * that booking's guest. Edits are frozen while saving and a failed save keeps
 * what was typed.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import type { HydratedLostFoundItem } from "@/lib/lost-found/service";
import type { BookingSummary } from "@/lib/lost-found/guest";
import { telHref } from "@/lib/jobs/guest-summary";
import { formatStay, guestSourceInfo } from "./lost-found-format";

type Save = (payload: Record<string, unknown>, success: string) => Promise<boolean>;

const dt = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function GuestDetails({ item, timeZone }: { item: HydratedLostFoundItem; timeZone: string }) {
  const booking = item.booking;
  const phone = telHref(item.guestContact);
  return (
    <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
      <dt className={dt}>Name</dt>
      <dd className="min-w-0 break-words font-[600]">{item.guestName ?? <span className="font-[400] text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</dd>
      <dt className={dt}>{phone || !item.guestContact ? "Phone" : "Contact"}</dt>
      <dd className="min-w-0 break-words">{item.guestContact ? (phone ? <a className="underline" href={`tel:${phone}`}>{item.guestContact}</a> : item.guestContact) : <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</dd>
      <dt className={dt}>Email</dt>
      <dd className="min-w-0 break-words">{item.guestEmail ? <a className="underline" href={`mailto:${item.guestEmail}`}>{item.guestEmail}</a> : <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</dd>
      {booking ? (
        <>
          <dt className={dt}>Stay</dt>
          <dd>{formatStay(booking.startDate, booking.endDate, timeZone)}{booking.partyLabel ? ` · ${booking.partyLabel}` : ""}</dd>
          <dt className={dt}>Booking</dt>
          <dd className="break-words font-mono text-[0.75rem]">{[booking.reservationCode ?? "No code", booking.source].filter(Boolean).join(" · ")}</dd>
        </>
      ) : null}
      <dt className={dt}>Client</dt>
      <dd>{item.clientName ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</dd>
    </dl>
  );
}

function GuestEditForm({ item, save, onDone }: { item: HydratedLostFoundItem; save: Save; onDone: () => void }) {
  const [name, setName] = React.useState(item.guestName ?? "");
  const [contact, setContact] = React.useState(item.guestContact ?? "");
  const [email, setEmail] = React.useState(item.guestEmail ?? "");
  const [saving, setSaving] = React.useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const ok = await save({ guestName: name || null, guestContact: contact || null, guestEmail: email || null }, "Guest details saved");
    setSaving(false);
    if (ok) onDone();
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="space-y-2">
        <EField label="Guest name"><EInput value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></EField>
        <EField label="Phone or other contact"><EInput value={contact} maxLength={500} onChange={(event) => setContact(event.target.value)} /></EField>
        <EField label="Email"><EInput type="email" value={email} maxLength={320} onChange={(event) => setEmail(event.target.value)} /></EField>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Saved as entered by the office; nothing automatic replaces it.</p>
        <div className="flex justify-end gap-2">
          <EButton type="button" size="sm" variant="outline" onClick={onDone}>Cancel</EButton>
          <EButton type="submit" size="sm">{saving ? "Saving…" : "Save guest"}</EButton>
        </div>
      </fieldset>
    </form>
  );
}

type BookingsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; bookings: BookingSummary[]; currentId: string | null };

function BookingPicker({ item, timeZone, save, onDone }: { item: HydratedLostFoundItem; timeZone: string; save: Save; onDone: () => void }) {
  const [state, setState] = React.useState<BookingsState>({ status: "loading" });
  const [saving, setSaving] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/lost-found/${item.id}/bookings`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { bookings?: BookingSummary[]; currentId?: string | null; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.bookings) throw new Error(body?.error ?? "Could not load bookings.");
        setState({ status: "ready", bookings: body.bookings, currentId: body.currentId ?? null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Could not load bookings." });
      });
    return () => controller.abort();
  }, [item.id]);
  async function choose(booking: BookingSummary) {
    if (item.guestSource === "MANUAL" && !window.confirm("This replaces the guest details the office entered with this booking's guest. Continue?")) return;
    setSaving(booking.id);
    const ok = await save({ reservationId: booking.id }, "Guest taken from the booking");
    setSaving(null);
    if (ok) onDone();
  }
  if (state.status === "loading") return <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading bookings…</p>;
  if (state.status === "error") return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{state.message}</p>;
  if (!state.bookings.length) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No bookings at this property ended in the three weeks before the item was found.</p>;
  return (
    <ul aria-label="Bookings at this property" className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      {state.bookings.map((booking) => (
        <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.8125rem]">
          <span className="min-w-0">
            <span className="font-[600]">{booking.guestName ?? "No guest name"}</span>
            <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{formatStay(booking.startDate, booking.endDate, timeZone)}{booking.reservationCode ? ` · ${booking.reservationCode}` : ""}</span>
          </span>
          {booking.id === state.currentId ? (
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Linked now</span>
          ) : (
            <EButton size="sm" variant="outline" disabled={saving !== null} onClick={() => void choose(booking)}>{saving === booking.id ? "Saving…" : "Use this booking"}</EButton>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ItemGuestCard({ item, timeZone, save }: { item: HydratedLostFoundItem; timeZone: string; save: Save }) {
  const [mode, setMode] = React.useState<"view" | "edit" | "pick">("view");
  const source = guestSourceInfo(item);
  const heading = item.guestSource === "BOOKING" ? "Guest, from the job's booking" : item.guestSource === "MANUAL" ? "Guest, entered by the office" : "Guest";
  return (
    <section aria-label="Guest" className="flex flex-col gap-2.5 rounded-[12px] border border-[hsl(var(--e-primary)/0.25)] bg-[hsl(var(--e-primary-soft))] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-primary))]">{heading}</h3>
        {mode === "view" ? <EButton size="sm" variant="ghost" onClick={() => setMode("edit")}>Edit</EButton> : null}
      </div>
      {mode === "edit" ? <GuestEditForm item={item} save={save} onDone={() => setMode("view")} /> : <GuestDetails item={item} timeZone={timeZone} />}
      {!item.guestSource && mode === "view" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{source.label}.</p> : null}
      {mode === "pick" ? (
        <>
          <BookingPicker item={item} timeZone={timeZone} save={save} onDone={() => setMode("view")} />
          <EButton size="sm" variant="ghost" onClick={() => setMode("view")}>Close the booking list</EButton>
        </>
      ) : item.propertyId ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Not the right guest?{" "}
          <button type="button" className="underline" onClick={() => setMode("pick")}>Pick another booking at this property</button>
        </p>
      ) : null}
    </section>
  );
}
