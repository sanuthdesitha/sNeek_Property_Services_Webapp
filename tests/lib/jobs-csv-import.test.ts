// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_TEMPLATE, MAX_IMPORT_ROWS, parseCsv, previewImport, type ImportLookups } from "@/lib/jobs/csv-import";

const m = vi.hoisted(() => ({
  properties: vi.fn(), users: vi.fn(), transaction: vi.fn(), createOnce: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { property: { findMany: m.properties }, user: { findMany: m.users } } }));
vi.mock("@/lib/jobs/admin-create", () => ({ createAdminJobOnce: m.createOnce }));
import { applyJobImport, importFileKey, ImportKeyMismatchError, previewJobImport } from "@/lib/jobs/csv-import-server";

const lookups: ImportLookups = {
  properties: [
    { id: "p-bondi", name: "The Bondi Studio", isActive: true },
    { id: "p-twin-1", name: "Twin Flat", isActive: true },
    { id: "p-twin-2", name: "Twin Flat", isActive: true },
    { id: "p-old", name: "Old House", isActive: false },
  ],
  cleaners: [{ id: "u-jane", name: "Jane C.", email: "jane@example.com" }],
  jobTypes: ["AIRBNB_TURNOVER", "DEEP_CLEAN"],
};

describe("CSV parsing", () => {
  it("reads quoted cells, embedded commas, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"Bondi, North","He said ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["Bondi, North", 'He said "hi"']]);
  });
});

describe("CSV validation preview", () => {
  it("accepts the template and matches property, job type and cleaner exactly", () => {
    const preview = previewImport(IMPORT_TEMPLATE.replace("Coogee Terrace", "p-bondi"), lookups);
    expect(preview.kind).toBe("ok");
    if (preview.kind !== "ok") return;
    expect(preview.rows[0]).toMatchObject({
      line: 2, ok: true,
      values: { propertyId: "p-bondi", date: "2026-11-12", startTime: "10:00", dueTime: "14:00", jobType: "AIRBNB_TURNOVER", cleanerId: "u-jane", notes: "Guest arrives 15:00" },
    });
    expect(preview.rows[1].values).toMatchObject({ propertyId: "p-bondi", jobType: "DEEP_CLEAN", cleanerId: null });
  });

  it("refuses each bad row with every reason and never guesses", () => {
    const text = [
      "Property,Date,Start,Due,Job type,Cleaner",
      "Twin Flat,2026-11-12,10:00,09:00,Deep clean,",
      "Nowhere,2026-02-30,9am,,Window wash,bob@example.com",
      "Old House,2026-11-12,,,deep-clean,",
    ].join("\n");
    const preview = previewImport(text, lookups);
    if (preview.kind !== "ok") throw new Error("expected rows");
    expect(preview.rows.map((row) => row.ok)).toEqual([false, false, false]);
    expect(preview.rows[0].errors).toEqual(['More than one property is named "Twin Flat". Use the property id.', "Due time is before the start time."]);
    expect(preview.rows[1].errors).toEqual([
      'No property is named "Nowhere" (exact name or id).',
      'Date "2026-02-30" is not a real date written as YYYY-MM-DD.',
      'Start "9am" is not a time written as HH:mm.',
      'Unknown job type "Window wash".',
      'No active cleaner matches "bob@example.com" (exact email or name).',
    ]);
    expect(preview.rows[2].errors).toEqual(["Old House is inactive."]);
  });

  it("refuses a file without the required columns or with too many rows", () => {
    expect(previewImport("property,date\nA,2026-11-12", lookups)).toEqual({ kind: "error", message: expect.stringMatching(/missing: job_type/) });
    const many = ["property,date,job_type", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => "p-bondi,2026-11-12,DEEP_CLEAN")].join("\n");
    expect(previewImport(many, lookups)).toMatchObject({ kind: "error", message: expect.stringMatching(/import at most 200/) });
  });
});

describe("CSV import on the server", () => {
  const file = ["property,date,start,due,job_type,cleaner", "p-bondi,2026-11-12,10:00,14:00,AIRBNB_TURNOVER,jane@example.com", "Nowhere,2026-11-12,,,DEEP_CLEAN,"].join("\n");

  beforeEach(() => {
    vi.resetAllMocks();
    m.properties.mockResolvedValue(lookups.properties);
    m.users.mockResolvedValue(lookups.cleaners);
  });

  it("previews with the file's key and creates nothing", async () => {
    const preview = await previewJobImport(file);
    expect(preview.key).toBe(importFileKey(file));
    expect(preview.kind).toBe("ok");
    expect(m.createOnce).not.toHaveBeenCalled();
  });

  it("creates valid rows through the job-create service with a per-row receipt, and refuses the rest", async () => {
    m.createOnce.mockResolvedValue({ jobId: "job-1", jobNumber: "J-100", replayed: false });
    const key = importFileKey(file);
    const result = await applyJobImport(file, key, "admin");
    if ("error" in result) throw new Error(result.error);
    expect(result.rows).toEqual([
      { line: 2, outcome: "created", message: "Created.", jobId: "job-1", jobNumber: "J-100", assignCleanerId: "u-jane" },
      { line: 3, outcome: "refused", message: 'No property is named "Nowhere" (exact name or id).', jobId: null, jobNumber: null, assignCleanerId: null },
    ]);
    expect(m.createOnce).toHaveBeenCalledTimes(1);
    const [input, receipt] = m.createOnce.mock.calls[0];
    expect(input).toEqual({ propertyId: "p-bondi", jobType: "AIRBNB_TURNOVER", scheduledDate: "2026-11-12T00:00:00.000Z", startTime: "10:00", dueTime: "14:00" });
    expect(receipt).toMatchObject({ key: `${key}:2`, userId: "admin" });
  });

  it("a retry of the same file reports rows already created and does not assign again", async () => {
    m.createOnce.mockResolvedValue({ jobId: "job-1", jobNumber: "J-100", replayed: true });
    const result = await applyJobImport(file, importFileKey(file), "admin");
    if ("error" in result) throw new Error(result.error);
    expect(result.rows[0]).toMatchObject({ outcome: "already_created", jobId: "job-1", assignCleanerId: null });
  });

  it("refuses a file whose text no longer matches the checked key", async () => {
    await expect(applyJobImport(`${file}\n`, importFileKey(file), "admin")).rejects.toBeInstanceOf(ImportKeyMismatchError);
    expect(m.createOnce).not.toHaveBeenCalled();
  });
});
