import crypto from "crypto";
import { db } from "@/lib/db";

const DEFAULT_POINTS_PER_DOLLAR = 10;
const DEFAULT_REFERRAL_POINTS = 500;

function buildReferralCode(name: string) {
  const prefix = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6) || "SNEEK";
  return `${prefix}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

export async function getClientRewardsSummary(clientId: string) {
  const [account, referrals] = await Promise.all([
    db.loyaltyAccount.findUnique({
      where: { clientId },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    }),
    db.referral.findMany({
      where: { referrerId: clientId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    account,
    referrals,
    summary: {
      points: account?.points ?? 0,
      creditValue: Number(((account?.points ?? 0) / 100).toFixed(2)),
      convertedReferrals: referrals.filter((row) => row.status === "converted").length,
      pendingReferrals: referrals.filter((row) => row.status === "pending").length,
    },
  };
}

export async function createReferralInvite(input: {
  clientId: string;
  clientName: string;
  refereeEmail: string;
}) {
  const code = buildReferralCode(input.clientName);
  return db.referral.create({
    data: {
      referrerId: input.clientId,
      refereeEmail: input.refereeEmail.trim().toLowerCase(),
      code,
      status: "pending",
      referrerRewardPoints: DEFAULT_REFERRAL_POINTS,
      refereeDiscountPercent: 10,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
}

export async function awardLoyaltyForCompletedJob(jobId: string) {
  const existing = await db.loyaltyTransaction.findFirst({
    where: {
      referenceId: jobId,
      reason: "Job completed",
    },
    select: { id: true },
  });
  if (existing) return { awarded: false, points: 0 };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      propertyId: true,
      property: {
        select: {
          clientId: true,
        },
      },
      invoiceLines: {
        select: {
          lineTotal: true,
          invoice: {
            select: {
              totalAmount: true,
            },
          },
        },
      },
    },
  });
  const clientId = job?.property?.clientId ?? null;
  if (!job?.id || !clientId) return { awarded: false, points: 0 };

  const invoiceTotal =
    job.invoiceLines.reduce((sum, row) => sum + Number(row.lineTotal ?? 0), 0) ||
    job.invoiceLines[0]?.invoice?.totalAmount ||
    0;
  const points = Math.max(0, Math.floor(Number(invoiceTotal) * DEFAULT_POINTS_PER_DOLLAR));
  if (points <= 0) return { awarded: false, points: 0 };

  const account = await db.loyaltyAccount.upsert({
    where: { clientId },
    create: {
      clientId,
      points,
    },
    update: {
      points: { increment: points },
    },
  });

  await db.loyaltyTransaction.create({
    data: {
      accountId: account.id,
      points,
      reason: "Job completed",
      referenceId: job.id,
    },
  });

  return { awarded: true, points };
}
