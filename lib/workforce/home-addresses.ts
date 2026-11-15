import "server-only";
/**
 * Cleaner home addresses page data (ADMIN only; the page and the notice route
 * check the role first). Reads the minimal address fields of active cleaners
 * and turns them into table rows and SUBURB-LEVEL pins. The stored map position
 * is read to classify the row and is never put into the result.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { suburbCentres } from "@/lib/maps/suburb-centre";
import { pinInitials } from "@/components/v2/admin/ops/ops-map-pins";
import {
  HOME_ADDRESS_FLAG, TRANSPORT_WORDS, homeAddressPinPlacement, homeAddressStatus, needsAttention, onTheMapWords,
  type HomeAddressStatus,
} from "./home-address-rules";

export type HomeAddressRow = {
  id: string;
  name: string;
  /** Street address as recorded (shown in the table only), or null for "Not recorded". */
  address: string | null;
  suburb: string | null;
  status: HomeAddressStatus;
  /** The written reason in the name cell, or null for a placed address. */
  flag: string | null;
  onTheMap: string;
  transport: string;
  accountHref: string;
};

/** A pin at suburb level. Carries no street address and no stored position. */
export type HomeAddressPin = {
  cleanerId: string;
  initials: string;
  name: string;
  suburb: string;
  lat: number;
  lng: number;
  suburbOnly: boolean;
  basis: "suburb_centre" | "area_square";
};

export type HomeAddressesView = {
  rows: HomeAddressRow[];
  pins: HomeAddressPin[];
  counts: { active: number; placed: number; noAddress: number; suburbOnly: number; notFound: number; attention: number };
};

export const HOME_ADDRESS_SELECT = { id: true, name: true, email: true, address: true, suburb: true, latitude: true, longitude: true, preferredTransport: true } as const;

export async function activeCleanerAddresses() {
  return db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: HOME_ADDRESS_SELECT,
    orderBy: [{ suburb: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

export async function loadHomeAddresses(): Promise<HomeAddressesView> {
  const [cleaners, properties] = await Promise.all([
    activeCleanerAddresses(),
    db.property.findMany({ where: { isActive: true, latitude: { not: null }, longitude: { not: null } }, select: { suburb: true, latitude: true, longitude: true } }),
  ]);
  const centres = suburbCentres(properties);
  const rows: HomeAddressRow[] = [];
  const pins: HomeAddressPin[] = [];
  for (const cleaner of cleaners) {
    const input = { address: cleaner.address ?? null, suburb: cleaner.suburb ?? null, latitude: cleaner.latitude ?? null, longitude: cleaner.longitude ?? null };
    const status = homeAddressStatus(input);
    const placement = homeAddressPinPlacement(input, centres);
    const name = cleaner.name?.trim() || cleaner.email;
    rows.push({
      id: cleaner.id,
      name,
      address: cleaner.address?.trim() || null,
      suburb: cleaner.suburb?.trim() || null,
      status,
      flag: status === "placed" ? null : HOME_ADDRESS_FLAG[status],
      onTheMap: onTheMapWords(status, placement),
      transport: TRANSPORT_WORDS[cleaner.preferredTransport] ?? "Not recorded",
      accountHref: `/v2/admin/accounts/users/${cleaner.id}`,
    });
    if (placement) {
      pins.push({
        cleanerId: cleaner.id,
        initials: pinInitials(name),
        name,
        suburb: cleaner.suburb?.trim() || "Suburb not recorded",
        lat: placement.lat,
        lng: placement.lng,
        suburbOnly: status === "suburb_only",
        basis: placement.basis,
      });
    }
  }
  const count = (status: HomeAddressStatus) => rows.filter((row) => row.status === status).length;
  return {
    rows,
    pins,
    counts: {
      active: rows.length,
      placed: count("placed"),
      noAddress: count("suburb_only") + count("nothing"),
      suburbOnly: count("suburb_only"),
      notFound: count("not_found"),
      attention: rows.filter((row) => needsAttention(row.status)).length,
    },
  };
}

/**
 * One activity-log row per opening (owner default 2026-11-17, pending
 * confirmation): who opened it and when, never the addresses. The actor is
 * the real signed-in person; while testing as someone the tested account is
 * noted too.
 */
export async function recordHomeAddressesViewed(input: { actorId: string; effectiveUserId: string; activeCleaners: number }): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.actorId,
      action: "CLEANER_HOME_ADDRESSES_VIEWED",
      entity: "CleanerHomeAddresses",
      entityId: "list",
      after: {
        activeCleaners: input.activeCleaners,
        ...(input.effectiveUserId !== input.actorId ? { testingAs: input.effectiveUserId } : {}),
      },
    },
  });
}
