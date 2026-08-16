import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { rateLimit } from "@/lib/security/rate-limit";
import { lookupVerificationByCode } from "@/lib/reports/verification";
import { formatVerificationCode, normalizeVerificationCode } from "@/lib/reports/verification-code";

// Reads request headers + live DB state on every hit.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Report verification result",
  description: "Confirm whether a cleaning report code is genuine.",
};

const RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

function clientIpFromHeaders(): string {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-black/5 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default async function VerifyCodePage({ params }: { params: { code: string } }) {
  const shell = (inner: React.ReactNode) => (
    <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
      <div className="public-page-frame">
        <div className="max-w-2xl space-y-4">
          <p className="marketing-eyebrow">Report verification</p>
          <h1 className="text-4xl font-semibold">Verification result</h1>
        </div>
        <Card className="mt-8 max-w-2xl rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
          <CardContent className="p-6">{inner}</CardContent>
        </Card>
        <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
          Checked a code by mistake?{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/verify">
            Verify another report
          </Link>
          .
        </p>
      </div>
    </section>
  );

  // Per-IP rate limit: this is the only public surface that resolves codes, so
  // it is also the only place brute-force attempts could land.
  const limited = rateLimit(`verify:${clientIpFromHeaders()}`, RATE_LIMIT);
  if (!limited.ok) {
    return shell(
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold">Too many attempts</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please wait about {Math.max(1, Math.ceil(limited.retryAfterSec / 60))} minute
            {limited.retryAfterSec > 90 ? "s" : ""} and try again.
          </p>
        </div>
      </div>
    );
  }

  const normalized = normalizeVerificationCode(params.code);
  const vm = normalized ? await lookupVerificationByCode(normalized) : null;

  if (!vm) {
    return shell(
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold">We can&apos;t verify this code</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The code {formatVerificationCode(params.code.toUpperCase().slice(0, 24))} doesn&apos;t
            match any report we have issued. Check the code on the report and try again — codes
            have 16 letters and numbers.
          </p>
        </div>
      </div>
    );
  }

  if (vm.status === "revoked") {
    return shell(
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold">This report&apos;s code has been revoked</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A report with this code was issued but its verification has since been withdrawn.
            Please contact us if you were given this report recently.
          </p>
        </div>
      </div>
    );
  }

  return shell(
    <div>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold">Verified — this report is genuine</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {vm.kind === "DAMAGE"
              ? "This damage report was filed and recorded in our system. This check confirms the report exists; it does not reveal what it contains."
              : "This clean was performed and recorded in our system."}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <Row label={vm.kind === "DAMAGE" ? "Reported on" : "Service date"} value={vm.dateLabel} />
        <Row
          label={vm.kind === "DAMAGE" ? "Document" : "Service type"}
          value={vm.jobTypeLabel || "Cleaning service"}
        />
        {vm.kind === "DAMAGE" && typeof vm.damageItemCount === "number" ? (
          <Row label="Items recorded" value={String(vm.damageItemCount)} />
        ) : null}
        {vm.suburb ? <Row label="Suburb" value={vm.suburb} /> : null}
        {vm.cleanerFirstNames.length ? (
          <Row
            label={vm.kind === "DAMAGE" ? "Reported by" : "Cleaned by"}
            value={vm.cleanerFirstNames.join(", ")}
          />
        ) : null}
        {/* Clock times belong to a clean, not to a damage report. */}
        {vm.kind === "CLEANING" ? (
          <>
            <Row label="Clock-in" value={vm.clockInLabel ?? "Not recorded"} />
            <Row
              label="Clock-out"
              value={vm.clockOutMissing ? "Not clocked out" : (vm.clockOutLabel ?? "Not recorded")}
            />
          </>
        ) : null}
        {vm.issuedLabel ? <Row label="Code issued" value={vm.issuedLabel} /> : null}
      </div>
    </div>
  );
}
