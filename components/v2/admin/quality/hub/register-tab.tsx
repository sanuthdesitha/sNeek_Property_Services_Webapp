"use client";

/**
 * "All issues" tab of the Quality hub (pilot "All issues register"): one list
 * of issues from every source with figures for the current filter. Every row
 * links to its record's own page; nothing is edited here except logging a new
 * complaint or office-noticed issue.
 *
 * Filters live in the URL. Property, cleaner, category and search are the
 * hub's own (they carry to the other tabs); client, source, severity and
 * status are this tab's (`clientId`, `source`, `level`, `status`). The period
 * is the hub's period control. Reads are cancelled when the filter changes and
 * a late answer never fills a different filter (useQualityRead).
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Plus, Search } from "lucide-react";
import { ECard, EButton } from "@/components/v2/ui/primitives";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EPill } from "@/components/v2/ui/pill";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { periodQuery, type QualityPeriod } from "@/lib/quality/period";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import {
  EMPTY_REGISTER_FILTERS,
  REGISTER_SEVERITIES,
  REGISTER_SEVERITY_LABEL,
  REGISTER_SORTS,
  REGISTER_SOURCES,
  REGISTER_SOURCE_LABEL,
  REGISTER_STATUSES,
  REGISTER_STATUS_LABEL,
  parseRegisterFilters,
  writeRegisterFilters,
  type RegisterFilters,
  type RegisterResponse,
  type RegisterSort,
} from "@/lib/quality/register/model";
import { formatIssueMoment } from "../issues/issue-format";
import { hasArray, isRecord, useQualityRead } from "./use-quality-read";
import { RegisterBreakdown, RegisterHeadline, RegisterSourceNotes } from "./register-figures";
import { RegisterLogDialog, emptyRegisterLogDraft, type RegisterLogDraft, type RegisterLogDraftUpdate } from "./register-log-dialog";

export const REGISTER_PAGE_SIZE = 25;
type RegisterRowView = RegisterResponse["rows"][number];
/** The hub-owned filters this tab reads and writes through the hub. */
export type RegisterSharedFilters = Pick<RegisterFilters, "q" | "propertyId" | "cleanerId" | "category">;
type OwnFilters = Pick<RegisterFilters, "clientId" | "source" | "level" | "status">;

const isRegister = (body: unknown): body is RegisterResponse =>
  hasArray(body, "rows") && isRecord(body) && typeof body.total === "number" && isRecord(body.stats) && Array.isArray(body.sources);

function readOwn(params: URLSearchParams): OwnFilters {
  const parsed = parseRegisterFilters(params, false);
  return { clientId: parsed.clientId, source: parsed.source, level: parsed.level, status: parsed.status };
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T | ""; options: Array<{ id: T; label: string }>; onChange: (value: T | "") => void }) {
  const current = options.find((option) => option.id === value);
  return (
    <EFilterPopover label={label} value={value ? current?.label ?? value : null}>
      <label className="block space-y-1 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
        {label}
        <ESelect value={value} onChange={(event) => onChange(event.target.value as T | "")}>
          <option value="">Any</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </ESelect>
      </label>
    </EFilterPopover>
  );
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <form
      role="search"
      className="flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text.trim());
      }}
    >
      <label className="sr-only" htmlFor="register-search">Search issues</label>
      <EInput id="register-search" value={text} maxLength={100} placeholder="Search property, cleaner, job or text" className="h-9 w-56 max-w-full" onChange={(event) => setText(event.target.value)} />
      <EButton type="submit" size="sm" variant="outline" aria-label="Search">
        <Search aria-hidden className="h-3.5 w-3.5" />
      </EButton>
    </form>
  );
}

