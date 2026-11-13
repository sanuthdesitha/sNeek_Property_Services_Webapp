import Link from "next/link";
import { Role } from "@prisma/client";
import { ArrowRight, RefreshCw } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getResolvedVisionProviderConfiguration } from "@/lib/ai/config";
import { describeFeatureRoute } from "@/lib/ai/provider/routing";
import { getVisionSettings } from "@/lib/ai/vision-settings";
import { VisionSettingsPanel } from "@/components/v2/admin/vision-settings";
import { getRecognitionConfiguration } from "@/lib/ai/property-photo-model";
import { PropertyPhotoMemoryPanel } from "@/components/v2/admin/property-photo-memory";
import { PhotoReviewOptOutPanel } from "@/components/v2/admin/photo-review-opt-out";
import { getPhotoReviewAgreement, type AgreementReport } from "@/lib/ai/photo-review-evaluation";
import { EBadge, EPageHeader } from "@/components/v2/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI configuration | Estate admin" };

export default async function AiConfigurationPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const config = await describeFeatureRoute("text_compose");
  const visionSettings = await getVisionSettings();
  return <div className="space-y-6">
    <EPageHeader eyebrow="Configuration" title="AI configuration" />
    <VisionSettingsPanel initialSettings={visionSettings} configured={(await getResolvedVisionProviderConfiguration(visionSettings.provider)).configured} providerConfigured={{ openai: (await getResolvedVisionProviderConfiguration("openai")).configured, anthropic: (await getResolvedVisionProviderConfiguration("anthropic")).configured, ollama: (await getResolvedVisionProviderConfiguration("ollama")).configured }} providerModels={{ openai: (await getResolvedVisionProviderConfiguration("openai")).model, anthropic: (await getResolvedVisionProviderConfiguration("anthropic")).model, ollama: (await getResolvedVisionProviderConfiguration("ollama")).model }} recognitionConfigured={getRecognitionConfiguration().configured} canEdit={(session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN)} />
    <div className="flex flex-wrap gap-x-6">
      <Link href="/v2/admin/settings?tab=ai" className="inline-flex min-h-11 items-center text-sm underline">Choose providers per feature, keys, tests and usage (Settings, AI)</Link>
      <Link href="/v2/admin/settings?tab=ollama" className="inline-flex min-h-11 items-center text-sm underline">Set up or test local Ollama</Link>
    </div>
    <PhotoReviewOptOutPanel canEdit={!session.impersonation && (session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN)} />
    <AgreementSection report={await getPhotoReviewAgreement().catch(() => null)} />
    <PropertyPhotoMemoryPanel canEdit={!session.impersonation && (session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN)} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] pb-4">
      <h2 className="text-base font-semibold">Social post composer</h2>
      <EBadge tone={config.configured ? "neutral" : "warning"} soft>{config.configured ? "Configured, not verified" : "Not configured"}</EBadge>
    </div>
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Provider</dt><dd className="mt-1 text-sm font-medium">{config.provider}</dd></div>
      <div className="min-w-0"><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Model</dt><dd className="mt-1 break-words text-sm font-medium [overflow-wrap:anywhere]">{config.model}</dd></div>
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Server configuration</dt><dd className="mt-1 text-sm font-medium">{config.configured ? "Present" : "Missing"}</dd></div>
      <div><dt className="text-sm text-[hsl(var(--e-muted-foreground))]">Provider connection</dt><dd className="mt-1 text-sm font-medium">Not tested</dd></div>
    </dl>
    <div className="flex flex-wrap gap-4 border-t border-[hsl(var(--e-border))] pt-4">
      <a href="/v2/admin/ai" className="inline-flex min-h-11 items-center gap-2 text-sm underline"><RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh status</a>
      <Link href="/v2/admin/growth" className="inline-flex min-h-11 items-center gap-2 text-sm underline">Marketing<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
    </div>
  </div>;
}

/** How often reviewers accepted the AI's photo findings, per model (last 90 days). */
function AgreementSection({ report }: { report: AgreementReport | null }) {
  return <section aria-labelledby="agreement-title" className="min-w-0 space-y-3 rounded-xl border p-5">
    <h2 id="agreement-title" className="text-lg font-semibold">Agreement with inspectors (last 90 days)</h2>
    <p className="text-sm">From reviewers&apos; decisions on AI photo findings: a finding selected in an approved deduction counts as confirmed; one left out, or in dismissed suggestions, does not. This shows how often suggestions were accepted, not the issues the AI missed.</p>
    {!report ? <p role="alert" className="text-sm">The agreement figures could not be read.</p> : report.rows.length === 0 ? <p className="text-sm">No reviewed AI photo findings yet.</p> : <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead><tr className="border-b"><th className="py-2 pr-3">Provider · model</th><th className="py-2 pr-3">Reviews</th><th className="py-2 pr-3">Findings: confirmed / not selected / dismissed</th><th className="py-2 pr-3">Agreement</th><th className="py-2">Photos: cannot tell / not checked</th></tr></thead>
        <tbody>{report.rows.map(row => <tr key={`${row.provider}-${row.model}`} className="border-b align-top">
          <td className="break-words py-2 pr-3 [overflow-wrap:anywhere]">{row.provider} · {row.model}</td>
          <td className="py-2 pr-3">{row.reviews}</td>
          <td className="py-2 pr-3">{row.confirmed} / {row.notSelected} / {row.dismissed}</td>
          <td className="py-2 pr-3">{row.agreement === null ? "No labelled findings" : `${Math.round(row.agreement * 100)}%`}</td>
          <td className="py-2">{row.cannotTell} / {row.notChecked} of {row.photos}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {report && report.skipped ? <p className="text-xs">{report.skipped} reviewed analyses could not be read and are not counted.</p> : null}
  </section>;
}
