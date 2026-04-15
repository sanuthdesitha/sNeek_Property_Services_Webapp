import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const ITERATIONS = 100000;
const DIGEST = "sha512";

export async function hash(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function compare(
  password: string,
  hashString: string,
): Promise<boolean> {
  const [salt, storedHash] = hashString.split(":");
  const derivedKey = scryptSync(password, salt, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return timingSafeEqual(derivedKey, Buffer.from(storedHash, "hex"));
}

export function generateTempPassword(length: number = 12): string {
  const chars = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}