function statusCell(row: RegisterRowView, timeZone: string) {
  if (row.open) {
    return (
      <div className="space-y-0.5">
        <EPill tone={row.overdue ? "bad" : "warn"}>{row.overdue ? "Open over 48 h" : "Open"}</EPill>
        <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{`${row.statusLabel}${row.ageHours !== null ? ` · ${row.ageHours} h` : ""}`}</span>
      </div>
    );
  }
  const closed = row.closedAt ? `${formatIssueMoment(row.closedAt, timeZone)}${row.closedBy ? ` · ${row.closedBy}` : ""}` : `Close time not recorded${row.closedBy ? ` · ${row.closedBy}` : ""}`;
  return (
    <div className="space-y-0.5">
      <EPill tone="ok">{row.statusLabel}</EPill>
      <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{closed}</span>
    </div>
  );
}

function registerColumns(timeZone: string): Array<EDataColumn<RegisterRowView, RegisterSort>> {
  return [
    {
      key: "date",
      header: "Issue · raised",
      sortKey: "date",
      firstDir: "desc",
      phoneTitle: true,
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link href={row.href} className="font-[600] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">{row.title}</Link>
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {`${formatIssueMoment(row.date, timeZone)}${row.jobNumber ? ` · ${row.jobNumber}` : ""}${row.detail ? ` · ${row.detail}` : ""}`}
          </span>
        </div>
      ),
    },
    { key: "source", header: "Source", sortKey: "source", cell: (row) => <EPill tone="neutral">{REGISTER_SOURCE_LABEL[row.source]}</EPill> },
    {
      key: "property",
      header: "Property · client",
      sortKey: "property",
      cell: (row) => (
        <div className="min-w-0">
          <span className="block">{row.propertyName ?? "–"}</span>
          {row.clientName ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.clientName}</span> : null}
        </div>
      ),
    },
    { key: "cleaners", header: "Cleaner", cell: (row) => (row.cleaners.length ? row.cleaners.map((person) => person.name).join(", ") : "–") },
    { key: "category", header: "Category", cell: (row) => row.categoryLabel },
    {
      key: "severity",
      header: "Severity",
      sortKey: "severity",
      firstDir: "desc",
      cell: (row) => (row.severity ? <span title={row.severityLabel ?? undefined}>{REGISTER_SEVERITY_LABEL[row.severity]}</span> : <span className="text-[hsl(var(--e-muted-foreground))]">Not graded</span>),
    },
    { key: "status", header: "Status · closed", sortKey: "age", firstDir: "desc", cell: (row) => statusCell(row, timeZone) },
  ];
}

