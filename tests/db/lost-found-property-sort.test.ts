// @vitest-environment node
/**
 * Wave E: Lost and found sorts by property name although the item stores
 * `propertyId` without a relation. Parity on a real, disposable PostgreSQL
 * (127.0.0.1:55439): every page, concatenated, equals the whole filtered set
 * sorted by property name (case-insensitive, items without a property last,
 * then found date and id), in both directions, with filters applied, and the
 * export (unpaged) agrees.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));

import { exportLostFoundRows, listLostFoundForOffice, parseLostFoundFilters } from "@/lib/lost-found/list";
import { parseListQuery } from "@/lib/admin/list-query";
import { LOST_FOUND_SORTS } from "@/lib/lost-found/list-options";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `lfsort-${randomUUID().slice(0, 8)}`;
const clientId = randomUUID();
const names = ["bravo House", "Alpha flat", "charlie Loft", "alpha Annex"];
const propertyIds = names.map(() => randomUUID());

describe.skipIf(!url)("lost and found property sort (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.client.create({ data: { id: clientId, name: `${tag} client` } });
    await m.client.property.createMany({ data: names.map((name, index) => ({ id: propertyIds[index], name: `${tag} ${name}`, clientId, address: `${index} Test St`, suburb: "Bondi" })) });
    const base = new Date("2026-11-01T00:00:00Z").getTime();
    // 3 items per property plus 3 with no property, found at distinct times.
    const rows = [...propertyIds, null].flatMap((propertyId, p) => [0, 1, 2].map((i) => ({
      itemName: `${tag} item ${p}-${i}`, propertyId, status: "REPORTED" as const, createdAt: new Date(base + (i * 5 + p) * 3_600_000),
    })));
    await m.client.lostFoundItem.createMany({ data: rows });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.lostFoundItem.deleteMany({ where: { itemName: { startsWith: tag } } });
    await m.client.property.deleteMany({ where: { id: { in: propertyIds } } });
    await m.client.client.deleteMany({ where: { id: clientId } });
    await m.client.$disconnect();
  });

  async function expectedOrder(dir: "asc" | "desc", onlyProperty?: string) {
    const items = await m.client.lostFoundItem.findMany({ where: { itemName: { startsWith: tag }, ...(onlyProperty ? { propertyId: onlyProperty } : {}) } });
    const nameOf = new Map(propertyIds.map((id, index) => [id, `${tag} ${names[index]}`.toLowerCase()]));
    return items.sort((a, b) => {
      const an = a.propertyId ? nameOf.get(a.propertyId)! : null;
      const bn = b.propertyId ? nameOf.get(b.propertyId)! : null;
      if (an !== bn) {
        if (an === null) return 1;
        if (bn === null) return -1;
        return dir === "asc" ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    }).map((item) => item.id);
  }

  async function allPages(search: string, pageSize: number) {
    const ids: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const params = new URLSearchParams(`${search}&page=${page}&pageSize=${pageSize}`);
      const response = await listLostFoundForOffice(parseLostFoundFilters(params), parseListQuery(params, { sortable: LOST_FOUND_SORTS, defaultSort: "found", defaultDir: "asc" }));
      ids.push(...response.rows.map((row) => row.id));
      if (page >= response.pageCount) {
        expect(response.total).toBe(ids.length);
        break;
      }
    }
    return ids;
  }

  it.each(["asc", "desc"] as const)("pages in %s order concatenate to the whole set sorted by property name", async (dir) => {
    expect(await allPages(`stage=all&q=${tag}&sort=property&dir=${dir}`, 4)).toEqual(await expectedOrder(dir));
  });

  it("keeps parity with a filter applied, and the export agrees with the pages", async () => {
    expect(await allPages(`stage=all&q=${tag}&sort=property&dir=asc&propertyId=${propertyIds[1]}`, 2)).toEqual(await expectedOrder("asc", propertyIds[1]));
    const params = new URLSearchParams(`stage=all&q=${tag}&sort=property&dir=desc`);
    const exported = await exportLostFoundRows(parseLostFoundFilters(params), parseListQuery(params, { sortable: LOST_FOUND_SORTS, defaultSort: "found", defaultDir: "asc" }));
    expect(exported.rows.map((row) => row.id)).toEqual(await expectedOrder("desc"));
  });
});
