import type { Role } from "@prisma/client";

/**
 * The roles a staff message may address (STAFF_MEMBER recipient scope). Kept
 * free of server imports so the Accounts screen can show, before sending,
 * who the server will skip.
 */
export const STAFF_MESSAGE_ROLES: readonly Role[] = ["CLEANER", "LAUNDRY", "MAINTENANCE", "QA_INSPECTOR", "OPS_MANAGER", "ADMIN"];
