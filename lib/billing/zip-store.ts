/**
 * A minimal ZIP writer, STORE method only (no compression): PDFs are already
 * compressed, and the repository has no zip dependency. Produces a standard
 * archive (local headers, data, central directory, end record) that any unzip
 * tool opens; tests/lib/zip-store.test.ts checks it with `unzip -t`.
 *
 * Limits: under 65,535 entries and 4 GiB (no ZIP64), which the callers' caps
 * keep far below. File names are stored as UTF-8 (general purpose bit 11).
 */

export type ZipEntry = { name: string; data: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date and time for the entry headers. */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const UTF8_FLAG = 0x0800;

function localHeader(name: Uint8Array, crc: number, size: number, stamp: { time: number; day: number }): Uint8Array {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, 0, true); // STORE
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.day, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function centralHeader(name: Uint8Array, crc: number, size: number, offset: number, stamp: { time: number; day: number }): Uint8Array {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true); // version made by
  view.setUint16(6, 20, true); // version needed
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.day, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function endRecord(count: number, centralSize: number, centralOffset: number): Uint8Array {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return record;
}

/**
 * The archive as a sequence of chunks, in order, so a route can stream it
 * without building one large buffer.
 */
export function zipChunks(entries: readonly ZipEntry[], modified: Date = new Date()): Uint8Array[] {
  if (entries.length >= 0xffff) throw new Error("Too many files for one archive.");
  const encoder = new TextEncoder();
  const stamp = dosDateTime(modified);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const header = localHeader(name, crc, entry.data.length, stamp);
    chunks.push(header, entry.data);
    central.push(centralHeader(name, crc, entry.data.length, offset, stamp));
    offset += header.length + entry.data.length;
    if (offset > 0xfffffffe) throw new Error("The archive is too large.");
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  return [...chunks, ...central, endRecord(entries.length, centralSize, offset)];
}

/** The whole archive in one buffer (tests and small archives). */
export function zipStore(entries: readonly ZipEntry[], modified?: Date): Uint8Array {
  const chunks = zipChunks(entries, modified);
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
