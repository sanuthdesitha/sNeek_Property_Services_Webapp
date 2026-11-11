/**
 * CSV export of the table on each Insights tab, for the period and filters on
 * screen. A withheld figure is written as "Not enough data", never 0; the
 * basis and exclusion counts travel with the money and hours figures.
 * Financial columns are present only when the rows carry them (finance
 * feature). Pure.
 */
import type { BusinessCards, BusinessPayload } from "./business";
import type { CleanerRow, ClientRow, JobTypeRow, PropertyRow } from "./entities";
import { describeExclusions } from "./measure";
import type { EntityFigures, Measure, MeasureWithDelta } from "./types";

export const NOT_ENOUGH = "Not enough data";

type Cell = string | number | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading formula character would execute in a spreadsheet.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function value(measure: Measure | undefined): Cell {
  if (!measure) return "";
  return measure.value === null ? NOT_ENOUGH : measure.value;
}

function figureHeader(money: boolean): string[] {
  const base = [
    "Cleans", "Planned h", "Actual h", "Actual vs planned %", "Overruns", "Hours basis (cleans)", "Hours excluded",
    "On time %", "QA score", "Reviewed", "Issues", "Rework jobs", "Rework rate %",
  ];
  return money ? [...base, "Revenue (scheduled charge, AUD)", "Cleaner cost (AUD)", "Margin %", "Margin basis (cleans)", "Margin excluded"] : base;
}

function figureCells(figures: EntityFigures, money: boolean): Cell[] {
  const hours = figures.hours;
  const cells: Cell[] = [
    figures.cleans,
    value(hours.plannedHours),
    value(hours.actualHours),
    value(hours.ratio),
    hours.ratio.basisCount > 0 ? hours.overruns : NOT_ENOUGH,
    hours.ratio.basisCount,
    describeExclusions(hours.ratio.excluded) ?? "",
    value(figures.onTime),
    value(figures.qaScore),
    figures.reviewed,
    figures.issues,
    figures.reworkJobs,
    value(figures.reworkRate),
  ];
  if (!money) return cells;
  const m = figures.money;
  return [
    ...cells,
    value(m?.revenue),
    value(m?.cleanerCost),
    value(m?.margin),
    m?.margin.basisCount ?? "",
    m ? describeExclusions(m.margin.excluded) ?? "" : "",
  ];
}

export function propertiesCsv(rows: readonly PropertyRow[], money: boolean): string {
  return toCsv(
    ["Property", "Client", ...figureHeader(money)],
    rows.map((row) => [row.propertyName, row.clientName, ...figureCells(row.figures, money)]),
  );
}

export function clientsCsv(rows: readonly ClientRow[], money: boolean): string {
  const header = ["Client", "Properties", ...figureHeader(money)];
  if (money) header.push("Average days to pay", "Paid invoices (basis)", "Overdue now (AUD)", "Overdue invoices");
  return toCsv(
    header,
    rows.map((row) => {
      const cells: Cell[] = [row.clientName, row.properties, ...figureCells(row.figures, money)];
      if (money && row.payment) {
        cells.push(value(row.payment.daysToPay), row.payment.daysToPay.basisCount, row.payment.overdueAud, row.payment.overdueInvoices);
      }
      return cells;
    }),
  );
}

export function cleanersCsv(rows: readonly CleanerRow[]): string {
  return toCsv(["Cleaner", ...figureHeader(false)], rows.map((row) => [row.name, ...figureCells(row.figures, false)]));
}

export function jobTypesCsv(rows: readonly JobTypeRow[], money: boolean): string {
  return toCsv(
    ["Job type", ...figureHeader(money)],
    rows.map((row) => [row.jobType.replace(/_/g, " "), ...figureCells(row.figures, money)]),
  );
}

const CARD_LABEL: Record<keyof BusinessCards, string> = {
  revenue: "Revenue (scheduled charge, AUD)",
  margin: "Gross margin %",
  cleans: "Cleans done",
  onTime: "On time %",
  hoursRatio: "Actual vs planned hours %",
  reworkRate: "Rework rate %",
};

const CARD_ORDER: Array<keyof BusinessCards> = ["revenue", "margin", "cleans", "onTime", "hoursRatio", "reworkRate"];

export function businessCsv(payload: Pick<BusinessPayload, "cards" | "period">): string {
  const rows: Cell[][] = [];
  for (const key of CARD_ORDER) {
    const card: MeasureWithDelta | undefined = payload.cards[key];
    if (!card) continue;
    rows.push([
      CARD_LABEL[key],
      value(card),
      card.basisCount,
      card.excludedCount,
      describeExclusions(card.excluded) ?? "",
      card.previous ? value(card.previous) : "",
      card.delta === null ? "" : card.delta,
      card.delta === null ? "" : card.deltaKind === "percent" ? "% change" : card.deltaKind === "points" ? "points" : "count",
    ]);
  }
  return toCsv(
    ["Figure", `Value (${payload.period.label})`, "Basis", "Excluded", "Excluded reasons", `Previous (${payload.period.previous?.label ?? "none"})`, "Change", "Change unit"],
    rows,
  );
}
