"use client";

/**
 * ESTATE pagination: Previous / Next with "Showing a–b of N". N is the
 * server's real total for the current filters.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EButton } from "./primitives";

export type EPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  /** e.g. "invoices". */
  noun?: string;
  className?: string;
};

export function paginationRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return { from, to };
}

export function EPagination({ page, pageSize, total, onPageChange, disabled = false, noun = "rows", className }: EPaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const { from, to } = paginationRange(page, pageSize, total);
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] e-tnum" aria-live="polite">
        {total === 0 ? `No ${noun}` : `Showing ${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <EButton size="sm" variant="outline" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </EButton>
        <EButton size="sm" variant="outline" disabled={disabled || page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next
        </EButton>
      </div>
    </nav>
  );
}
