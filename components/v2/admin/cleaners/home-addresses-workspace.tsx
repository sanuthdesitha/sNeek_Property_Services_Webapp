"use client";

/**
 * Cleaner home addresses (board "Cleaner home addresses", 2026-11-17): two
 * honest notes, fact tiles, the address table (suburb then name, "Not
 * recorded" in words, an "On the map" column, a "Needs attention" filter) and
 * a suburb-level map. "Ask the N to update their profile…" sends an inbox
 * notice through the notification pipeline after an ordinary (tier A)
 * confirmation that names who will be told. Nothing is edited here.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ECard } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { ETonePill, EToneCard, toneRowCellClass, tonePhoneBandClass } from "@/components/v2/ui/tone-band";
import { DISPATCH_OTHER_SUBURB_TRAVEL_MIN, DISPATCH_SAME_SUBURB_TRAVEL_MIN } from "@/lib/scheduling-rules/constants";
import { HomeAddressMap, HomeAddressMapKey, type SuburbPin } from "./home-address-map";

export type HomeAddressRowView = {
  id: string;
  name: string;
  address: string | null;
  suburb: string | null;
  status: "placed" | "suburb_only" | "not_found" | "nothing";
  flag: string | null;
  onTheMap: string;
  transport: string;
  accountHref: string;
};

export type HomeAddressCounts = { active: number; placed: number; noAddress: number; suburbOnly: number; notFound: number; attention: number };

type Outcome = { userId: string; name: string; state: string; errorCode?: string | null };

const MUTED = "text-[hsl(var(--e-text-secondary))]";

const OUTCOME_WORDS: Record<string, string> = {
  inbox_available: "in their inbox",
  queued: "queued, not yet delivered",
  already_asked_today: "already asked today, not asked again",
  already_requested: "already asked today, not asked again",
  not_needed: "address now placed, not asked",
  not_found: "not an active cleaner, not asked",
  switched_off: "not sent: this notice is switched off in Notifications",
  skipped: "not sent: they can no longer receive it",
  uncertain: "may or may not have been sent; check their inbox before asking again",
  failed: "not sent",
};

function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "Ben Carter and Chloe Martin have no pin; their rows say why." (at most four names, then a count). */
function unpinnedSentence(list: string[]): string {
  const shown = list.length > 4 ? [...list.slice(0, 3), `${list.length - 3} others`] : list;
  return `${names(shown)} ${list.length === 1 ? "has" : "have"} no pin; ${list.length === 1 ? "the row says" : "their rows say"} why.`;
}

function FactTile({ label, value, sub, isNew = false }: { label: string; value: number; sub: string; isNew?: boolean }) {
  return (
    <ECard className="min-w-0 px-3.5 py-3">
      <p className="text-[0.6875rem] font-[550] text-[hsl(var(--e-text-secondary))]">{label}{isNew ? <span className="ml-1.5 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-info-soft))] px-1.5 text-[0.625rem] text-[hsl(var(--e-info))]">new</span> : null}</p>
      <p className="mt-0.5 text-[1.0625rem] font-[650] leading-tight">{value}</p>
      <p className={cn("mt-0.5 text-[0.6875rem]", MUTED)}>{sub}</p>
    </ECard>
  );
}

function notRecorded(value: string | null): React.ReactNode {
  return value ?? <span className={MUTED}>Not recorded</span>;
}

