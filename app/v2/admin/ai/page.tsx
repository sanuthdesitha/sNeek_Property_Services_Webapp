import Link from "next/link";
import { Role } from "@prisma/client";
import { ArrowRight, RefreshCw } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getAiConfiguration, getVisionProviderConfiguration } from "@/lib/ai/config";
import { getVisionSettings } from "@/lib/ai/vision-settings";
import { VisionSettingsPanel } from "@/components/v2/admin/vision-settings";
import { getRecognitionConfiguration } from "@/lib/ai/property-photo-model";
import { PropertyPhotoMemoryPanel } from "@/components/v2/admin/property-photo-memory";
import { EBadge, EPageHeader } from "@/components/v2/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI configuration | Estate admin" };

export default async function AiConfigurationPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const config = getAiConfiguration();
  const visionSettings = await getVisionSettings();
  return <div className="space-y-6">
    <EPageHeader eyebrow="Configuration" title="AI configuration" />
    <VisionSettingsPanel initialSettings={visionSettings} configured={getVisionProviderConfiguration(visionSettings.provider).configured} providerConfigured={{ openai: getVisionProviderConfiguration("openai").configured, anthropic: getVisionProviderConfiguration("anthropic").configured, ollama: getVisionProviderConfiguration("ollama").configured }} providerModels={{ openai: getVisionProviderConfiguration("openai").model, anthropic: getVisionProviderConfiguration("anthropic").model, ollama: getVisionProviderConfiguration("ollama").model }} recognitionConfigured={getRecognitionConfiguration().configured} canEdit={(session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN)} />
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
