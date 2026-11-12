import { describe, expect, it } from "vitest";
import { ListQueryError, listResponse, parseListQuery } from "@/lib/admin/list-query";

const options = { sortable: ["number", "total"] as const, defaultSort: "number" as const, defaultDir: "desc" as const, maxPageSize: 50 };

describe("parseListQuery", () => {
  it("uses defaults when nothing is given, and treats blank values as absent", () => {
    expect(parseListQuery(new URLSearchParams(""), options)).toEqual({ page: 1, pageSize: 25, sort: "number", dir: "desc", skip: 0, take: 25 });
    expect(parseListQuery(new URLSearchParams("sort=&dir=&page="), options).sort).toBe("number");
  });

  it("reads page, size, sort and direction and derives skip/take", () => {
    expect(parseListQuery(new URLSearchParams("page=3&pageSize=10&sort=total&dir=asc"), options)).toEqual({
      page: 3, pageSize: 10, sort: "total", dir: "asc", skip: 20, take: 10,
    });
    expect(parseListQuery({ page: ["2"], sort: "total" }, options)).toMatchObject({ page: 2, sort: "total" });
  });

  it("refuses an unknown sort column instead of ignoring it", () => {
    expect(() => parseListQuery(new URLSearchParams("sort=password"), options)).toThrow(ListQueryError);
    try {
      parseListQuery(new URLSearchParams("sort=password"), options);
    } catch (error) {
      expect((error as ListQueryError).field).toBe("sort");
      expect((error as ListQueryError).status).toBe(400);
    }
  });

  it.each(["0", "-1", "1.5", "abc", "100001"])("refuses page=%s", (page) => {
    expect(() => parseListQuery(new URLSearchParams(`page=${page}`), options)).toThrow(ListQueryError);
  });

  it.each(["0", "51", "2x"])("refuses pageSize=%s outside the bound", (size) => {
    expect(() => parseListQuery(new URLSearchParams(`pageSize=${size}`), options)).toThrow(/pageSize/);
  });

  it("refuses an unknown direction", () => {
    expect(() => parseListQuery(new URLSearchParams("dir=sideways"), options)).toThrow(/dir/);
  });

  it("caps the default page size at the maximum", () => {
    expect(parseListQuery(new URLSearchParams(""), { ...options, defaultPageSize: 500 }).pageSize).toBe(50);
  });
});

describe("listResponse", () => {
  it("reports the real total and page count, not the page length", () => {
    const query = parseListQuery(new URLSearchParams("page=2&pageSize=10"), options);
    expect(listResponse(["a", "b"], 12, query)).toEqual({ rows: ["a", "b"], total: 12, page: 2, pageSize: 10, pageCount: 2, sort: "number", dir: "desc" });
    expect(listResponse([], 0, query).pageCount).toBe(1);
  });
});
