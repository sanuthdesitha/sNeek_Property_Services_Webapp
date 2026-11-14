"use client";

/**
 * Workforce › Compliance (boards "Workforce" and "M-Workforce", 2026-11-16).
 *
 * An action list sorted by urgency with a review panel beside it, then every
 * document on file in a disclosure. Everything the old page did stays:
 * review, upload for someone, request a document, the full library with
 * search, category and status filters, and outstanding requests (now rows of
 * the action list). New: profile licence/visa/rego dates in the list, "Last
 * chased" from the reminder audit, "Next to review" and, on a phone, "Verify
 * and go to next".
 *
 * Chasing uses the existing shared dialogs: "Send reminder…" is Command's
 * document reminder (explicit routes, one per document per day, truthful
 * states); "Request renewal…" and "Request a document…" are the Accounts
 * request dialog. Nothing goes by a route nobody ticked.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, UploadCloud } from "lucide-react";
import { EButton, EStatCard } from "@/components/v2/ui/primitives";
import { EAvatar, EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EFilterBar } from "@/components/v2/ui/filter-bar";
import { ETonePill, E_BAND_BADGE_CLASS, toneMutedClass, tonePhoneBandClass, toneRowCellClass } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { cn } from "@/lib/utils";
import { DocumentRequestDialog } from "@/components/v2/admin/accounts/document-request-dialog";
import { DocumentReminderDialog } from "@/components/v2/admin/command/document-reminder-dialog";
import { toneForState, nextToReview, type ComplianceActionRow, type ComplianceFigures, type ComplianceRowState } from "@/lib/workforce/compliance-rows";
import type { ComplianceLibraryDoc, ComplianceRequestSummary, ComplianceStaffOption } from "@/lib/workforce/compliance-load";
import { ComplianceReview } from "./compliance-review";
import { calendarDay, chasedWords, dateCell, instant, remindedToday, rowDetail, statePill } from "./compliance-format";
import { docExpiryStatus, docStatusTone, prettify } from "./utils";

export const CATEGORY_OPTIONS = ["POLICE_CHECK", "DRIVER_LICENCE", "COMPLIANCE", "TRAINING", "INSURANCE", "WORKING_RIGHTS", "OTHER"];

const FIRST_ROWS = 7;

/* ── Header actions share the board's dialogs ───────────────────────────── */

type ComplianceDialogs = {
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
  request: { open: boolean; userId: string | null };
  openRequest: (userId?: string | null) => void;
  closeRequest: () => void;
};

const ComplianceDialogsContext = React.createContext<ComplianceDialogs | null>(null);

export function ComplianceDialogsProvider({ children }: { children: React.ReactNode }) {
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [request, setRequest] = React.useState<{ open: boolean; userId: string | null }>({ open: false, userId: null });
  const value = React.useMemo<ComplianceDialogs>(
    () => ({
      uploadOpen,
      setUploadOpen,
      request,
      openRequest: (userId) => setRequest({ open: true, userId: userId ?? null }),
      closeRequest: () => setRequest({ open: false, userId: null }),
    }),
    [uploadOpen, request],
  );
  return <ComplianceDialogsContext.Provider value={value}>{children}</ComplianceDialogsContext.Provider>;
}

function useComplianceDialogs(): ComplianceDialogs {
  const context = React.useContext(ComplianceDialogsContext);
  if (!context) throw new Error("ComplianceDialogsProvider is missing.");
  return context;
}

export function ComplianceHeaderActions({ disabledReason }: { disabledReason: string | null }) {
  const dialogs = useComplianceDialogs();
  return (
    <>
      <EButton variant="outline" size="sm" onClick={() => dialogs.setUploadOpen(true)} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined}>
        <UploadCloud className="h-4 w-4" /> Upload for someone…
      </EButton>
      <EButton size="sm" onClick={() => dialogs.openRequest(null)} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined}>
        <FilePlus2 className="h-4 w-4" /> Request a document…
      </EButton>
    </>
  );
}

