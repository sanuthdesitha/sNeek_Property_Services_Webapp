"use client";

/**
 * Properties, Clients and Cleaners tabs: one server-sorted, server-paged
 * table each, with a basis note under it. Rows link to the jobs list, the
 * Quality hub and client invoices with the filters those pages read.
 */
import * as React from "react";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { ECard } from "@/components/v2/ui/primitives";
import { useQualityRead } from "@/components/v2/admin/quality/hub/use-quality-read";
import { MIN_BASIS_ROW } from "@/lib/insights/measure";
import { formatAud } from "@/lib/insights/format";
import { figureColumns, linksColumn, NameCell } from "./entity-columns";
import { isEntityPage, type CleanerRow, type ClientRow, type EntityPage, type PropertyRow } from "./insights-types";
import { CellFigure, formatFigure } from "./measure-view";

export type TableControls = {
  apiQuery: string;
  sort: string;
  dir: "asc" | "desc" | "";
  page: number;
  money: boolean;
  onSort: (sort: string, dir: "asc" | "desc") => void;
  onPage: (page: number) => void;
};

const BASIS_NOTE =
  `Hours, on time and margin count only cleans with the inputs they need; hover a figure for its basis. ` +
  `A row figure needs at least ${MIN_BASIS_ROW} supporting records.`;

function EntityTable<T extends { id: string }>({
  path,
  label,
  noun,
  controls,
  columns,
  note,
}: {
  path: string;
  label: string;
  noun: string;
  controls: TableControls;
  columns: Array<EDataColumn<T, string>>;
  note: string;
}) {
  const params = new URLSearchParams(controls.apiQuery);
  if (controls.sort) params.set("sort", controls.sort);
  if (controls.dir) params.set("dir", controls.dir);
  params.set("page", String(controls.page));
  const read = useQualityRead<EntityPage<T>>(`${path}?${params.toString()}`, isEntityPage, `The ${noun} could not be loaded.`);
  const data = read.data;
  const sort = data ? { key: data.sort, dir: data.dir } : null;
  return (
    <ECard className="min-w-0 overflow-hidden">
      <EDataTable
        label={label}
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={(next) => controls.onSort(next.key, next.dir)}
        loading={read.loading}
        error={read.error}
        onRetry={read.reload}
        emptyTitle={`No ${noun} with cleans in this period`}
        minWidth="56rem"
      />
      <div className="space-y-2 border-t border-[hsl(var(--e-border))] px-4 py-3">
        {data ? (
          <EPagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={controls.onPage} disabled={read.loading} noun={noun} />
        ) : null}
        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{note}</p>
      </div>
    </ECard>
  );
}

export function PropertiesTab({ controls }: { controls: TableControls }) {
  const columns: Array<EDataColumn<PropertyRow, string>> = [
    { key: "name", header: "Property", sortKey: "name", cell: (row) => <NameCell title={row.propertyName} subtitle={row.clientName} /> },
    ...figureColumns<PropertyRow>({ money: controls.money, ratio: true, overruns: true, onTime: true, rework: true }),
    linksColumn<PropertyRow>(),
  ];
  return <EntityTable path="/api/admin/insights/properties" label="Properties" noun="properties" controls={controls} columns={columns} note={BASIS_NOTE} />;
}

function OverdueCell({ row }: { row: ClientRow }) {
  if (!row.payment) return null;
  if (row.payment.overdueInvoices === 0) return <span className="text-[hsl(var(--e-muted-foreground))]">None</span>;
  return (
    <span className="e-tnum font-[600] text-[hsl(var(--e-danger))]" title={`${row.payment.overdueInvoices} overdue invoices`}>
      {formatAud(row.payment.overdueAud)}
    </span>
  );
}

export function ClientsTab({ controls }: { controls: TableControls }) {
  const columns: Array<EDataColumn<ClientRow, string>> = [
    {
      key: "name",
      header: "Client",
      sortKey: "name",
      cell: (row) => <NameCell title={row.clientName} subtitle={`${row.properties} ${row.properties === 1 ? "property" : "properties"}`} />,
    },
    ...figureColumns<ClientRow>({ money: controls.money, onTime: true, rework: true }),
  ];
  if (controls.money) {
    columns.push(
      {
        key: "cost",
        header: "Cleaner cost",
        sortKey: "cost",
        firstDir: "desc",
        align: "right",
        cell: (row) => <CellFigure measure={row.figures.money?.cleanerCost} format="aud" />,
      },
      {
        key: "daysToPay",
        header: "Avg days to pay",
        sortKey: "daysToPay",
        firstDir: "desc",
        align: "right",
        cell: (row) =>
          row.payment && row.payment.daysToPay.value !== null ? (
            <span className="e-tnum" title={`${row.payment.daysToPay.basisCount} paid invoices`}>{formatFigure(row.payment.daysToPay.value, "days")}</span>
          ) : (
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No paid invoice</span>
          ),
      },
      { key: "overdue", header: "Overdue now", sortKey: "overdue", firstDir: "desc", align: "right", cell: (row) => <OverdueCell row={row} /> },
    );
  }
  columns.push(linksColumn<ClientRow>());
  const note = controls.money
    ? `${BASIS_NOTE} Days to pay: sent to paid, over invoices paid in the period. Overdue now: owing on invoices past the payment terms today.`
    : BASIS_NOTE;
  return <EntityTable path="/api/admin/insights/clients" label="Clients" noun="clients" controls={controls} columns={columns} note={note} />;
}

export function CleanersTab({ controls }: { controls: TableControls }) {
  const columns: Array<EDataColumn<CleanerRow, string>> = [
    { key: "name", header: "Cleaner", sortKey: "name", cell: (row) => <NameCell title={row.name} /> },
    ...figureColumns<CleanerRow>({ money: false, overruns: true, onTime: true, rework: true }),
    linksColumn<CleanerRow>(),
  ];
  const note =
    "Hours are each cleaner's share: allocated time split across the cleaners on the job, against their own time logs. " +
    "QA and issues use the Quality hub's rules for the same period. Rework counts rework jobs redoing their cleans.";
  return <EntityTable path="/api/admin/insights/cleaners" label="Cleaners" noun="cleaners" controls={controls} columns={columns} note={note} />;
}
