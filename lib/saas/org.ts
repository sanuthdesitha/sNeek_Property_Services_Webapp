import "server-only";
import { db } from "@/lib/db";
import { OrgStatus, SubscriptionStatus } from "@prisma/client";
import { DEFAULT_PLAN_KEY, getPlan, type PlanKey } from "@/lib/saas/plans";
import { runAsPlatformAdmin } from "@/lib/saas/tenant-context";

/** URL-safe workspace handle from a business name. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      // Drop diacritic marks, then keep only ascii alphanumerics.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

/** A slug not already taken by another organization. */
export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  // Org creation runs without a tenant context; bypass scoping for the lookup.
  return runAsPlatformAdmin(async () => {
    let candidate = base;
    let n = 1;
    // Bounded probing; collisions are rare for real business names.
    while (await db.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  });
}

export function computeTrialEnd(now: Date, planKey: string): Date {
  const days = getPlan(planKey).trialDays;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface ProvisionOrgInput {
  name: string;
  planKey?: PlanKey;
  ownerUserId?: string | null;
  now?: Date;
}

/**
 * Create a new tenant workspace in its 30-day trial, with a mirrored TRIALING
 * Subscription row. No Stripe customer yet (card-not-required trial). Seeding of
 * per-org defaults (settings, rate card, checklists, templates) happens in the
 * signup flow (Phase 1c) once the organizationId rollout makes those per-org.
 */
export async function provisionOrganization(input: ProvisionOrgInput) {
  const now = input.now ?? new Date();
  const planKey = input.planKey ?? DEFAULT_PLAN_KEY;
  const slug = await generateUniqueSlug(input.name);
  const trialEndsAt = computeTrialEnd(now, planKey);

  return runAsPlatformAdmin(async () =>
    db.organization.create({
      data: {
        name: input.name,
        slug,
        status: OrgStatus.TRIALING,
        planKey,
        trialEndsAt,
        ownerUserId: input.ownerUserId ?? null,
        subscription: {
          create: {
            planKey,
            status: SubscriptionStatus.TRIALING,
          },
        },
      },
      include: { subscription: true },
    })
  );
}
