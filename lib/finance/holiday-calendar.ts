import { createHash } from "node:crypto";
import { holidayCalendarSchema, type HolidayCalendar } from "./holiday-policy";
export const NSW_HOLIDAY_SOURCE = "https://www.nsw.gov.au/about-nsw/public-holidays";
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const text = (html: string) => html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Fail closed when the official table changes shape; never synthesize dates. */
export function parseNswHolidayCalendar(html: string, verifiedAt: string): HolidayCalendar {
  for (const table of html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? []) {
    const rows = Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map(row => Array.from(row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map(cell => text(cell[1])));
    const header = rows.findIndex(row => /holiday/i.test(row[0]) && row.slice(1).every(cell => /^20\d{2}$/.test(cell)));
    if (header < 0 || rows[header].length < 2) continue;
    const years = rows[header].slice(1).map(Number); const entries: HolidayCalendar["entries"] = []; let parent = "";
    for (const row of rows.slice(header + 1)) {
      if (row.length !== years.length + 1) throw new Error("Official holiday table has unexpected columns.");
      const name = /additional day/i.test(row[0]) ? `${parent} (additional day)` : row[0];
      if (!/additional day/i.test(row[0])) parent = row[0];
      for (let index = 0; index < years.length; index++) {
        const value = row[index + 1]; if (/not applicable|^[-–—]$|^$/i.test(value)) continue;
        const match = /(\d{1,2})\s+([A-Za-z]+)(?:\s+(20\d{2}))?/.exec(value);
        const month = match ? months.findIndex(name => name.toLowerCase() === match[2].toLowerCase()) : -1;
        if (!match || month < 0 || match[3] && Number(match[3]) !== years[index]) throw new Error("Unrecognized official holiday date.");
        entries.push({ date: `${years[index]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`, name, kind: /bank holiday/i.test(name) ? "BANK" : "STATEWIDE", startMinute: 0, endMinute: 1440 });
      }
    }
    if (years.some(year => entries.filter(row => row.date.startsWith(String(year)) && row.kind === "STATEWIDE").length < 8)) throw new Error("Official calendar is incomplete.");
    return holidayCalendarSchema.parse({ jurisdiction: "AU-NSW", sourceUrl: NSW_HOLIDAY_SOURCE, verifiedAt, years, entries, version: createHash("sha256").update(JSON.stringify({ years, entries })).digest("hex") });
  }
  throw new Error("Could not identify the official NSW holiday table.");
}
