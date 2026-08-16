// Public report verification.
//
// Every generated report carries a crypto-random code; anyone holding the code
// (or scanning the QR on the report) can confirm at /verify/[code] that the
// clean happened, when, and by whom — WITHOUT seeing the internal report. The
// public view model here is deliberately minimal and built from a dedicated
// query: property suburb, date, job type, cleaner FIRST names, clock times and
// status only. Never reuse the internal report view model for this — it
// carries pay, notes, scores, client contacts and full addresses.

import { randomBytes } from "crypto";
import { ReportVerificationKind } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtSydney, summarizeTimeLogs } from "@/lib/reports/report-view-model";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatVerificationCode,
  normalizeVerificationCode,
} from "@/lib/reports/verification-code";

export { CODE_LENGTH, formatVerificationCode, normalizeVerificationCode };

export function generateVerificationCode(): string {
  // 256 % 32 === 0, so byte % 32 introduces no modulo bias.
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Get or create the CLEANING verification code for a job (one per job, stable). */
export async function ensureReportVerification(jobId: string): Promise<{ code: string }> {
  const existing = await db.reportVerification.findUnique({
    where: { jobId_kind: { jobId, kind: ReportVerificationKind.CLEANING } },
    select: { code: true },
  });
  if (existing) return existing;

  // Retry on the (astronomically unlikely) code collision; the (jobId, kind)
  // unique also races benignly if two generations run at once — take the
  // winner's row.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.reportVerification.create({
        data: { jobId, kind: ReportVerificationKind.CLEANING, code: generateVerificationCode() },
        select: { code: true },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const winner = await db.reportVerification.findUnique({
          where: { jobId_kind: { jobId, kind: ReportVerificationKind.CLEANING } },
          select: { code: true },
        });
        if (winner) return winner;
        continue; // code collision — try a fresh code
      }
      throw err;
    }
  }
  throw new Error("Could not allocate a report verification code.");
}

/**
 * Get or create the DAMAGE verification code for one damage report.
 *
 * Separate from the job's cleaning code on purpose: a client holding a damage
 * PDF is verifying THAT document, and a job can produce several damage reports
 * over its life. DAMAGE rows leave `jobId` NULL — the damage report already
 * carries the job — so they never contend for the one-per-job cleaning slot.
 */
