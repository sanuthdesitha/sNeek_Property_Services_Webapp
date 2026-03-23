import { redirect } from "next/navigation";
import { getAppSettings, type AppSettings } from "@/lib/settings";

type CleanerModule =
  | "jobs"
  | "calendar"
  | "shopping"
  | "stockRuns"
  | "invoices"
  | "payRequests"
  | "lostFound";

type ClientModule =
  | "calendar"
  | "inventory"
  | "shopping"
  | "stockRuns"
  | "finance"
  | "reports"
  | "quoteRequests"
  | "approvals"
  | "disputes"
  | "cases";

type LaundryModule =
  | "calendar"
  | "invoices"
  | "history";

export async function ensureCleanerModuleAccess(module: CleanerModule) {
  const settings = await getAppSettings();
  const allowed = isCleanerModuleEnabled(settings, module);

  if (!allowed) {
    redirect("/cleaner");
  }
}

export async function ensureClientModuleAccess(module: ClientModule) {
  const settings = await getAppSettings();
  const allowed = isClientModuleEnabled(settings, module);

  if (!allowed) {
    redirect("/client");
  }
}

export async function ensureLaundryModuleAccess(module: LaundryModule) {
  const settings = await getAppSettings();
  const allowed = isLaundryModuleEnabled(settings, module);

  if (!allowed) {
    redirect("/laundry");
  }
}

export function isCleanerModuleEnabled(settings: AppSettings, module: CleanerModule) {
  const visibility = settings.cleanerPortalVisibility;
  return (
    (module === "jobs" && visibility.showJobs) ||
    (module === "calendar" && visibility.showCalendar) ||
    (module === "shopping" && visibility.showShopping) ||
    (module === "stockRuns" && visibility.showStockRuns) ||
    (module === "invoices" && visibility.showInvoices) ||
    (module === "payRequests" && visibility.showPayRequests) ||
    (module === "lostFound" && visibility.showLostFound)
  );
}

export function isClientModuleEnabled(settings: AppSettings, module: ClientModule) {
  const visibility = settings.clientPortalVisibility;
  return (
    (module === "calendar" && visibility.showCalendar) ||
    (module === "inventory" && visibility.showInventory) ||
    (module === "shopping" && visibility.showInventory && visibility.showShopping) ||
    (module === "stockRuns" && visibility.showInventory && visibility.showStockRuns && visibility.allowStockRuns) ||
    (module === "finance" && visibility.showFinanceDetails) ||
    (module === "reports" && visibility.showReports) ||
    (module === "quoteRequests" && visibility.showQuoteRequests) ||
    (module === "approvals" && visibility.showApprovals) ||
    (module === "disputes" && visibility.showCases) ||
    (module === "cases" && visibility.showCases)
  );
}

export function isLaundryModuleEnabled(settings: AppSettings, module: LaundryModule) {
  const visibility = settings.laundryPortalVisibility;
  return (
    (module === "calendar" && visibility.showCalendar) ||
    (module === "invoices" && visibility.showInvoices) ||
    (module === "history" && visibility.showHistoryTab)
  );
}
