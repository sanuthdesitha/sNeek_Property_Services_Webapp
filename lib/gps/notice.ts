/**
 * The live-location notice a cleaner or laundry driver must acknowledge before
 * their first start (on the way / clock-in, or route start). Client-safe text
 * and version; the acknowledgement is stored server-side
 * (LocationTrackingNotice, lib/gps/notice-server). Raising the version asks
 * everyone again at their next start.
 */
export const LOCATION_NOTICE_VERSION = 1;

export type NoticePortal = "CLEANER" | "LAUNDRY";

export const NOTICE_PORTALS: readonly NoticePortal[] = ["CLEANER", "LAUNDRY"];

export type LocationNoticeText = {
  title: string;
  why: string;
  when: string[];
  who: string[];
  limits: string[];
};

export const LOCATION_NOTICE_TEXT: Record<NoticePortal, LocationNoticeText> = {
  CLEANER: {
    title: "Your location is shared while you work",
    why: "sNeek uses your phone's location to show the office where you are while you travel to and work on a job, to confirm you arrived at the right property, and to stop your clock if you leave the site with it running.",
    when: [
      "From when you tap \"On my way\" until you clock out of that job.",
      "Only on today's job. Never while your clock is stopped, and never on other days.",
      "Your phone shows \"Your location is being shared\" the whole time.",
    ],
    who: [
      "The office (administrators and operations managers).",
      "The client, only while you are on the way and only if the office has switched this on for that client. Your screen says so when it is on.",
      "Locations are kept for 7 days, then deleted. Clock-in and clock-out positions stay with the job's time records.",
    ],
    limits: [
      "Location is needed to start. If you turn it off during a job you can still finish; the office sees \"location off\" and it is needed again for your next start.",
      "Keep the app open while travelling: a phone stops sharing when the app is closed or in the background.",
    ],
  },
  LAUNDRY: {
    title: "Your location is shared during your route",
    why: "sNeek uses your phone's location to show the office where you are on your laundry route and to open each stop as you arrive.",
    when: [
      "From when you start today's route until you end it.",
      "Never outside an active route, and never on other days.",
      "Your phone shows \"Your location is being shared\" the whole time.",
    ],
    who: [
      "The office (administrators and operations managers with the laundry area).",
      "Locations are kept for 7 days, then deleted.",
    ],
    limits: [
      "Location is needed to start a route. If you turn it off during the route you can still finish your stops; the office sees \"location off\".",
      "Keep the app open while driving: a phone stops sharing when the app is closed or in the background.",
    ],
  },
};

export function isNoticePortal(value: unknown): value is NoticePortal {
  return value === "CLEANER" || value === "LAUNDRY";
}
