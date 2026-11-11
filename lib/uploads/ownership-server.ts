import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { uploadKeyOwnerId } from "./ownership";

/** Office staff may attach files on a field worker's behalf. */
const OFFICE_ROLES: Role[] = [Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR, Role.VA];

export type UploadOwnershipInput = {
  keys: readonly unknown[];
  /** The signed-in person submitting the keys. */
  callerId: string;
  /** When set, anyone ever assigned to this job also counts as an owner. */
  jobId?: string;
  /** Keys already stored on the record being edited; resending them is not a new claim. */
  knownKeys?: readonly string[];
  /**
   * Let through keys that name no uploader at all (fewer than three path
   * segments). Nothing the upload routes store has that shape, so such a key
   * cannot be another person's upload; the cleaner submit route validates
   * those through its own evidence receipts.
   */
  allowUnowned?: boolean;
};

/**
 * Returns the submitted keys that were not uploaded by the caller, by a
 * cleaner assigned to the same job, or by office staff. An empty array means
 * every key is acceptable. Keys that do not have the upload-route layout are
 * returned as foreign unless `allowUnowned` is set: an unreadable owner is
 * never treated as the caller.
 */
/** A short, well-formed key with no uploader segment. */
function isPlainUnownedKey(key: string): boolean {
  return key.length <= 1000 && !/[\\\u0000-\u0020\u007f]/.test(key) && !key.split("/").some((part) => !part || part === "." || part === "..") && key.split("/").length < 3;
}

export async function findForeignUploadKeys(input: UploadOwnershipInput): Promise<string[]> {
  const known = new Set(input.knownKeys ?? []);
  const pending = new Map<string, string | null>();
  for (const raw of input.keys) {
    if (typeof raw !== "string" || !raw || known.has(raw)) continue;
    const owner = uploadKeyOwnerId(raw);
    if (owner === null && input.allowUnowned && isPlainUnownedKey(raw)) continue;
    pending.set(raw, owner);
  }
  if (pending.size === 0) return [];

  const allowed = new Set<string>([input.callerId]);
  const others = new Set<string>();
  pending.forEach((owner) => {
    if (owner && !allowed.has(owner)) others.add(owner);
  });

  if (others.size > 0 && input.jobId) {
    const assigned = await db.jobAssignment.findMany({
      where: { jobId: input.jobId, userId: { in: Array.from(others) } },
      select: { userId: true },
    });
    for (const row of assigned) {
      allowed.add(row.userId);
      others.delete(row.userId);
    }
  }
  if (others.size > 0) {
    const office = await db.user.findMany({
      where: { id: { in: Array.from(others) }, role: { in: OFFICE_ROLES } },
      select: { id: true },
    });
    for (const row of office) allowed.add(row.id);
  }

  const foreign: string[] = [];
  pending.forEach((owner, key) => {
    if (!owner || !allowed.has(owner)) foreign.push(key);
  });
  return foreign;
}
