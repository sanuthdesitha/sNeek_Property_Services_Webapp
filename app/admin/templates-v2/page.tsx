import Link from "next/link";
import { Role, TemplateVersionStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { getTemplateEngineFlags } from "@/lib/templates/flags";
import { FlagToggle } from "@/components/admin/templates-v2/flag-toggle";

export const metadata = { title: "Template studio (v2)" };
export const dynamic = "force-dynamic";

/**
 * Template engine v2 pilot studio (rebrand doc 03 §5.1 phase 2).
 * Lists the pilot kinds; each opens the block editor. Entry points move
 * in-domain (Finance/Notifications) once the pilots prove out.
 */
export default async function TemplatesV2Page() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const definitions = await db.templateDefinition.findMany({
    where: { scope: "SYSTEM" },
    select: {
      kind: true,
      publishedVersionId: true,
      publishedVersion: { select: { version: true, publishedAt: true } },
      versions: {
        where: { status: TemplateVersionStatus.DRAFT },
        select: { id: true },
        take: 1,
      },
    },
  });
  const byKind = new Map(definitions.map((definition) => [definition.kind, definition]));
  const flags = await getTemplateEngineFlags();

  const families: Record<string, string> = {
    email: "Email",
    document: "Document (PDF)",
    sms: "SMS",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
          Template engine v2 · pilot
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Template studio</h1>
        <p className="mt-1 text-sm text-slate-500">
          Block-based templates with versioned drafts and publish lint. Pilot kinds only — the
          legacy templates keep working untouched until each kind is flipped.
        </p>
      </header>

      <div className="space-y-3">
        {Object.values(TEMPLATE_KINDS).map((config) => {
          const definition = byKind.get(config.kind);
          const published = definition?.publishedVersion;
          return (
            <div
              key={config.kind}
              className="relative flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-emerald-600"
            >
              {/* Stretched link: the whole row navigates, except the toggle (z-10). */}
              <Link
                href={`/admin/templates-v2/${encodeURIComponent(config.kind)}`}
                className="absolute inset-0 rounded-lg"
                aria-label={`Edit ${config.label}`}
              />
              <div>
                <p className="text-[15px] font-medium text-slate-900">{config.label}</p>
                <p className="text-[12px] text-slate-500">
                  {families[config.family]} · {config.kind}
                </p>
              </div>
              <div className="relative z-10 flex items-center gap-3">
                <div className="text-right text-[12px]">
                  {published ? (
                    <span className="font-medium text-emerald-700">v{published.version} published</span>
                  ) : (
                    <span className="text-slate-400">Not published</span>
                  )}
                  {(definition?.versions.length ?? 0) > 0 ? (
                    <p className="text-amber-600">draft in progress</p>
                  ) : null}
                </div>
                <FlagToggle
                  kind={config.kind}
                  initialEnabled={flags.kinds[config.kind] === true}
                  disabled={!published}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
