import { getMarketingCampaigns, type MarketingCampaignRecord } from "@/lib/marketing/store";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";

export type CampaignValidationResult =
  | {
      valid: true;
      campaign: {
        id: string;
        code: string;
        title: string;
        description: string | null;
        discountType: string;
        discountValue: number;
        minSubtotal: number | null;
        jobTypes: MarketedJobTypeValue[] | null;
        startsAt: string | null;
        endsAt: string | null;
      };
    }
  | { valid: false; reason: string };

function normalizeCampaign(campaign: MarketingCampaignRecord) {
  return {
    id: campaign.id,
    code: campaign.code,
    title: campaign.title,
    description: campaign.description,
    discountType: campaign.discountType,
    discountValue: campaign.discountValue,
    minSubtotal: campaign.minSubtotal,
    jobTypes: campaign.jobTypes,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
  };
}

export async function validateDiscountCampaign(
  code: string,
  jobType?: MarketedJobTypeValue,
  subtotal?: number
): Promise<CampaignValidationResult> {
  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) {
    return { valid: false, reason: "Campaign code is required." };
  }

  const campaigns = await getMarketingCampaigns();
  const campaign = campaigns.find((row) => row.code.trim().toUpperCase() === trimmedCode) ?? null;
  if (!campaign) return { valid: false, reason: "Campaign code was not found." };
  if (!campaign.isActive) return { valid: false, reason: "Campaign is not active." };

  const now = Date.now();
  const startsAt = campaign.startsAt ? new Date(campaign.startsAt).getTime() : null;
  const endsAt = campaign.endsAt ? new Date(campaign.endsAt).getTime() : null;

  if (startsAt && Number.isFinite(startsAt) && startsAt > now) {
    return { valid: false, reason: "Campaign has not started yet." };
  }
  if (endsAt && Number.isFinite(endsAt) && endsAt < now) {
    return { valid: false, reason: "Campaign has expired." };
  }
  if (typeof campaign.usageLimit === "number" && campaign.usageCount >= campaign.usageLimit) {
    return { valid: false, reason: "Campaign has reached its usage limit." };
  }
  if (jobType && campaign.jobTypes && !campaign.jobTypes.includes(jobType)) {
    return { valid: false, reason: "Campaign does not apply to this service." };
  }
  if (typeof subtotal === "number" && typeof campaign.minSubtotal === "number" && subtotal < campaign.minSubtotal) {
    return { valid: false, reason: `Campaign applies to quotes above $${campaign.minSubtotal.toFixed(0)}.` };
  }

  return { valid: true, campaign: normalizeCampaign(campaign) };
}

export function applyCampaignDiscount(subtotal: number, campaign: { discountType: string; discountValue: number }) {
  if (campaign.discountType === "FIXED") {
    return Math.min(subtotal, Math.max(0, campaign.discountValue));
  }

  const percent = Math.max(0, Math.min(100, campaign.discountValue));
  return Number(((subtotal * percent) / 100).toFixed(2));
}