export function RegisterTab({
  period,
  shared,
  sort,
  dir,
  page,
  timeZone,
  canLog,
  onShared,
  onSort,
  onPage,
}: {
  period: QualityPeriod;
  shared: RegisterSharedFilters;
  sort: string;
  dir: "asc" | "desc" | "";
  page: number;
  timeZone: string;
  canLog: boolean;
  onShared: (patch: Partial<RegisterSharedFilters>) => void;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onPage: (page: number) => void;
}) {
  const searchParams = useSearchParams();
  const own = readOwn(new URLSearchParams(searchParams?.toString() ?? ""));
  const filters: RegisterFilters = { ...EMPTY_REGISTER_FILTERS, ...shared, ...own };
  const activeSort: RegisterSort = (REGISTER_SORTS as readonly string[]).includes(sort) ? (sort as RegisterSort) : "date";
  const activeDir = dir || "desc";

  const filterQuery = writeRegisterFilters(new URLSearchParams(periodQuery(period)), filters);
  const listParams = new URLSearchParams(filterQuery);
  listParams.set("sort", activeSort);
  listParams.set("dir", activeDir);
  listParams.set("page", String(page));
  listParams.set("pageSize", String(REGISTER_PAGE_SIZE));
  const read = useQualityRead(`/api/admin/quality/register?${listParams.toString()}`, isRegister, "The issues register could not be loaded.");

  const setOwn = React.useCallback(
    (patch: Partial<OwnFilters>) => {
      const params = new URLSearchParams(window.location.search);
      const next = { ...readOwn(params), ...patch };
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
      onPage(1);
    },
    [onPage],
  );

  // "Log an issue": the draft survives closing the dialog; a different property filter starts a fresh one.
  const [logOpen, setLogOpen] = React.useState(false);
  const [logDraft, setLogDraft] = React.useState<RegisterLogDraft | null>(null);
  const [logSaved, setLogSaved] = React.useState(false);
  const updateDraft: RegisterLogDraftUpdate = React.useCallback(
    (update) => setLogDraft((current) => (current ? update(current) : current)),
    [],
  );
  React.useEffect(() => setLogDraft(null), [shared.propertyId]);
  const openLog = () => {
    setLogDraft((current) => current ?? emptyRegisterLogDraft(sydneyTodayKey(), shared.propertyId));
    setLogOpen(true);
  };

  const data = read.data;
  const facets = data?.facets;
  const columns = React.useMemo(() => registerColumns(timeZone), [timeZone]);
  const exportParams = new URLSearchParams(filterQuery);
  exportParams.set("sort", activeSort);
  exportParams.set("dir", activeDir);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={shared.q} onSearch={(q) => onShared({ q })} />
        <Choice label="Property" value={shared.propertyId} options={facets?.properties ?? []} onChange={(propertyId) => onShared({ propertyId })} />
        <Choice label="Cleaner" value={shared.cleanerId} options={facets?.cleaners ?? []} onChange={(cleanerId) => onShared({ cleanerId })} />
        <Choice label="Client" value={own.clientId} options={facets?.clients ?? []} onChange={(clientId) => setOwn({ clientId })} />
        <Choice label="Source" value={own.source} options={REGISTER_SOURCES.map((id) => ({ id, label: REGISTER_SOURCE_LABEL[id] }))} onChange={(source) => setOwn({ source })} />
        <Choice label="Category" value={shared.category} options={facets?.categories ?? []} onChange={(category) => onShared({ category })} />
        <Choice label="Severity" value={own.level} options={REGISTER_SEVERITIES.map((id) => ({ id, label: REGISTER_SEVERITY_LABEL[id] }))} onChange={(level) => setOwn({ level })} />
        <Choice label="Status" value={own.status} options={REGISTER_STATUSES.map((id) => ({ id, label: REGISTER_STATUS_LABEL[id] }))} onChange={(status) => setOwn({ status })} />
        <span className="min-w-0 flex-1" />
        {canLog ? (
          <EButton size="sm" onClick={openLog}>
            <Plus aria-hidden className="h-3.5 w-3.5" /> Log an issue
          </EButton>
        ) : null}
        <EButton asChild size="sm" variant="outline">
          <a href={`/api/admin/quality/register/export?${exportParams.toString()}`} download>
            <Download aria-hidden className="h-3.5 w-3.5" /> Export CSV
          </a>
        </EButton>
      </div>

      {data ? (
        <>
          <RegisterSourceNotes sources={data.sources} />
          <RegisterHeadline data={data} />
        </>
      ) : null}

      <ECard className="overflow-hidden p-0">
        <EDataTable<RegisterRowView, RegisterSort>
          label="All issues"
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.key}
          sort={{ key: activeSort, dir: activeDir }}
          onSortChange={(next) => onSort(next.key, next.dir)}
          loading={read.loading}
          error={read.error}
          onRetry={read.reload}
          emptyTitle="No issues match"
          emptyDescription="Change the period or the filters."
          minWidth="56rem"
        />
      </ECard>
      {data ? <EPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={onPage} disabled={read.loading} noun="issues" /> : null}
      {data ? <RegisterBreakdown data={data} /> : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {`Times in ${timeZone}. Read from each source's own records; open a row to act on it there.`}
      </p>

      {logOpen && logDraft ? (
        <RegisterLogDialog
          draft={logDraft}
          onDraft={updateDraft}
          onClose={() => {
            setLogOpen(false);
            // A saved draft is finished: the next "Log an issue" starts empty.
            if (logSaved) {
              setLogDraft(null);
              setLogSaved(false);
            }
          }}
          onLogged={() => {
            setLogSaved(true);
            read.reload();
          }}
        />
      ) : null}
    </div>
  );
}
