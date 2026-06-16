import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { provisionOrganization } from "@/lib/saas/org";
import { seedPlans } from "@/lib/saas/seed-plans";
import { runAsPlatformAdmin } from "@/lib/saas/tenant-context";
import { DEFAULT_PLAN_KEY, PLANS, type PlanKey } from "@/lib/saas/plans";

export const signupSchema = z.object({
  businessName: z.string().min(2).max(120),
  fullName: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  planKey: z.string().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

export interface SignupResult {
  organizationId: string;
  userId: string;
  slug: string;
  trialEndsAt: Date | null;
}

/**
 * Provision a brand-new tenant workspace from the public signup form:
 *   1. create the owner (ADMIN) user,
 *   2. provision the Organization (30-day trial + TRIALING subscription),
 *   3. link the user to the org and set it as owner.
 *
 * Per-org default seeding (settings, rate card, checklists, templates) is added
 * once the Phase 1b organizationId rollout makes those records per-org; this
 * function is the stable entry point for it.
 *
 * Runs as platform-admin because there is no tenant context during signup.
 */
export async function signupNewWorkspace(input: SignupInput): Promise<SignupResult> {
  const data = signupSchema.parse(input);
  const email = data.email.toLowerCase();
  const planKey: PlanKey = (data.planKey && data.planKey in PLANS ? data.planKey : DEFAULT_PLAN_KEY) as PlanKey;

  await seedPlans();

  return runAsPlatformAdmin(async () => {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new Error("EMAIL_TAKEN");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await db.user.create({
      data: {
        email,
        name: data.fullName,
        role: Role.ADMIN,
        isActive: true,
        passwordHash,
      },
    });

    const org = await provisionOrganization({
      name: data.businessName,
      planKey,
      ownerUserId: user.id,
    });

    await db.user.update({ where: { id: user.id }, data: { organizationId: org.id } });

    return {
      organizationId: org.id,
      userId: user.id,
      slug: org.slug,
      trialEndsAt: org.trialEndsAt,
    };
  });
}
