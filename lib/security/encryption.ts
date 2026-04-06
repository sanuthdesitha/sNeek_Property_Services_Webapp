import crypto from "crypto";

const PREFIX = "enc:v1:";

function getKey() {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  const key = getKey();
  if (!key) return trimmed;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const key = getKey();
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
