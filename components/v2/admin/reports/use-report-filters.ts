"use client";

/**
 * The PDFs manager's filters, kept in the URL beside the Insights tab state.
 * Changes use history.replaceState (Next 14.2 keeps useSearchParams in step);
 * back/forward and new links are followed.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { readReportFilters, writeReportFilters, type ReportManagerFilters } from "@/lib/reports/manager-query";

function currentQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

export function useReportFilters(): {
  filters: ReportManagerFilters;
  setFilters: (patch: Partial<ReportManagerFilters>) => void;
} {
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? null;
  const [filters, setState] = React.useState<ReportManagerFilters>(() =>
    readReportFilters(searchString !== null ? new URLSearchParams(searchString) : currentQuery()),
  );

  React.useEffect(() => {
    if (searchString === null) return;
    const fromUrl = readReportFilters(new URLSearchParams(searchString));
    setState((previous) => (JSON.stringify(previous) === JSON.stringify(fromUrl) ? previous : fromUrl));
  }, [searchString]);

  const ref = React.useRef(filters);
  ref.current = filters;

  const setFilters = React.useCallback((patch: Partial<ReportManagerFilters>) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setState(next);
    if (typeof window !== "undefined") {
      // The manager is the Insights "pdfs" tab: pin the tab so clearing every
      // filter does not turn the URL back into the Business tab.
      const params = writeReportFilters(currentQuery(), next);
      params.set("tab", "pdfs");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  return { filters, setFilters };
}
