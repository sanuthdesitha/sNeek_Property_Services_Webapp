"use client";

/**
 * New quote on the quote full page (board "Quote full page: detail and edit
 * combined"). The 2026-07 builder now lives in `./builder/*` (state, pricing,
 * checklist, sections, request bodies) and the page in `./full/*`; this entry
 * keeps the name and props the New quote route has always passed, including
 * the `?fromCase=`, `?clientId=` and `?leadId=` prefills.
 */
import * as React from "react";
import type { PricingVariable } from "@/lib/pricing/variables";
import type { CaseQuotePrefill } from "@/lib/cases/repair-quote";
import type { ClientOption, LeadOption, ServiceOption } from "./builder/model";
import type { MarginModel } from "./builder/margin";
import { QuoteFullPage } from "./full/quote-full-page";

export type { QuoteEditSeed } from "@/lib/quotes/quote-record";

export type QuoteBuilderProps = {
  leads: LeadOption[];
  clients: ClientOption[];
  services: ServiceOption[];
  gstEnabled: boolean;
  pricingVariables?: PricingVariable[];
  /** Cases "Create repair quote": read on the server from the case. */
  casePrefill?: CaseQuotePrefill;
  /** `?clientId=` / `?leadId=` on New quote, checked on the server. */
  recipientPrefill?: { clientId?: string; leadId?: string };
  marginModel?: MarginModel;
  timezone?: string;
  /** Prefill notices from the server page, shown under the heading. */
  notices?: React.ReactNode;
};

export function QuoteBuilder({ leads, clients, services, gstEnabled, pricingVariables = [], casePrefill, recipientPrefill, marginModel = null, timezone = "Australia/Sydney", notices }: QuoteBuilderProps) {
  return (
    <QuoteFullPage
      initial={null}
      builderOptions={{ leads, clients, services, gstEnabled, pricingVariables, casePrefill, recipientPrefill }}
      marginModel={marginModel}
      timezone={timezone}
      fromCase={null}
      notices={notices}
    />
  );
}