export async function ensureDamageReportVerification(
  damageReportId: string
): Promise<{ code: string }> {
  const existing = await db.reportVerification.findUnique({
    where: { damageReportId },
    select: { code: true },
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.reportVerification.create({
        data: {
          damageReportId,
          kind: ReportVerificationKind.DAMAGE,
          code: generateVerificationCode(),
        },
        select: { code: true },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const winner = await db.reportVerification.findUnique({
          where: { damageReportId },
          select: { code: true },
        });
        if (winner) return winner;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Could not allocate a damage report verification code.");
}

export type PublicVerificationVM = {
  /** Which document this code proves. Drives the wording on the public page. */
  kind: "CLEANING" | "DAMAGE";
  status: "verified" | "revoked";
  suburb: string;
  dateLabel: string;
  jobTypeLabel: string;
  cleanerFirstNames: string[];
  clockInLabel: string | null;
  clockOutLabel: string | null;
  clockOutMissing: boolean;
  issuedLabel: string | null;
  /**
   * DAMAGE only — how many damaged items the report records. A count is safe
   * for a stranger; the descriptions, photos, severities and costs are not, so
   * none of them appear here.
   */
  damageItemCount?: number;
};

/**
 * Pure mapping from a verification row (+ its minimal job selection) to the
 * PUBLIC view model. Everything shown on the public page flows through here —
 * add a field only if it is safe for a complete stranger to read.
 */
export function buildPublicVerificationVm(row: {
  createdAt: Date;
  revokedAt: Date | null;
  job: {
    jobType: string;
    scheduledDate: Date;
    property: { suburb: string | null } | null;
    assignments: Array<{ user: { name: string | null } | null }>;
    timeLogs: Array<{ startedAt: Date; stoppedAt: Date | null; durationM: number | null }>;
  };
}): PublicVerificationVM {
  const clock = summarizeTimeLogs(row.job.timeLogs);
  return {
    kind: "CLEANING",
    status: row.revokedAt ? "revoked" : "verified",
    suburb: String(row.job.property?.suburb ?? ""),
    dateLabel: fmtSydney(row.job.scheduledDate, "d MMMM yyyy") ?? "",
    jobTypeLabel: String(row.job.jobType ?? "").replace(/_/g, " "),
    cleanerFirstNames: row.job.assignments
      .map((a) => String(a.user?.name ?? "").trim().split(/\s+/)[0])
      .filter(Boolean),
    clockInLabel: fmtSydney(clock.clockIn, "d MMM yyyy, h:mm aaa"),
    clockOutLabel: fmtSydney(clock.clockOut, "d MMM yyyy, h:mm aaa"),
    clockOutMissing: clock.clockOutMissing,
    issuedLabel: fmtSydney(row.createdAt, "d MMM yyyy"),
  };
}

/**
 * Resolve a raw user-supplied code to the public VM. Returns null for unknown
 * or malformed codes (the page renders both identically, so responses do not
 * leak which codes exist).
 */
/**
 * Pure mapping for a DAMAGE code.
 *
 * Even more restrained than the cleaning VM: a damage report describes faults in
 * somebody's home, so the public page confirms only that a report exists, for
 * which suburb and date, and how many items it covers. No descriptions, photos,
 * severities, causes or costs — a code can be forwarded to anyone.
 */
export function buildDamageVerificationVm(row: {
  createdAt: Date;
  revokedAt: Date | null;
  damageReport: {
    submittedAt: Date | null;
    reportedBy: { name: string | null } | null;
    property: { suburb: string | null } | null;
    _count: { items: number };
  };
}): PublicVerificationVM {
  return {
    kind: "DAMAGE",
    status: row.revokedAt ? "revoked" : "verified",
    suburb: String(row.damageReport.property?.suburb ?? ""),
    dateLabel: fmtSydney(row.damageReport.submittedAt, "d MMMM yyyy") ?? "",
    jobTypeLabel: "Damage report",
    cleanerFirstNames: [String(row.damageReport.reportedBy?.name ?? "").trim().split(/\s+/)[0]]
      .filter(Boolean),
    clockInLabel: null,
    clockOutLabel: null,
    clockOutMissing: false,
    issuedLabel: fmtSydney(row.createdAt, "d MMM yyyy"),
    damageItemCount: row.damageReport._count.items,
  };
}

export async function lookupVerificationByCode(raw: string): Promise<PublicVerificationVM | null> {
  const code = normalizeVerificationCode(raw);
  if (!code) return null;

  const row = await db.reportVerification.findUnique({
    where: { code },
    select: {
      createdAt: true,
      revokedAt: true,
      kind: true,
      damageReport: {
        select: {
          submittedAt: true,
          reportedBy: { select: { name: true } },
          property: { select: { suburb: true } },
          _count: { select: { items: true } },
        },
      },
      job: {
        select: {
          jobType: true,
          scheduledDate: true,
          property: { select: { suburb: true } },
          assignments: {
            where: { removedAt: null },
            select: { user: { select: { name: true } } },
          },
          timeLogs: {
            orderBy: { startedAt: "asc" },
            select: { startedAt: true, stoppedAt: true, durationM: true },
          },
        },
      },
    },
  });
  if (!row) return null;

  if (row.kind === ReportVerificationKind.DAMAGE) {
    // A DAMAGE row with no damage report left (cascade-deleted) is treated as
    // unknown rather than half-rendered.
    if (!row.damageReport) return null;
    return buildDamageVerificationVm({
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      damageReport: row.damageReport,
    });
  }

  if (!row.job) return null;
  return buildPublicVerificationVm({
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    job: row.job,
  });
}
