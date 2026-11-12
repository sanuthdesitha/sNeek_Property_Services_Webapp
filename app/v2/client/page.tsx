import Link from "next/link";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { loadClientHome } from "@/lib/client/home-dashboard";
import { PhoneHome } from "@/components/v2/client/home/phone-home";
import { DesktopDashboard } from "@/components/v2/client/home/desktop-dashboard";
import { RequestButton } from "@/components/v2/client/portal/request-sheet";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { greetingFor, happeningNow, sydneyFormat, sydneyKey, type HomeJob } from "@/components/v2/client/home/home-model";

export const metadata = { title: "Home · Estate client" };
export const dynamic = "force-dynamic";

/**
 * Client Home (approved boards, 2026-11). One page, two compositions of the
 * same server data: the phone Home (board 1) below the desktop breakpoint and
 * the desktop dashboard above it. One heading and one main landmark (the
 * shell's). Every section keeps the visibility switches and VA grants it had.
 */
export default async function ClientHomePage() {
  const portal = await requireClientPortalPage();
  const data = await loadClientHome(portal);
  const now = new Date();
  const todayKey = sydneyKey(now);
  const firstName = portal.userName ? portal.userName.split(" ")[0] : null;

  const propertyCount = Array.isArray(data.properties) ? data.properties.length : null;
  const liveCount = data.jobs ? (happeningNow(data.jobs as HomeJob[], todayKey) ? 1 : 0) : null;
  const decisions = data.decisions && data.quotes ? data.decisions.count + data.quotes.length : null;
  const summary = [
    data.clientName,
    sydneyFormat(now, "EEEE d MMMM"),
    data.visibility.showProperties && propertyCount !== null ? `${propertyCount} ${propertyCount === 1 ? "property" : "properties"}` : null,
    liveCount !== null ? `${liveCount} clean in progress` : null,
    data.showDecisions && decisions !== null ? `${decisions} ${decisions === 1 ? "decision" : "decisions"} waiting` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <EEyebrow className="lg:hidden">{sydneyFormat(now, "EEEE · d MMMM")}</EEyebrow>
          <h1 className="e-display-md mt-0.5">
            <span className="lg:hidden">{firstName ? `Welcome back, ${firstName}.` : "Welcome back."}</span>
            <span className="hidden lg:inline">{greetingFor(now)}{firstName ? `, ${firstName}` : ""}</span>
          </h1>
          <p className="mt-1 hidden text-[0.875rem] text-[hsl(var(--e-muted-foreground))] lg:block">{summary}</p>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <RequestButton variant="labelled" />
          {data.visibility.showBooking ? (
            <Link href="/v2/client/booking" className="inline-flex min-h-11 items-center rounded-[var(--e-radius)] bg-[hsl(var(--e-accent-portal))] px-4 text-[0.875rem] font-[600] text-[hsl(var(--e-accent-portal-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              Book a clean
            </Link>
          ) : null}
        </div>
      </header>

      {data.failed.length > 0 ? (
        <div role="alert" className="border-l-4 border-[hsl(var(--e-danger))] px-4 py-3 text-sm">
          Some dashboard data could not be loaded: {data.failed.join(", ")}.{" "}
          <a href="/v2/client" className="underline">Retry</a>
        </div>
      ) : null}

      <div className="lg:hidden">
        <PhoneHome data={data} todayKey={todayKey} />
      </div>
      <div className="hidden lg:block">
        <DesktopDashboard data={data} todayKey={todayKey} />
      </div>
    </div>
  );
}
