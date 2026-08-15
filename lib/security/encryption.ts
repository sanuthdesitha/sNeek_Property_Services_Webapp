import crypto from "crypto";

/**
 * At-rest encryption for the property access secrets (door codes, alarm codes).
 *
 * Format: `enc:v1:<ivHex>:<cipherHex>`, AES-256-CBC with a random 16-byte IV,
 * keyed by SHA-256 of ENCRYPTION_KEY.
 *
 * WRITE refuses without a key; READ tolerates its absence. That asymmetry is
 * deliberate and is the whole point of this module's failure mode:
 *
 *   - encryptSecret() used to fall back to returning the PLAINTEXT when
 *     ENCRYPTION_KEY was unset. Since the key had never been set in any
 *     environment, every door code and alarm code was written to the database
 *     in the clear while the call site read as if it were encrypting. Refusing
 *     to write is the only safe failure mode — the same stance
 *     lib/auth/impersonation.ts takes when NEXTAUTH_SECRET is missing.
 *   - decryptSecret() stays tolerant so the rows written during that period
 *     still read correctly. A value without the prefix is already plaintext and
 *     is passed straight through, so readers keep working before and during the
 *     re-encryption backfill
 *     (scripts/backfill/backfill-encrypt-access-codes.ts).
 *
 * DEPLOYMENT ORDER MATTERS: ENCRYPTION_KEY must exist in the environment before
 * this code runs, or every property create/update that carries a code will 500.
 */

const PREFIX = "enc:v1:";

function getKey() {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

/** The key, or a thrown error. Write path only — never call this from a read. */
function requireKey() {
  const key = getKey();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is required to store an encrypted secret. Refusing to write a property access code in plaintext."
    );
  }
  return key;
}

export function encryptSecret(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  // Nothing to protect, so an absent key is not an error on this path.
  if (!trimmed) return null;

  const key = requireKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const key = getKey();
  // Legacy plaintext, or no key to try with: hand back what we were given.
  if (!value.startsWith(PREFIX) || !key) {
    return value;
  }

  const payload = value.slice(PREFIX.length);
  const [ivHex, encryptedHex] = payload.split(":");
  if (!ivHex || !encryptedHex) return null;

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      key,
      Buffer.from(ivHex, "hex")
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Whether a stored value is already in the current encrypted format.
 * The backfill uses this to stay idempotent; call sites should not branch on it.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
