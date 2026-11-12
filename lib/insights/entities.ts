/**
 * Per-entity rows for the Properties, Clients and Cleaners tabs, and the job
 * type rows of Time and cost. Grouping and the shared measures only; the
 * service (./entity-service) loads, sorts and pages. Pure.
 */
import type { JobType } from "@prisma/client";
import { cleanTotalsByCleaner } from "@/lib/quality/cleans";
import { ALL_TIME, summarise, toCleanFacts, type HoursItem } from "./aggregate";
import type { JobFact } from "./job-facts";
import { jobsHref, qualityCleanersHref, qualityIssuesHref, invoicesHref, type DaySpan } from "./links";
import { MIN_BASIS_ROW } from "./measure";
import type { IssueCounts } from "./load-facts";
import { clientPayment, type ReceivablesFacts } from "./receivables";
import type { EntityFigures, InsightsLink, Measure } from "./types";

export type PropertyRow = {
  id: string;
  propertyName: string;
  clientId: string;
  clientName: string;
  figures: EntityFigures;
  links: InsightsLink[];
};

export type ClientRow = {
  id: string;
  clientName: string;
  properties: number;
  figures: EntityFigures;
  /** Present only with the finance feature. */
  payment?: { daysToPay: Measure; overdueAud: number; overdueInvoices: number };
  links: InsightsLink[];
};

export type CleanerRow = {
  id: string;
  name: string;
  figures: EntityFigures;
  links: InsightsLink[];
};

export type JobTypeRow = { id: JobType; jobType: JobType; figures: EntityFigures; links: InsightsLink[] };

function groupBy<K>(facts: readonly JobFact[], key: (fact: JobFact) => K): Map<K, JobFact[]> {
  const out = new Map<K, JobFact[]>();
  for (const fact of facts) {
    const value = key(fact);
    const list = out.get(value) ?? [];
    list.push(fact);
    out.set(value, list);
  }
  return out;
}

export function propertyRows(
  facts: readonly JobFact[],
  issues: IssueCounts,
  span: DaySpan,
  money: boolean,
): PropertyRow[] {
  return Array.from(groupBy(facts, (fact) => fact.propertyId).entries()).map(([propertyId, list]) => ({
    id: propertyId,
    propertyName: list[0].propertyName,
    clientId: list[0].clientId,
    clientName: list[0].clientName,
    figures: summarise(list, { minBasis: MIN_BASIS_ROW, money, issues: issues.byProperty.get(propertyId) ?? 0 }),
    links: [
      { label: "Cleans", href: jobsHref(span, { propertyId }) },
      { label: "Issues", href: qualityIssuesHref(span, { propertyId }) },
    ],
  }));
}

export function clientRows(
  facts: readonly JobFact[],
  issues: IssueCounts,
  receivables: ReceivablesFacts | null,
  span: DaySpan,
): ClientRow[] {
  const money = receivables !== null;
  return Array.from(groupBy(facts, (fact) => fact.clientId).entries()).map(([clientId, list]) => {
    const propertyIds = new Set(list.map((fact) => fact.propertyId));
    const issueTotal = Array.from(propertyIds).reduce((total, id) => total + (issues.byProperty.get(id) ?? 0), 0);
    const row: ClientRow = {
      id: clientId,
      clientName: list[0].clientName,
      properties: propertyIds.size,
      figures: summarise(list, { minBasis: MIN_BASIS_ROW, money, issues: issueTotal }),
      links: [{ label: "Cleans", href: jobsHref(span, { clientId }) }],
    };
    if (receivables) {
      const payment = clientPayment(receivables, clientId);
      row.payment = { daysToPay: payment.daysToPay, overdueAud: payment.overdueAud, overdueInvoices: payment.overdueInvoices };
      row.links.push({ label: "Invoices", href: invoicesHref({ clientId }) });
    }
    return row;
  });
}

/**
 * One row per cleaner with a clean in the period or an issue raised against
 * them (the Quality hub's rule). QA columns use the hub's per-cleaner clean
 * totals; hours are each cleaner's own share (allocated time split as pay
 * splits it, against their own time logs); rework counts rework jobs that
 * redo one of their cleans.
 */
export function cleanerRows(
  facts: readonly JobFact[],
  issues: IssueCounts,
  names: Map<string, string>,
  span: DaySpan,
): CleanerRow[] {
  const qa = cleanTotalsByCleaner(toCleanFacts(facts), ALL_TIME);
  const byCleaner = new Map<string, { facts: JobFact[]; hours: HoursItem[] }>();
  const ensure = (id: string) => {
    const entry = byCleaner.get(id) ?? { facts: [], hours: [] };
    byCleaner.set(id, entry);
    return entry;
  };
  for (const fact of facts) {
    for (const share of fact.shares) {
      const entry = ensure(share.cleanerId);
      entry.facts.push(fact);
      entry.hours.push(share);
    }
  }
  for (const cleanerId of Array.from(issues.byCleaner.keys())) ensure(cleanerId);

  return Array.from(byCleaner.entries()).map(([cleanerId, entry]) => {
    const reworkJobs = facts.filter((fact) => fact.isRework && fact.reworkOriginalCleanerIds.includes(cleanerId)).length;
    return {
      id: cleanerId,
      name: names.get(cleanerId) ?? "Cleaner",
      figures: summarise(entry.facts, {
        minBasis: MIN_BASIS_ROW,
        money: false,
        issues: issues.byCleaner.get(cleanerId) ?? 0,
        reworkJobs,
        hoursItems: entry.hours,
        qa: qa.get(cleanerId) ?? { cleans: 0, reviewed: 0, avgScore: null },
      }),
      links: [
        { label: "Cleans", href: jobsHref(span, { cleanerId }) },
        { label: "Quality", href: qualityCleanersHref(span, cleanerId) },
      ],
    };
  });
}

export function jobTypeRows(facts: readonly JobFact[], span: DaySpan, money: boolean): JobTypeRow[] {
  return Array.from(groupBy(facts, (fact) => fact.jobType).entries())
    .map(([jobType, list]) => ({
      id: jobType,
      jobType,
      figures: summarise(list, { minBasis: MIN_BASIS_ROW, money, issues: 0 }),
      links: [{ label: "Cleans", href: jobsHref(span, { jobType }) }],
    }))
    .sort((a, b) => b.figures.cleans - a.figures.cleans || a.jobType.localeCompare(b.jobType));
}
