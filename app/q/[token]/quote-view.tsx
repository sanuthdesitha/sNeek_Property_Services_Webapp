"use client";

/**
 * Public online quote — standalone, mobile-first, light theme. Deliberately
 * self-contained: no portal chrome, no @/components imports. Styling matches
 * the quote PDF's premium look (white, slate ink, teal accents).
 */
import { useMemo, useState } from "react";
import type { PublicQuotePayload } from "@/app/api/public/quote-view/_lib";

const TEAL = "#0d9488";

function money(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function statusLabel(status: string, expired: boolean): string {
  if (status === "ACCEPTED") return "Accepted";
  if (status === "DECLINED") return "Declined";
  if (status === "CONVERTED") return "Confirmed";
  if (expired) return "Expired";
  return "Awaiting your response";
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function QuoteView({ token, quote }: { token: string; quote: PublicQuotePayload }) {
  // Local response state so the page flips into a confirmation view without a reload.
  const [responded, setResponded] = useState<null | { status: "ACCEPTED" | "DECLINED"; at: string }>(
    null
  );

  const effectiveStatus = responded?.status ?? quote.status;
  const respondedAt =
    responded?.at ?? (effectiveStatus === "ACCEPTED" ? quote.acceptedAt : quote.declinedAt);
  const isOpen = effectiveStatus === "SENT" && !quote.expired;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {/* ── Letterhead ── */}
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          {quote.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={quote.company.logoUrl}
              alt={quote.company.name}
              className="h-14 w-auto object-contain"
            />
          ) : (
            <div className="text-xl font-bold uppercase tracking-[0.18em] text-slate-700">
              {quote.company.name}
            </div>
          )}
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">
            {quote.serviceLabel} Quote
          </div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Quote for {quote.recipientFirstName}
          </h1>
          {/* Prominent quote reference — the client's shorthand for this quote. */}
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-4 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-600">
              Quote
            </span>
            <span className="text-base font-bold tracking-wide text-slate-900">
              #{quote.quoteRef}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Issued {formatDate(quote.createdAt)}
            {quote.validUntil ? ` · Valid until ${formatDate(quote.validUntil)}` : ""}
            {` · ${statusLabel(effectiveStatus, quote.expired)}`}
          </p>
        </header>

        {/* ── Status banner ── */}
        <StatusBanner status={effectiveStatus} expired={quote.expired} respondedAt={respondedAt} />

        {/* ── Line items + totals ── */}
        <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-700 text-xs uppercase tracking-wider text-white">
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 text-center font-semibold">Qty</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.lineItems.map((item, i) => (
                  <tr key={i} className={i % 2 === 1 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-4 py-3 text-slate-800">{item.label}</td>
                    <td className="px-4 py-3 text-center text-slate-500">
                      {item.qty % 1 === 0 ? item.qty : item.qty.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      {money(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 px-4 py-4">
            <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="text-slate-800">{money(quote.subtotal)}</span>
              </div>
              {quote.gstAmount > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>GST (10%)</span>
                  <span className="text-slate-800">{money(quote.gstAmount)}</span>
                </div>
              )}
              <div className="flex justify-between rounded-lg bg-teal-50 px-3 py-2 text-base font-bold text-slate-900">
                <span>Total (AUD)</span>
                <span style={{ color: TEAL }}>{money(quote.totalAmount)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Approve / Decline ── */}
        {isOpen && !responded && (
          <RespondPanel token={token} onResponded={(status, at) => setResponded({ status, at })} />
        )}

        {/* ── Chosen extras ── */}
        {quote.chosenExtras.length > 0 && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
              Included add-ons
            </h2>
            <div className="flex flex-wrap gap-2">
              {quote.chosenExtras.map((e, i) => (
                <span
                  key={i}
                  className="rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-800"
                >
                  {e.label}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Checklist ── */}
        {quote.checklist && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-700">
              What&apos;s included
            </h2>
            {quote.checklist.summary && (
              <p className="mb-4 text-sm leading-relaxed text-slate-500">{quote.checklist.summary}</p>
            )}
            <div className="grid gap-6 sm:grid-cols-2">
              <ul className="space-y-2">
                {quote.checklist.included.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <CheckIcon />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {quote.checklist.notIncluded.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Not included
                  </div>
                  <ul className="space-y-2">
                    {quote.checklist.notIncluded.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-slate-400">
                        <CrossIcon />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Reference images ── */}
        {quote.referenceImages.length > 0 && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
              Reference photos
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {quote.referenceImages.map((img, i) => (
                <figure key={i} className="overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.label || `Reference ${i + 1}`}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                  {img.label && (
                    <figcaption className="truncate bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
                      {img.label}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ── Add-on catalog / request ── */}
        <AddOnRequest token={token} quote={quote} />

        {/* ── Notes / terms ── */}
        {quote.notes && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">Notes</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{quote.notes}</p>
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-slate-400">
          {quote.company.name} · Quote ref {quote.quoteRef}
        </footer>
      </main>
    </div>
  );
}

// ── Status banner ─────────────────────────────────────────────────────────────

function StatusBanner({
  status,
  expired,
  respondedAt,
}: {
  status: string;
  expired: boolean;
  respondedAt: string | null | undefined;
}) {
  if (status === "ACCEPTED" || status === "CONVERTED") {
    return (
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3.5">
        <CheckIcon />
        <div>
          <div className="text-sm font-semibold text-teal-900">
            Quote accepted{respondedAt ? ` on ${formatDate(respondedAt)}` : ""}
          </div>
          <div className="text-sm text-teal-800">
            Thank you — we&apos;ll be in touch shortly to confirm the details.
          </div>
        </div>
      </div>
    );
  }
  if (status === "DECLINED") {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3.5">
        <div className="text-sm font-semibold text-slate-700">
          Quote declined{respondedAt ? ` on ${formatDate(respondedAt)}` : ""}
        </div>
        <div className="text-sm text-slate-500">
          Changed your mind or have questions? Just reply to our email — we&apos;re happy to revisit it.
        </div>
      </div>
    );
  }
  if (expired) {
    return (
      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
        <div className="text-sm font-semibold text-amber-900">This quote has expired</div>
        <div className="text-sm text-amber-800">
          The pricing below is no longer guaranteed. Contact us and we&apos;ll refresh it for you.
        </div>
      </div>
    );
  }
  return null;
}

// ── Approve / Decline panel ──────────────────────────────────────────────────

function RespondPanel({
  token,
  onResponded,
}: {
  token: string;
  onResponded: (status: "ACCEPTED" | "DECLINED", at: string) => void;
}) {
  const [confirming, setConfirming] = useState<null | "ACCEPT" | "DECLINE">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: "ACCEPT" | "DECLINE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/quote-view/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Something went wrong — please try again.");
        return;
      }
      onResponded(body.status, body.respondedAt ?? new Date().toISOString());
    } catch {
      setError("Something went wrong — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-700">
        Ready to go ahead?
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Approve this quote online and we&apos;ll take care of the rest.
      </p>

      {confirming === null ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setConfirming("ACCEPT")}
            className="flex-1 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ backgroundColor: TEAL }}
          >
            Approve quote
          </button>
          <button
            type="button"
            onClick={() => setConfirming("DECLINE")}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Decline
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-sm font-medium text-slate-800">
            {confirming === "ACCEPT"
              ? "Confirm you'd like to accept this quote?"
              : "Confirm you'd like to decline this quote?"}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 2000))}
            rows={2}
            placeholder="Optional message for us…"
            className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => submit(confirming)}
              className={`flex-1 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60 ${
                confirming === "ACCEPT" ? "" : "bg-slate-700 hover:bg-slate-800"
              }`}
              style={confirming === "ACCEPT" ? { backgroundColor: TEAL } : undefined}
            >
              {busy
                ? "Sending…"
                : confirming === "ACCEPT"
                  ? "Yes, accept quote"
                  : "Yes, decline quote"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(null);
                setError(null);
              }}
              className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
    </section>
  );
}

// ── Add-on request ───────────────────────────────────────────────────────────

function AddOnRequest({ token, quote }: { token: string; quote: PublicQuotePayload }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected]
  );

  async function submit() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/public/quote-view/${encodeURIComponent(token)}/request-addon`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: selectedIds, note: note.trim() || undefined }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Something went wrong — please try again.");
        return;
      }
      setSent(Array.isArray(body.requested) ? body.requested : selectedIds);
      setSelected({});
      setNote("");
    } catch {
      setError("Something went wrong — please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-700">
        Optional add-ons
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Request anytime — tick anything you&apos;d like and we&apos;ll come back with the details
        {quote.showAddOnPrices ? "." : " and pricing."}
      </p>

      {sent && (
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <span className="font-semibold">Request sent.</span> We&apos;ll be in touch about:{" "}
          {sent.join(", ")}.
        </div>
      )}

      <div className="space-y-5">
        {quote.addOnCatalog.map((group) => (
          <fieldset key={group.id}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {group.label}
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {group.options.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                    selected[opt.id]
                      ? "border-teal-400 bg-teal-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[opt.id])}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [opt.id]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-teal-600"
                    />
                    {opt.label}
                  </span>
                  {typeof opt.price === "number" ? (
                    <span className="shrink-0 font-medium text-slate-500">{money(opt.price)}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400">on request</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-5">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 1000))}
          rows={2}
          placeholder="Anything we should know? (optional)"
          className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy || selectedIds.length === 0}
          onClick={submit}
          className="w-full rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          style={{ backgroundColor: TEAL }}
        >
          {busy
            ? "Sending…"
            : selectedIds.length > 0
              ? `Request ${selectedIds.length} add-on${selectedIds.length === 1 ? "" : "s"}`
              : "Request add-ons"}
        </button>
        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </div>
    </section>
  );
}

// ── Tiny inline icons (no icon-library dependency) ───────────────────────────

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 h-4 w-4 shrink-0"
      stroke={TEAL}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 h-4 w-4 shrink-0 stroke-slate-300"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
