import { db } from "@/lib/db";

interface AbaPayout {
  bsb: string;
  accountNumber: string;
  accountName: string;
  amount: number; // in cents
  reference: string;
}

/**
 * Generate an ABA file (Australian Banking Association format) for batch payments.
 * Compatible with all major Australian banks (CommBank, NAB, Westpac, ANZ, etc.).
 *
 * ABA file format:
 * - Descriptive record (header) - 1 record
 * - Detail records - one per payment
 * - File total record (footer) - 1 record
 * - Each record is exactly 120 characters
 */
export async function generateAbaFile(runId: string): Promise<{ content: string; filename: string }> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { payouts: true, createdBy: true },
  });

  if (!run) throw new Error("Payroll run not found");
  if (run.status !== "CONFIRMED" && run.status !== "PROCESSING" && run.status !== "COMPLETED" && run.status !== "FAILED") {
    throw new Error("Run must be confirmed before generating ABA file");
  }

  // Get payouts that need ABA processing (ABA_FILE or MANUAL_BANK_TRANSFER method)
  const abaPayouts = run.payouts.filter(
    (p) =>
      (p.method === "ABA_FILE" || p.method === "MANUAL_BANK_TRANSFER") &&
      p.bankBsb &&
      p.bankAccountNumber
  );

  if (abaPayouts.length === 0) {
    throw new Error("No payouts with bank details available for ABA file generation");
  }

  // Fetch cleaner names for payouts
  const cleanerIds = abaPayouts.map((p) => p.cleanerId);
  const cleaners = await db.user.findMany({
    where: { id: { in: cleanerIds } },
    select: { id: true, name: true, bankAccountName: true },
  });
  const cleanerMap = new Map(cleaners.map((c) => [c.id, c.bankAccountName || c.name || "sNeek Cleaner"]));

  const payoutData: AbaPayout[] = abaPayouts.map((p) => ({
    bsb: normalizeBsb(p.bankBsb!),
    accountNumber: normalizeAccountNumber(p.bankAccountNumber!),
    accountName: normalizeAccountName(cleanerMap.get(p.cleanerId) || "sNeek Cleaner"),
    amount: Math.round(p.amount * 100),
    reference: `PAYROLL-${run.id.slice(-6)}`,
  }));

  const lines: string[] = [];

  // ── Descriptive Record (Header) ──
  lines.push(buildDescriptiveRecord());

  // ── Detail Records ──
  for (const payout of payoutData) {
    lines.push(buildDetailRecord(payout));
  }

  // ── File Total Record (Footer) ──
  const totalAmount = payoutData.reduce((sum, p) => sum + p.amount, 0);
  lines.push(buildFileTotalRecord(payoutData.length, totalAmount));

  const content = lines.join("\r\n") + "\r\n";
  const periodStart = run.periodStart.toISOString().slice(0, 10);
  const periodEnd = run.periodEnd.toISOString().slice(0, 10);
  const filename = `ABA-sNeekOps-${periodStart}-to-${periodEnd}.aba`;

  return { content, filename };
}

function normalizeBsb(bsb: string): string {
  const cleaned = bsb.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(cleaned)) throw new Error(`Invalid BSB format: ${bsb}. Expected 6 digits.`);
  return cleaned;
}

function normalizeAccountNumber(account: string): string {
  const cleaned = account.replace(/[\s-]/g, "");
  if (cleaned.length < 4 || cleaned.length > 9 || !/^\d+$/.test(cleaned)) {
    throw new Error(`Invalid account number format: ${account}`);
  }
  return cleaned.padStart(9, "0");
}

function normalizeAccountName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\s'-]/g, "").slice(0, 32).padEnd(32, " ");
}

/**
 * Descriptive Record (Type 0) - 120 characters
 * Positions:
 *  0: Record type = '0'
 *  1-3: Reel sequence = '000' (standard)
 *  4-13: Financial institution (blank padded)
 * 14-15: User/processor number (blank padded)
 * 16-27: User/processor name (blank padded)
 * 28-39: Description (blank padded)
 * 40-49: Date of processing (DDMMYYYY or blank)
 * 50-119: Reserved (blank padded)
 */
function buildDescriptiveRecord(): string {
  const record = new Array(120).fill(" ");
  record[0] = "0"; // Record type
  record.fill("0", 1, 4); // Reel sequence
  const name = "SNEEK OPS";
  for (let i = 0; i < name.length && i < 26; i++) {
    record[14 + i] = name[i];
  }
  const desc = "PAYROLL";
  for (let i = 0; i < desc.length && i < 12; i++) {
    record[28 + i] = desc[i];
  }
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}${today.getFullYear()}`;
  for (let i = 0; i < 8; i++) {
    record[40 + i] = dateStr[i];
  }
  return record.join("");
}

/**
 * Detail Record (Type 1) - 120 characters per payment
 * Positions:
 *  0: Record type = '1'
 *  1-6: BSB number
 *  7-15: Account number (9 digits, zero-padded)
 * 16-47: Account name (32 chars)
 * 48-57: Amount in cents (10 digits, zero-padded)
 * 58-89: Lodgement reference (32 chars)
 * 90-119: Trace BSB + account (30 chars, optional)
 */
function buildDetailRecord(payout: AbaPayout): string {
  const record = new Array(120).fill(" ");
  record[0] = "1"; // Record type

  // BSB (positions 1-6)
  for (let i = 0; i < 6; i++) {
    record[1 + i] = payout.bsb[i] || " ";
  }

  // Account number (positions 7-15)
  const acct = payout.accountNumber.padStart(9, "0");
  for (let i = 0; i < 9; i++) {
    record[7 + i] = acct[i];
  }

  // Account name (positions 16-47)
  const name = payout.accountName;
  for (let i = 0; i < 32; i++) {
    record[16 + i] = name[i] || " ";
  }

  // Amount in cents (positions 48-57)
  const amountStr = String(payout.amount).padStart(10, "0");
  for (let i = 0; i < 10; i++) {
    record[48 + i] = amountStr[i];
  }

  // Reference (positions 58-89)
  const ref = payout.reference.slice(0, 32);
  for (let i = 0; i < 32; i++) {
    record[58 + i] = ref[i] || " ";
  }

  // Trace (positions 90-119) - blank
  for (let i = 90; i < 120; i++) {
    record[i] = " ";
  }

  return record.join("");
}

/**
 * File Total Record (Type 7) - 120 characters
 * Positions:
 *  0: Record type = '7'
 *  1-6: BSB (blank padded)
 *  7-17: Total debit count (zero-padded)
 * 18-29: Total debit amount in cents (zero-padded)
 * 30-39: Net position BSB (blank)
 * 40-51: Net position amount (blank)
 * 52-119: Reserved (blank)
 */
function buildFileTotalRecord(count: number, totalAmount: number): string {
  const record = new Array(120).fill(" ");
  record[0] = "7"; // Record type

  // BSB (blank)
  for (let i = 1; i < 7; i++) record[i] = " ";

  // Count (positions 7-17)
  const countStr = String(count).padStart(11, "0");
  for (let i = 0; i < 11; i++) {
    record[7 + i] = countStr[i];
  }

  // Total amount in cents (positions 18-29)
  const amountStr = String(totalAmount).padStart(12, "0");
  for (let i = 0; i < 12; i++) {
    record[18 + i] = amountStr[i];
  }

  // Rest blank
  for (let i = 30; i < 120; i++) record[i] = " ";

  return record.join("");
}