/* ── The board ──────────────────────────────────────────────────────────── */

type StatusFilter = "ALL" | ComplianceRowState | "EXPIRY";

export type ComplianceBoardProps = {
  rows: ComplianceActionRow[];
  figures: ComplianceFigures;
  documents: ComplianceLibraryDoc[];
  requests: ComplianceRequestSummary[];
  staff: ComplianceStaffOption[];
  timeZone: string;
  todayKey: string;
  /** "Stop testing as … to send this." while testing as someone else. */
  readOnlyReason: string | null;
};

export function ComplianceBoard(props: ComplianceBoardProps) {
  const { rows, figures, documents, timeZone, readOnlyReason } = props;
  const router = useRouter();
  const phone = useIsPhone();
  const dialogs = useComplianceDialogs();

  const [query, setQuery] = React.useState("");
  const [person, setPerson] = React.useState("ALL");
  const [category, setCategory] = React.useState("ALL");
  const [status, setStatus] = React.useState<StatusFilter>("ALL");
  const [profileDates, setProfileDates] = React.useState<"SHOWN" | "HIDDEN">("SHOWN");
  const [showAll, setShowAll] = React.useState(false);
  const [reviewId, setReviewId] = React.useState<string | null>(null);
  const [reminderFor, setReminderFor] = React.useState<string | null>(null);
  const [savedNote, setSavedNote] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (person !== "ALL" && row.personId !== person) return false;
      if (category !== "ALL" && row.category.toUpperCase() !== category && !(category === "WORKING_RIGHTS" && row.credentialKind === "VISA") && !(category === "DRIVER_LICENCE" && row.credentialKind === "DRIVER_LICENCE")) return false;
      if (status === "EXPIRY" && row.state !== "EXPIRED" && row.state !== "EXPIRING") return false;
      if (status !== "ALL" && status !== "EXPIRY" && row.state !== status && !(status === "REQUESTED" && row.state === "OVERDUE_REQUEST")) return false;
      if (profileDates === "HIDDEN" && row.kind === "profile_date") return false;
      if (needle && ![row.personName, row.title, row.category].join(" ").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, query, person, category, status, profileDates]);

  // A new filter shows the first rows again.
  React.useEffect(() => setShowAll(false), [query, person, category, status, profileDates]);

  const shown = showAll ? visible : visible.slice(0, FIRST_ROWS);
  const reviewDoc = reviewId ? documents.find((document) => document.id === reviewId) ?? null : null;
  const waiting = rows.filter((row) => row.state === "WAITING_REVIEW" && row.documentId);
  const position = reviewDoc ? waiting.findIndex((row) => row.documentId === reviewDoc.id) : -1;
  const next = nextToReview(rows, reviewId);

  const active = [
    ...(query ? [{ key: "q", label: `“${query}”`, onRemove: () => setQuery("") }] : []),
    ...(person !== "ALL" ? [{ key: "person", label: props.staff.find((option) => option.id === person)?.name ?? "Person", onRemove: () => setPerson("ALL") }] : []),
    ...(category !== "ALL" ? [{ key: "category", label: prettify(category), onRemove: () => setCategory("ALL") }] : []),
    ...(status !== "ALL" ? [{ key: "status", label: status === "EXPIRY" ? "Expired or expiring" : prettify(status), onRemove: () => setStatus("ALL") }] : []),
    ...(profileDates === "HIDDEN" ? [{ key: "profile", label: "Profile dates hidden", onRemove: () => setProfileDates("SHOWN") }] : []),
  ];

  function clearFilters() {
    setQuery("");
    setPerson("ALL");
    setCategory("ALL");
    setStatus("ALL");
    setProfileDates("SHOWN");
  }

  function afterSave(goToNext: boolean) {
    const target = goToNext ? nextToReview(rows, reviewId) : null;
    setSavedNote(goToNext && !target ? "Saved. Nothing else is waiting for review." : "Saved.");
    setReviewId(target?.documentId ?? null);
    router.refresh();
  }

  const firstExpired = rows.find((row) => row.state === "EXPIRED");
  const oldestReview = waiting[0];

  // Phone: the review is its own page.
  if (phone && reviewDoc) {
    return (
      <ComplianceReview
        key={reviewDoc.id}
        doc={reviewDoc}
        position={position >= 0 ? { index: position + 1, total: waiting.length } : null}
        timeZone={timeZone}
        readOnlyReason={readOnlyReason}
        phone
        onSaved={afterSave}
        onNext={next?.documentId ? () => setReviewId(next.documentId) : null}
        onClose={() => setReviewId(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section aria-label="Compliance figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 max-sm:[&>*:first-child]:col-span-2">
        <EStatCard label="Needs action" value={String(figures.needsAction)} delta="all rows below" deltaTone="neutral" />
        <EStatCard label="Expired" value={String(figures.expired)} delta={firstExpired ? `${firstExpired.personName}, ${firstExpired.title.toLowerCase()}` : "none"} deltaTone={figures.expired ? "danger" : "neutral"} />
        <EStatCard label="Expiring soon" value={String(figures.expiring)} delta="files 14 days ahead, licence 30, visa 60" deltaTone="neutral" />
        <EStatCard label="Waiting for your review" value={String(figures.waitingReview)} delta={oldestReview ? `oldest uploaded ${instant(oldestReview.uploadedAt, timeZone)}` : "none waiting"} deltaTone="neutral" />
        <EStatCard label="Requested, not uploaded" value={String(figures.requested)} delta={figures.requestedPastDue ? `${figures.requestedPastDue} past the due date` : "none past due"} deltaTone={figures.requestedPastDue ? "danger" : "neutral"} />
      </section>

      <EFilterBar label="Filter compliance" active={active} onClear={clearFilters} resultLabel={`Show ${visible.length} rows`}>
        <EInput aria-label="Search person, document or file" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, document, file" className="min-w-[200px] flex-1" />
        <ESelect aria-label="Person" value={person} onChange={(event) => setPerson(event.target.value)} className="w-auto">
          <option value="ALL">Everyone</option>
          {props.staff.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </ESelect>
        <ESelect aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} className="w-auto">
          <option value="ALL">All categories</option>
          {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{prettify(option)}</option>)}
        </ESelect>
        <ESelect aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="w-auto">
          <option value="ALL">Any status</option>
          <option value="EXPIRY">Expired or expiring</option>
          <option value="EXPIRED">Expired</option>
          <option value="EXPIRING">Expiring</option>
          <option value="WAITING_REVIEW">Waiting for review</option>
          <option value="REQUESTED">Requested</option>
        </ESelect>
        <ESelect aria-label="Profile dates" value={profileDates} onChange={(event) => setProfileDates(event.target.value as "SHOWN" | "HIDDEN")} className="w-auto">
          <option value="SHOWN">Profile dates shown</option>
          <option value="HIDDEN">Profile dates hidden</option>
        </ESelect>
      </EFilterBar>

      {savedNote ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{savedNote}</p> : null}

      <div className={cn("grid min-w-0 grid-cols-1 gap-4", reviewDoc && "lg:grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <span>Sorted: most urgent first</span>
            <span>{visible.length} of {rows.length}</span>
          </div>
          {rows.length === 0 ? (
            <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 text-center">
              <p className="text-[0.9375rem] font-[600]">Every document is current and nothing is waiting for review.</p>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{nextExpiryLine(documents)}</p>
            </div>
          ) : visible.length === 0 ? (
            <p className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4 text-[0.875rem]">No row matches these filters. <button type="button" className="underline" onClick={clearFilters}>Clear filters</button></p>
          ) : phone ? (
            <ul className="space-y-2.5">
              {shown.map((row) => (
                <PhoneRow key={row.key} row={row} timeZone={timeZone} todayKey={props.todayKey} readOnlyReason={readOnlyReason}
                  onReview={() => row.documentId && setReviewId(row.documentId)} onRemind={() => row.documentId && setReminderFor(row.documentId)} onRequest={() => dialogs.openRequest(row.personId)} />
              ))}
            </ul>
          ) : (
            <div role="region" aria-label="Documents needing action" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
              <table className="w-full min-w-[760px] text-left text-[0.8125rem]">
                <thead>
                  <tr className="border-b border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <th scope="col" className="px-3 py-2 font-[550]">Person · document</th>
                    <th scope="col" className="px-3 py-2 font-[550]">State</th>
                    <th scope="col" className="px-3 py-2 font-[550]">Date</th>
                    <th scope="col" className="px-3 py-2 font-[550]">Last chased</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <DesktopRow key={row.key} row={row} timeZone={timeZone} todayKey={props.todayKey} readOnlyReason={readOnlyReason} selected={row.documentId !== null && row.documentId === reviewId}
                      onReview={() => row.documentId && setReviewId(row.documentId)} onRemind={() => row.documentId && setReminderFor(row.documentId)} onRequest={() => dialogs.openRequest(row.personId)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <span>One reminder per document per day; a second press shows the first one&rsquo;s time and result.</span>
            {visible.length > FIRST_ROWS ? (
              <EButton variant="outline" size="sm" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show fewer" : `Show ${visible.length - FIRST_ROWS} more`}
              </EButton>
            ) : null}
          </div>
        </div>

        {reviewDoc ? (
          <ComplianceReview
            key={reviewDoc.id}
            doc={reviewDoc}
            position={position >= 0 ? { index: position + 1, total: waiting.length } : null}
            timeZone={timeZone}
            readOnlyReason={readOnlyReason}
            phone={false}
            onSaved={afterSave}
            onNext={next?.documentId ? () => setReviewId(next.documentId) : null}
            onClose={() => setReviewId(null)}
          />
        ) : null}
      </div>

      <DocumentLibrary documents={documents} timeZone={timeZone} onReview={setReviewId} />

      {reminderFor ? (
        <DocumentReminderDialog documentId={reminderFor} endpoint="/api/admin/workforce" timeZone={timeZone} onClose={() => setReminderFor(null)} onSent={() => router.refresh()} />
      ) : null}
      <DocumentRequestDialog
        key={`${dialogs.request.userId ?? "anyone"}:${dialogs.request.open}`}
        open={dialogs.request.open}
        people={props.staff}
        initialUserId={dialogs.request.userId ?? undefined}
        onClose={dialogs.closeRequest}
        onSent={() => router.refresh()}
      />
      <UploadForSomeone staff={props.staff} requests={props.requests} open={dialogs.uploadOpen} onClose={() => dialogs.setUploadOpen(false)} onDone={() => router.refresh()} />
    </div>
  );
}

function nextExpiryLine(documents: ComplianceLibraryDoc[]): string {
  const now = Date.now();
  const upcoming = documents
    .filter((document) => document.expiresAt && Date.parse(document.expiresAt) > now && document.status !== "REJECTED")
    .sort((a, b) => Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!))[0];
  return upcoming ? `Next expiry: ${upcoming.user.name}, ${upcoming.title}, ${calendarDay(upcoming.expiresAt)}.` : "No upcoming expiry is recorded.";
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

type RowProps = {
  row: ComplianceActionRow;
  timeZone: string;
  todayKey: string;
  readOnlyReason: string | null;
  onReview: () => void;
  onRemind: () => void;
  onRequest: () => void;
};

function RowAction({ row, todayKey, timeZone, readOnlyReason, onReview, onRemind, onRequest }: Omit<RowProps, "row"> & { row: ComplianceActionRow }) {
  if (row.state === "WAITING_REVIEW") return <EButton size="sm" variant="outline" onClick={onReview}>Review</EButton>;
  if (row.kind === "profile_date") {
    return <EButton size="sm" variant="outline" onClick={onRequest} disabled={Boolean(readOnlyReason)} title={readOnlyReason ?? undefined}>Request renewal…</EButton>;
  }
  if (row.kind === "request") return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Waiting for upload</span>;
  if (remindedToday(row.lastChased, todayKey, timeZone)) return <EButton size="sm" variant="outline" onClick={onRemind}>Reminded today</EButton>;
  return <EButton size="sm" variant="outline" onClick={onRemind} disabled={Boolean(readOnlyReason)} title={readOnlyReason ?? undefined}>Send reminder…</EButton>;
}

function ChasedCell({ row, timeZone }: { row: ComplianceActionRow; timeZone: string }) {
  if (row.kind === "request") return <span>Requested {instant(row.uploadedAt, timeZone)}</span>;
  if (row.kind === "profile_date" || row.state === "WAITING_REVIEW") return <span aria-label="Not applicable">–</span>;
  const words = chasedWords(row.lastChased, timeZone);
  return (
    <span className="block">
      {words.line}
      {words.failed ? <span className="block font-[550] text-[hsl(var(--e-danger))]">▲ {words.failed}</span> : null}
    </span>
  );
}

function DesktopRow({ selected, ...props }: RowProps & { selected: boolean }) {
  const { row, timeZone } = props;
  const tone = toneForState(row.state);
  return (
    <tr className={cn("border-b border-[hsl(var(--e-border))] last:border-0 align-top", selected && "bg-[hsl(var(--e-primary-soft))]")}>
      <td className={cn("px-3 py-2.5", tone && toneRowCellClass(tone))}>
        <span className="flex items-start gap-2">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5 font-[600]">
              {row.personName}
              {row.kind === "profile_date" ? <span className={cn("rounded-full border border-[hsl(var(--e-border))] px-1.5 text-[0.6875rem] font-[500]", E_BAND_BADGE_CLASS)}>profile date</span> : null}
            </span>
            <span className={cn("block text-[0.75rem] [overflow-wrap:anywhere]", tone ? toneMutedClass(tone) : "text-[hsl(var(--e-muted-foreground))]")}>{rowDetail(row, timeZone)}</span>
          </span>
        </span>
      </td>
      <td className="px-3 py-2.5">
        {tone ? <ETonePill tone={tone} className="whitespace-nowrap">{statePill(row)}</ETonePill> : <span className="text-[0.75rem] font-[550]">{statePill(row)}</span>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">{dateCell(row)}</td>
      <td className="px-3 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]"><ChasedCell row={row} timeZone={timeZone} /></td>
      <td className="px-3 py-2.5 text-right"><RowAction {...props} /></td>
    </tr>
  );
}

function PhoneRow(props: RowProps) {
  const { row, timeZone } = props;
  const tone = toneForState(row.state);
  const chased = row.kind === "document" && row.state !== "WAITING_REVIEW" ? chasedWords(row.lastChased, timeZone) : null;
  return (
    <li className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className={cn("flex items-start justify-between gap-2 px-3.5 py-2.5", tone && tonePhoneBandClass(tone))}>
        <span className="min-w-0">
          <span className="block text-[0.9375rem] font-[600]">{row.personName}</span>
          <span className={cn("block text-[0.75rem] [overflow-wrap:anywhere]", tone ? toneMutedClass(tone) : "text-[hsl(var(--e-muted-foreground))]")}>
            {row.kind === "profile_date" ? `${row.title} date on profile · ${calendarDay(row.dateIso)}` : rowDetail(row, timeZone)}
          </span>
        </span>
        {tone ? <ETonePill tone={tone} className="max-w-[45%] shrink-0 text-right">{statePill(row)}</ETonePill> : <span className="shrink-0 text-[0.75rem] font-[600]">{statePill(row)}</span>}
      </div>
      {(row.kind === "document" && row.state !== "WAITING_REVIEW") || row.kind === "request" ? (
        <div className="space-y-2 border-t border-[hsl(var(--e-border))] px-3.5 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <p>
            {row.kind === "request" ? `Requested ${instant(row.uploadedAt, timeZone)} · ${dateCell(row)}` : `${row.state === "EXPIRED" ? "Expired" : "Expires"} ${calendarDay(row.dateIso)} · ${chased?.line ?? ""}`}
            {chased?.failed ? <span className="ml-1 font-[550] text-[hsl(var(--e-danger))]">▲ {chased.failed}</span> : null}
          </p>
          {row.kind === "document" ? <div className="[&>button]:w-full"><RowAction {...props} /></div> : null}
        </div>
      ) : (
        <div className="border-t border-[hsl(var(--e-border))] px-3.5 py-2.5 [&>button]:w-full"><RowAction {...props} /></div>
      )}
    </li>
  );
}

/* ── All documents on file (the old library) ────────────────────────────── */

function DocumentLibrary({ documents, timeZone, onReview }: { documents: ComplianceLibraryDoc[]; timeZone: string; onReview: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [everOpened, setEverOpened] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("ALL");
  const [status, setStatus] = React.useState("ALL");
  const panelId = React.useId();
  const verified = documents.filter((document) => document.status === "VERIFIED" || document.status === "SIGNED").length;
  const rejected = documents.filter((document) => document.status === "REJECTED").length;

  const library = React.useMemo(() => {
    const now = Date.now();
    const needle = query.trim().toLowerCase();
    return documents
      .filter((document) => (category === "ALL" ? true : document.category === category))
      .filter((document) => {
        if (status === "ALL") return true;
        if (status === "EXPIRED") return docExpiryStatus(document.expiresAt, now) === "EXPIRED";
        if (status === "EXPIRING_SOON") return docExpiryStatus(document.expiresAt, now) === "EXPIRING_SOON";
        return document.status === status;
      })
      .filter((document) => (needle ? [document.title, document.user.name, document.category, document.fileName].join(" ").toLowerCase().includes(needle) : true))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [documents, query, category, status]);

  return (
    <section aria-labelledby={`${panelId}-title`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <h2 id={`${panelId}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => { setOpen((value) => !value); setEverOpened(true); }}
          className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
        >
          <span className="text-[0.9375rem] font-semibold">All documents on file</span>
          <span className="text-[0.75rem] font-[500] text-[hsl(var(--e-muted-foreground))]">{documents.length} files · verified {verified} · rejected {rejected} · {open ? "Hide" : "Show"}</span>
        </button>
      </h2>
      {/* Kept mounted after the first open so its filters survive collapsing. */}
      {everOpened ? (
        <div id={panelId} hidden={!open} className="space-y-3 border-t border-[hsl(var(--e-border))] p-4">
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Every upload with category, file, who verified it and when. Rejected and replaced files stay in each person&rsquo;s history; nothing is deleted from here.</p>
          <div className="flex flex-wrap gap-2">
            <EInput aria-label="Search the documents on file" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, title or file…" className="min-w-[200px] flex-1" />
            <ESelect aria-label="Library category" value={category} onChange={(event) => setCategory(event.target.value)} className="w-auto">
              <option value="ALL">All categories</option>
              {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{prettify(option)}</option>)}
            </ESelect>
            <ESelect aria-label="Library status" value={status} onChange={(event) => setStatus(event.target.value)} className="w-auto">
              <option value="ALL">Any status</option>
              <option value="VERIFIED">Verified</option>
              <option value="PENDING">Pending review</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPIRING_SOON">Expiring soon</option>
              <option value="EXPIRED">Expired</option>
            </ESelect>
          </div>
          {library.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{documents.length === 0 ? "No documents are on file yet." : "No document on file matches those filters."}</p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {library.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <EAvatar name={document.user.name} image={document.user.image} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] font-[550]">{document.title} <span className="font-[400] text-[hsl(var(--e-muted-foreground))]">{document.user.name}</span></span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                      {prettify(document.category)} · {document.fileName}
                      {document.expiresAt ? ` · expires ${calendarDay(document.expiresAt)}` : " · no expiry"}
                      {document.verifiedByName ? ` · verified by ${document.verifiedByName}` : ""} · uploaded {instant(document.createdAt, timeZone)}
                    </span>
                  </span>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[0.75rem] font-[550]", docStatusTone(document.status) === "danger" ? "border-[hsl(var(--e-danger)/0.4)]" : "border-[hsl(var(--e-border))]")}>{prettify(document.status)}</span>
                  <a href={document.url} target="_blank" rel="noreferrer" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">Open</a>
                  <EButton size="sm" variant="outline" onClick={() => onReview(document.id)}>Review</EButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/* ── Upload a document for someone (unchanged behaviour) ────────────────── */

function UploadForSomeone({ staff, requests, open, onClose, onDone }: {
  staff: ComplianceStaffOption[];
  requests: ComplianceRequestSummary[];
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = React.useState("");
  const [category, setCategory] = React.useState("POLICE_CHECK");
  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [requestId, setRequestId] = React.useState("");
  const [signature, setSignature] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setUserId(staff[0]?.id ?? "");
    setCategory("POLICE_CHECK");
    setTitle("");
    setNotes("");
    setExpiry("");
    setRequestId("");
    setSignature(false);
    setFile(null);
    setError(null);
  }, [open, staff]);

  // Only the chosen person's outstanding asks; a changed person clears the pick.
  const outstanding = React.useMemo(() => requests.filter((request) => request.user.id === userId), [requests, userId]);
  React.useEffect(() => setRequestId(""), [userId]);

  async function submit() {
    if (!userId || !file || !title.trim()) {
      setError("Pick a team member, give it a title, and choose a file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Upload first: a row whose link goes nowhere reads as a lost certificate.
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "staff-documents");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploaded = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploaded?.key) {
        setError(uploaded?.error ?? "Could not upload that file.");
        return;
      }
      const res = await fetch("/api/admin/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPLOAD_DOCUMENT",
          userId,
          category,
          title: title.trim(),
          notes: notes || null,
          expiresAt: expiry || null,
          requestId: requestId || null,
          requiresSignature: signature,
          fileName: file.name,
          s3Key: uploaded.key,
          url: uploaded.url,
          mimeType: uploaded.mimeType ?? file.type,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not save the document.");
        return;
      }
      onClose();
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not upload that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open={open} onClose={onClose} title="Upload a document for someone" eyebrow="Compliance">
      <fieldset disabled={busy} className="space-y-4">
        <EField label="Team member">
          <ESelect value={userId} onChange={(event) => setUserId(event.target.value)}>
            {staff.map((option) => <option key={option.id} value={option.id}>{option.name} · {prettify(option.role)}</option>)}
          </ESelect>
        </EField>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Category">
            <ESelect value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{prettify(option)}</option>)}
            </ESelect>
          </EField>
          <EField label="Expiry date" hint="Leave blank if it never expires; the expiry drives the reminders.">
            <EInput type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
          </EField>
        </div>
        <EField label="Document title">
          <EInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Police check" />
        </EField>
        {outstanding.length > 0 ? (
          <EField label="Answers an outstanding request" hint="Linking it closes that request instead of leaving it on the chase list.">
            <ESelect value={requestId} onChange={(event) => setRequestId(event.target.value)}>
              <option value="">None</option>
              {outstanding.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
            </ESelect>
          </EField>
        ) : null}
        <EField label="Notes">
          <ETextarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Where it came from, anything worth recording" />
        </EField>
        <label className="flex min-h-11 items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" checked={signature} onChange={(event) => setSignature(event.target.checked)} className="h-4 w-4 accent-[hsl(var(--e-primary))]" />
          They must sign it once it is verified
        </label>
        <EField label="File">
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]" />
        </EField>
        {error ? <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton variant="outline" size="sm" onClick={onClose}>Cancel</EButton>
          <EButton size="sm" onClick={() => void submit()}>{busy ? "Uploading…" : "Upload document"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