export function HomeAddressesWorkspace({ rows, pins, counts, mapConfigured }: { rows: HomeAddressRowView[]; pins: SuburbPin[]; counts: HomeAddressCounts; mapConfigured: boolean }) {
  const [search, setSearch] = React.useState("");
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [askError, setAskError] = React.useState<string | null>(null);
  const [outcomes, setOutcomes] = React.useState<Outcome[] | null>(null);

  const attention = rows.filter((row) => row.status !== "placed");
  const visible = rows.filter((row) => {
    if (attentionOnly && row.status === "placed") return false;
    const needle = search.trim().toLowerCase();
    return !needle || row.name.toLowerCase().includes(needle) || (row.suburb ?? "").toLowerCase().includes(needle);
  });

  function select(id: string) {
    setSelectedId(id);
    window.requestAnimationFrame(() => document.getElementById(`address-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  async function ask() {
    setSending(true);
    setAskError(null);
    try {
      const response = await fetch("/api/admin/cleaners/addresses/update-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerIds: attention.map((row) => row.id) }),
      });
      const body = (await response.json().catch(() => null)) as { outcomes?: Outcome[]; error?: string } | null;
      if (!response.ok || !Array.isArray(body?.outcomes)) {
        setAskError(`It was not sent: ${body?.error ?? "the server did not answer as expected."}`);
        return;
      }
      setOutcomes(body.outcomes);
      setAsking(false);
    } catch {
      setAskError("It was not sent: the server could not be reached. Nothing is known to have been sent.");
    } finally {
      setSending(false);
    }
  }

  if (rows.length === 0) {
    return (
      <ECard className="p-6 text-center" role="status">
        <p className="text-[0.9375rem] font-[600]">No active cleaners</p>
        <p className={cn("text-[0.8125rem]", MUTED)}>Addresses appear here once a cleaner account is active.</p>
      </ECard>
    );
  }

  const n = attention.length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" role="group" aria-label="Addresses in figures">
        <FactTile label="Active cleaners" value={counts.active} sub="sorted by suburb, then name" />
        <FactTile label="On the map" isNew value={counts.placed} sub="address found and placed" />
        <FactTile label="No address recorded" value={counts.noAddress} sub={`${counts.suburbOnly} with a suburb only`} />
        <FactTile label="Could not be placed" value={counts.notFound} sub="address too vague to find" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <ECard className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Find a cleaner or suburb</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a cleaner or suburb" className="h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] max-sm:h-11 max-sm:text-[1rem]" />
            </label>
            <button
              type="button"
              aria-pressed={attentionOnly}
              onClick={() => setAttentionOnly((value) => !value)}
              className={cn(
                "inline-flex min-h-9 items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] max-sm:min-h-11",
                attentionOnly ? "border-[hsl(var(--e-primary)/0.45)] bg-[hsl(var(--e-primary-soft))] font-[600]" : "border-[hsl(var(--e-border-strong))]",
              )}
            >
              Needs attention {n}
            </button>
          </div>

          {/* From 640px: the table, scrolling inside its own region. */}
          <div className="overflow-x-auto max-sm:hidden" role="region" aria-label="Cleaner home addresses" tabIndex={0}>
            <table className="w-full min-w-[33rem] text-left text-[0.875rem]">
              <thead>
                <tr className="border-y border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  <th scope="col" className="px-2.5 py-2 font-[550]">Cleaner</th>
                  <th scope="col" className="px-2.5 py-2 font-[550]">Residential address</th>
                  <th scope="col" className="px-2.5 py-2 font-[550]">Suburb</th>
                  <th scope="col" className="px-2.5 py-2 font-[550]">On the map</th>
                  <th scope="col" className="px-2.5 py-2 font-[550]">Gets to jobs by</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} id={`address-${row.id}`} className={cn("border-b border-[hsl(var(--e-border))] last:border-0", selectedId === row.id && "bg-[hsl(var(--e-primary-soft))]")}>
                    <th scope="row" className={cn("px-2.5 py-2.5 align-top font-[600]", row.flag && toneRowCellClass("attention"))}>
                      <Link href={row.accountHref} className="hover:underline">{row.name}</Link>
                      {row.flag ? <span className="mt-0.5 block"><ETonePill tone="attention">{row.flag}</ETonePill></span> : null}
                    </th>
                    <td className="px-2.5 py-2.5 align-top">{notRecorded(row.address)}</td>
                    <td className="px-2.5 py-2.5 align-top">{notRecorded(row.suburb)}</td>
                    <td className="px-2.5 py-2.5 align-top">{row.onTheMap}</td>
                    <td className="px-2.5 py-2.5 align-top">{row.transport}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per cleaner, a band when it needs attention. */}
          <ul className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))] sm:hidden" aria-label="Cleaner home addresses">
            {visible.map((row) => (
              <li key={row.id} id={`address-${row.id}`} className={cn(selectedId === row.id && "bg-[hsl(var(--e-primary-soft))]")}>
                <div className={cn("flex items-center justify-between gap-2 px-3 py-2", row.flag && tonePhoneBandClass("attention"))}>
                  <Link href={row.accountHref} className="min-w-0 truncate text-[0.9375rem] font-[600] hover:underline">{row.name}</Link>
                  {row.flag ? <ETonePill tone="attention">{row.flag}</ETonePill> : null}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-3 pb-2.5 text-[0.8125rem]">
                  <dt className={MUTED}>Address</dt><dd>{notRecorded(row.address)}</dd>
                  <dt className={MUTED}>Suburb</dt><dd>{notRecorded(row.suburb)}</dd>
                  <dt className={MUTED}>On the map</dt><dd>{row.onTheMap}</dd>
                  <dt className={MUTED}>Gets to jobs by</dt><dd>{row.transport}</dd>
                </dl>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? <p className={cn("p-4 text-[0.8125rem]", MUTED)} role="status">{attentionOnly && !search ? "Every address is placed on the map." : `No cleaner matches “${search}”.`}</p> : null}

          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.75rem]">
            <p className={cn("min-w-0 flex-1", MUTED)}>Names open the person&apos;s account page, where the address is edited. &ldquo;Gets to jobs by&rdquo; is the travel mode already on each profile.</p>
            {n > 0 ? (
              <button type="button" onClick={() => { setAskError(null); setAsking(true); }} className="min-h-9 font-[600] text-[hsl(var(--e-primary))] underline underline-offset-2 max-sm:min-h-11">
                Ask the {n} to update their profile…
              </button>
            ) : null}
          </div>
          {outcomes ? (
            <div role="status" className="border-t border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.8125rem]">
              <p className="font-[600]">Inbox notice</p>
              <ul className="mt-1 space-y-0.5">
                {outcomes.map((outcome) => <li key={outcome.userId}>{outcome.name}: {OUTCOME_WORDS[outcome.state] ?? "not sent"}</li>)}
              </ul>
            </div>
          ) : null}
        </ECard>

        <div className="min-w-0 space-y-2 lg:sticky lg:top-4 lg:self-start">
          <ECard className="overflow-hidden">
            <HomeAddressMap pins={pins} selectedId={selectedId} onSelect={select} mapConfigured={mapConfigured} />
            <HomeAddressMapKey />
          </ECard>
          <p className={cn("text-[0.75rem]", MUTED)}>
            Pins sit at the suburb&apos;s centre (worked out from the properties we look after there), or on a square about 2 km across where we look after none, never on the house, so a screenshot of this map does not reveal where anyone lives. The table holds the street address.
            {rows.length - pins.length > 0 ? ` ${unpinnedSentence(rows.filter((row) => !pins.some((pin) => pin.cleanerId === row.id)).map((row) => row.name))}` : ""}
          </p>
        </div>
      </div>

      <EConfirmDialog
        open={asking}
        onClose={() => { if (!sending) setAsking(false); }}
        tier="ordinary"
        title={`Ask ${n} cleaner${n === 1 ? "" : "s"} to update their profile?`}
        description={(
          <>
            <span className="block">An inbox notice goes to {names(attention.map((row) => row.name))}, asking {n === 1 ? "them" : "each of them"} to add or correct their home address in Your profile.</span>
            <span className="mt-1 block">Inbox only: no email, text or phone push. Anyone already asked today is not asked again.</span>
          </>
        )}
        confirmLabel={n === 1 ? "Send inbox notice" : `Send ${n} inbox notices`}
        busy={sending}
        error={askError}
        onConfirm={() => ask()}
      />
    </div>
  );
}

/** The two notes that lead the page: who can see it, and what (nothing) uses the addresses. */
export function HomeAddressNotes() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <EToneCard
        tone="info"
        header={(
          <div>
            <h2 className="text-[0.9375rem] font-[650]">Private: administrators only</h2>
            <p className="text-[0.75rem] opacity-90">Not shown to operations managers, clients, laundry partners or other cleaners, and not in any export.</p>
          </div>
        )}
        pill="Admins only"
      >
        <p className="text-[0.8125rem]">Nothing is edited here. A cleaner changes their own address in their profile; an administrator can change it on the person&apos;s account page. Each time someone opens this page it is written to the activity log (who and when, not the addresses).</p>
      </EToneCard>
      <EToneCard
        tone="attention"
        header={(
          <div>
            <h2 className="text-[0.9375rem] font-[650]">Not used for travel or suggestions</h2>
            <p className="text-[0.75rem] opacity-90">This page used to say &ldquo;for route planning&rdquo;, but nothing reads these addresses.</p>
          </div>
        )}
        pill="Shown here only"
      >
        <p className="text-[0.8125rem]">Route travel starts at each cleaner&apos;s first job ({DISPATCH_SAME_SUBURB_TRAVEL_MIN} min inside a suburb, {DISPATCH_OTHER_SUBURB_TRAVEL_MIN} between suburbs). Cleaner suggestions rank by past jobs in the suburb, today&apos;s load, QA score and availability. Neither reads a home address.</p>
      </EToneCard>
    </div>
  );
}
