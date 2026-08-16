/**
 * D4 — the client's in-portal sign-off on a damage report.
 *
 * Verification of a damage report is deliberately TWO things:
 *   1. the public /verify code, which proves the document is genuine to anyone
 *      holding it (including an insurer who has no portal login);
 *   2. this acknowledgement, which records that the client themselves read and
 *      accepted it.
 *
 * Neither substitutes for the other. A code proves authenticity but says
 * nothing about whether the client agreed; an acknowledgement proves agreement
 * but is only meaningful about a document whose authenticity can be checked.
 *
 * Three rules enforced here:
 *
 * ONLY A RELEASED REPORT CAN BE SIGNED. The gate is the same one the read path
 * uses, expressed in the query — released, non-draft, own property — so a
 * client can never acknowledge something they were not shown, and a report they
 * may not see 404s exactly like one that does not exist.
 *
 * SIGN-OFF IS ONCE. Re-posting does not move the timestamp: "when did the
 * client accept this" must have one answer. A second call is a no-op that
 * returns the existing record rather than an error, so a double-tap on a phone
 * is not a failure.
 *
 * VOIDING CLEARS IT. lib/damage/void.ts nulls the acknowledgement, because a
 * signature belongs to the report the client actually read — not to whatever
 * replaces it.
 */

import { DamageReportStatus } from "@prisma/client";
import { db } from "@/lib/db";

export interface AcknowledgeDamageReportInput {
  reportId: string;
  clientId: string;
  userId: string;
  /** Typed name, kept verbatim — the signatory may not be the account holder. */
  signedName: string;
}

export async function acknowledgeDamageReport(input: AcknowledgeDamageReportInput) {
  const name = input.signedName.trim();
  if (!name) throw new Error("DAMAGE_ACK_NAME_REQUIRED");

  const report = await db.damageReport.findFirst({
    where: {
      id: input.reportId,
      clientVisible: true,
      status: {
        in: [
          DamageReportStatus.SUBMITTED,
          DamageReportStatus.UNDER_REVIEW,
          DamageReportStatus.CLOSED,
        ],
      },
      property: { clientId: input.clientId },
    },
    select: {
      id: true,
      acknowledgedAt: true,
      acknowledgedById: true,
      acknowledgedName: true,
    },
  });
  // Same 404-shaped outcome as the read path: never confirm a report exists to
  // a client who may not see it.
  if (!report) throw new Error("DAMAGE_REPORT_NOT_FOUND");

  // Already signed — return what is on record rather than restamping it.
  if (report.acknowledgedAt) {
    return {
      id: report.id,
      acknowledgedAt: report.acknowledgedAt,
      acknowledgedName: report.acknowledgedName,
      alreadyAcknowledged: true as const,
    };
  }

  const updated = await db.damageReport.update({
    where: { id: report.id },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedById: input.userId,
      acknowledgedName: name,
    },
    select: { id: true, acknowledgedAt: true, acknowledgedName: true },
  });

  return { ...updated, alreadyAcknowledged: false as const };
}
