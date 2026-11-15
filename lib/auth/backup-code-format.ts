/**
 * Two-step backup codes: the shape people see and type (PURE, plain module,
 * safe for the browser and for tests).
 *
 * A code is ten characters from a 31-character alphabet with nothing that is
 * easy to misread (no 0/O, 1/I/L), shown as two groups of five:
 * "K7MPQ-3XRWD". 31^10 ≈ 8 × 10^14 (about 49 bits) per code; with the shared
 * two-step lockout (8 wrong answers lock for 15 minutes) guessing is hopeless.
 *
 * Typing is forgiving: case, spaces and dashes do not matter.
 *
 * Generation takes the random source as an argument (the server passes
 * crypto.randomInt) so this module stays free of Node imports.
 */

type RandomIndex = (max: number) => number;
export const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const BACKUP_CODE_LENGTH = 10;
export const BACKUP_CODE_COUNT = 10;
/** At or below this many unused codes, sign-in and the profile suggest a new set. */
export const BACKUP_CODES_LOW = 3;

/** What the sign-in screen shows after a backup code worked (never the code). */
export type BackupCodeSignInOutcome = {
  remaining: number;
  makeNewSuggested: boolean;
  /** Where the person makes a new set on its own; null when only switching method or turning two-step off and on does. */
  newCodesPath: string | null;
  /** Where the person's two-step settings are. */
  settingsPath: string;
};

/** One new code, formatted for display ("ABCDE-FGHJK"). */
export function generateBackupCode(random: RandomIndex): string {
  let raw = "";
  for (let index = 0; index < BACKUP_CODE_LENGTH; index++) {
    raw += BACKUP_CODE_ALPHABET[random(BACKUP_CODE_ALPHABET.length)];
  }
  return formatBackupCode(raw);
}

/** A full set of distinct codes. */
export function generateBackupCodeSet(random: RandomIndex, count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateBackupCode(random));
  return Array.from(codes);
}

export function formatBackupCode(raw: string): string {
  const half = Math.floor(raw.length / 2);
  return `${raw.slice(0, half)}-${raw.slice(half)}`;
}

/** What a typed code is compared as: upper case, letters and digits only. */
export function normalizeBackupCodeInput(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Could this input be a backup code (a new one, or one of the older hex
 * codes "a1b2c-3d4e5")? A 6-digit authenticator or email code never is.
 */
export function looksLikeBackupCode(input: string): boolean {
  return normalizeBackupCodeInput(input).length === BACKUP_CODE_LENGTH;
}

/** The plain-text file people download or print (no HTML). */
export function backupCodesText(input: { codes: readonly string[]; accountEmail: string | null; createdLabel: string; companyName?: string }): string {
  const lines = [
    `${input.companyName ?? "sNeek"} two-step sign-in backup codes`,
    input.accountEmail ? `Account: ${input.accountEmail}` : null,
    `Made: ${input.createdLabel}`,
    "",
    "Each code works once. Making new codes cancels these.",
    "",
    ...input.codes.map((code, index) => `${String(index + 1).padStart(2, " ")}. ${code}`),
    "",
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}
