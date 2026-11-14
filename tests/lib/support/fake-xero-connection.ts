/**
 * An in-memory stand-in for `db.xeroConnection` (one table, the Prisma calls
 * the Xero client makes: findFirst, findUnique, update, updateMany). Each call
 * yields to the event loop first, like a real database round trip, so two
 * concurrent callers interleave the way two requests would.
 */
export type FakeXeroRow = Record<string, unknown> & { id: string };

type Condition = unknown;

function matchesValue(actual: unknown, condition: Condition): boolean {
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) return actual instanceof Date && actual.getTime() === condition.getTime();
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    const ops = condition as Record<string, unknown>;
    if ("lt" in ops) return actual instanceof Date && ops.lt instanceof Date ? actual.getTime() < ops.lt.getTime() : Number(actual) < Number(ops.lt);
    if ("gt" in ops) return actual instanceof Date && ops.gt instanceof Date ? actual.getTime() > ops.gt.getTime() : Number(actual) > Number(ops.gt);
    if ("not" in ops) return !matchesValue(actual, ops.not);
    if ("in" in ops) return Array.isArray(ops.in) && ops.in.includes(actual);
  }
  return actual === condition;
}

export function matchesWhere(row: FakeXeroRow, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Record<string, unknown>[]).some((part) => matchesWhere(row, part));
    if (key === "AND") return (condition as Record<string, unknown>[]).every((part) => matchesWhere(row, part));
    return matchesValue(row[key], condition);
  });
}

function applyData(row: FakeXeroRow, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && "increment" in (value as Record<string, unknown>)) {
      row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function createFakeXeroConnectionTable(initial: FakeXeroRow[]) {
  const rows = initial.map((row) => ({ ...row }));
  const pick = (row: FakeXeroRow | undefined) => (row ? { ...row } : null);
  return {
    rows,
    table: {
      async findFirst(args: { where?: Record<string, unknown> } = {}) {
        await tick();
        return pick(rows.find((row) => matchesWhere(row, args.where)));
      },
      async findUnique(args: { where: Record<string, unknown> }) {
        await tick();
        return pick(rows.find((row) => matchesWhere(row, args.where)));
      },
      async update(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        await tick();
        const row = rows.find((candidate) => matchesWhere(candidate, args.where));
        if (!row) throw new Error("Record to update not found.");
        applyData(row, args.data);
        return { ...row };
      },
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        await tick();
        const matched = rows.filter((row) => matchesWhere(row, args.where));
        for (const row of matched) applyData(row, args.data);
        return { count: matched.length };
      },
    },
  };
}
