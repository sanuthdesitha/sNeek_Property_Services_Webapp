import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { incomingStayDates, nextIncomingStay } from "@/lib/ical/stay-dates";
import { stayNights, stayDemand, longStayInstruction, suppliedFromLedger, stayPreparationPolicySchema } from "@/lib/inventory/stay-preparation-policy";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { stayPreparationPrintHtml, stayPreparationText } from "@/lib/inventory/stay-preparation-report";
function event(lines: string) { return new ICAL.Event(new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:incoming\r\n${lines}\r\nEND:VEVENT\r\nEND:VCALENDAR`)).getFirstSubcomponent("vevent")!); }
describe("incoming calendar stay",()=>{
 it.each([
  ["DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261016",15],
  ["DTSTART;TZID=Australia/Sydney:20261003T140000\r\nDTEND;TZID=Australia/Sydney:20261005T100000",2],
  ["DTSTART;TZID=Australia/Sydney:20260404T140000\r\nDTEND;TZID=Australia/Sydney:20260406T100000",2],
  ["DTSTART:20261001T140000Z\r\nDTEND:20261015T100000Z",13],
 ])("uses exclusive checkout calendar dates across DST: %s",(lines,nights)=>expect(stayNights(incomingStayDates(event(lines)))).toBe(nights));
 it("does not trust the parser's inferred end when DTEND is missing",()=>{ const dates=incomingStayDates(event("DTSTART;VALUE=DATE:20261001")); expect(dates).toEqual({});expect(stayNights(dates)).toBeNull(); });
 it.each([undefined,{}, {staySource:"ICAL",stayStartDate:"2026-02-30",stayEndDate:"2026-03-02"},{staySource:"ICAL",stayStartDate:"2026-10-05",stayEndDate:"2026-10-04"}])("retains unknown or invalid dates as unknown",context=>expect(stayNights(context as any)).toBeNull());
 it("round-trips incoming metadata without changing legacy history",()=>{const meta=parseJobInternalNotes("Existing notes");const context=incomingStayDates(event("DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261016"));expect(parseJobInternalNotes(serializeJobInternalNotes({...meta,reservationContext:context})).reservationContext).toMatchObject(context);expect(stayNights(parseJobInternalNotes("Old notes").reservationContext)).toBeNull();});
});
it("requires known guests and nights for consumption estimates, but supports fixed per-stay quantities",()=>{const rule={itemId:"paper",perStay:2,perGuestNight:0.25};expect(stayDemand(rule,4,15)).toBe(17);expect(stayDemand(rule,null,15)).toBeNull();expect(stayDemand(rule,4,null)).toBeNull();expect(stayDemand({...rule,perGuestNight:0},null,null)).toBe(2);});
it("only adds configured extra towels above fourteen nights",()=>{expect(longStayInstruction(14,4)).toBeNull();expect(longStayInstruction(15,4)).toContain("4 extra towels");expect(longStayInstruction(15,null)).toContain("Confirm");expect(longStayInstruction(null,4)).toContain("unknown");});
it("deduplicates actual ledger usage and never substitutes a forecast for missing actuals",()=>{const rows=[{id:"one",quantity:-3,txType:"USED"},{id:"one",quantity:-3,txType:"USED"},{id:"order",quantity:10,txType:"PURCHASED"}];expect(suppliedFromLedger(rows)).toBe(3);expect(suppliedFromLedger([])).toBeNull();});
it("rejects duplicate item rules and invalid towel quantities",()=>{const item={itemId:"paper",perStay:1,perGuestNight:1};expect(stayPreparationPolicySchema.safeParse({version:1,items:[item,item],extraTowels:4}).success).toBe(false);expect(stayPreparationPolicySchema.safeParse({version:1,items:[],extraTowels:-1}).success).toBe(false);});
it("exports dated planning truth and escapes report content",()=>{const plan={jobId:"<script>bad</script>",generatedAt:"2026-10-04",nights:null,guests:4,guestBasis:"PROPERTY_MAX",staySource:"UNKNOWN",startDate:null,endDate:null,towelInstruction:null,rows:[]} as any;expect(stayPreparationText(plan)).toContain("booking count unknown");expect(stayPreparationText(plan)).toContain("Unknown nights");expect(stayPreparationPrintHtml([plan])).not.toContain("<script>");expect(stayPreparationPrintHtml([plan])).toContain("&lt;script&gt;");});
it("converts UTC instants into property calendar dates instead of server dates",()=>{
 const dates=incomingStayDates(event("DTSTART:20261003T140000Z\r\nDTEND:20261005T120000Z"));
 expect(dates.stayStartDate).toBe("2026-10-04");expect(dates.stayEndDate).toBe("2026-10-05");expect(stayNights(dates)).toBe(1);
});

it("associates the nearest incoming booking, including a gap after turnover, without using the departing booking",()=>{const map=new Map([["2026-10-01","departing"],["2026-10-09","later"],["2026-10-06","next"]]);expect(nextIncomingStay(map,"2026-10-04")).toBe("next");expect(nextIncomingStay(map,"2026-10-06")).toBe("next");expect(nextIncomingStay(map,"2026-10-10")).toBeUndefined();expect(nextIncomingStay(new Map(),"2026-10-04")).toBeUndefined();});

it("matches incoming UTC bookings using their property calendar date, preserving existing scheduling keys",()=>{const booking={stayStartDate:"2026-10-04"};expect(nextIncomingStay(new Map([["2026-10-03",booking]]),"2026-10-04",value=>value.stayStartDate)).toBe(booking);});
