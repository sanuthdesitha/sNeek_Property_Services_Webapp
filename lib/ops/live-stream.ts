/**
 * The live-location stream's cursor (pure, unit-tested). Rows are read in
 * (receivedAt, id) order — the time the SERVER stored them — so a fix measured
 * earlier but flushed later is still streamed exactly once.
 */
export type StreamCursor = { receivedAt: Date; id: string };

export function initialStreamCursor(now: number): StreamCursor {
  return { receivedAt: new Date(now - 60_000), id: "" };
}

export function streamCursorWhere(cursor: StreamCursor) {
  return {
    OR: [
      { receivedAt: { gt: cursor.receivedAt } },
      { receivedAt: cursor.receivedAt, id: { gt: cursor.id } },
    ],
  };
}

export function advanceStreamCursor(cursor: StreamCursor, rows: Array<{ receivedAt: Date; id: string }>): StreamCursor {
  const last = rows[rows.length - 1];
  return last ? { receivedAt: last.receivedAt, id: last.id } : cursor;
}
