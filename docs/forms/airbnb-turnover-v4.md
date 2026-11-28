# Airbnb Turnover v4 — Hotel standard — owner guide

A rebuilt cleaner form for short-stay turnovers, written from scratch after the guest complaints: missed hidden areas, beds, restock misses (a guest with no toilet paper), weak evidence photos, maintenance not noted, and a clean done at a property nobody had stayed in. Every complaint now has a question that catches it (table below). It is **not live**. It is imported as a **Draft**; you review it and publish it yourself. Nothing is published automatically, and v3 is not changed.

File: `docs/forms/airbnb-turnover-v4.json` (Forms library export format, one form "Airbnb Turnover v4 — Hotel standard", service type Airbnb turnover, tags v4 / Airbnb / Hotel standard / Needs review).

## Sections

"Questions" counts every question a cleaner can be asked in the section, including follow-ups that only appear after a problem answer (instructions are not counted). "Photos every clean" is the minimum number of photos the section always asks for; "on a problem answer" photos are extra.

| # | Section | Shown when | Questions (required) | Photos every clean | What it catches |
|---|---|---|---|---|---|
| 1 | Before you start | Always | 11 (11) | 0 (2 photo questions on a problem answer) | Access, the guest lockbox state (photo if wrong), guest still there (time, Pause), **looks like nobody stayed** (stop, ask the office with + → Looks unused, 2 photos, the office's answer and who gave it), pool or spa. |
| 2 | Arrival evidence | Always | 10 (10) | 4 (+ video) | Full arrival video before anything is touched (ceiling, walls, floor in each room, appliances open), 3 before photos, damage (opens the damage report; bag and keep stained items 40 days), guest items, mess level (Excessive: 3 photos + Extra pay request), smoke/party/pets/smell/pests/mould (photos), TV and electronics working, TV switched on. |
| 3 | Devices and plants | Always (plants: properties marked with live plants) | 6 (6) | 0 (1 at plants properties) | Ring camera and Minut sensor checked and charged (device checks: needs attention, absent or not checked each need a reason); plants soil checked and a plant photo where the property is marked with live plants. |
| 4 | Kitchen | Always | 18 (18) | 12 | Fridge with the drawers out, microwave, oven and dishwasher filter (4 photos), benches and splashback, **sink drain and tap base close-up**, kettle/coffee/toaster, cutlery and plates, pot/pan/glass cupboards, every item checked by hand, bin bag fitted neatly, six ticks (splashback, top of the microwave, tap fittings, fronts, under the sink, set-out items). Two rotating close-ups. |
| 5 | Bathroom | Once per bathroom | 17 (17) | 11 | Toilet seat underside, bowl, base and floor corners (3), shower glass dry, grout, drain (3), **the shower seal strip close-up**, black mould gone (photo and note if not), basin with drain cap lifted and mirror, inside the cabinet, towels and **spare toilet rolls**, leaks, five ticks (under the lid, corners by hand, glass dry every clean, fan and bin, floor last). One rotating close-up. |
| 6 | Bedroom | Once per bedroom | 14 (14) | 6 | **Mattress protector before the new sheets**, protector stains (photo, replace, bag and keep), bed made hotel standard (2), under the bed with a torch, inside the wardrobe and drawers, items found, five ticks (bedside inside the drawer, lamps under the base and inside the shade, frames and switches, window tracks, skirting), final look. One rotating close-up. |
| 7 | Living and dining | Always | 14 (14) | 4 | Sofa cushions lifted and under the sofa (2), **behind the sofa**, sliding door track, remotes, pet hair (only if pets were reported on arrival), sofa beds (1 or 2), six ticks (corners by hand, lamp shades, glass, sills, **every cupboard opened**, table and covers). One rotating close-up. |
| 8 | Laundry and cleaner's cupboard | Always | 8 (8) | 4 | Washer and dryer, guest detergent (low or none: report with + → Urgent stock), dirty linen left, bag count pointer to Wrap up, spare sets, linen cupboard, vacuum emptied, cleaner's cupboard locked. |
| 9 | Balcony and outdoor | Property has a balcony | 6 (6) | 2 | Floor, corners, drain, furniture as listed, glass; butts or bottles (photo before clearing); BBQ. |
| 10 | Pool or spa | Cleaner answered Yes in section 1 | 2 (2) | 2 | Pool and surrounds; the gate latches by itself. |
| 11 | Supplies | Always | 3 (3) | 1 | **Anything low or run out** (which items, and report it now with + → Urgent stock), **toilet paper proof: spare rolls in each bathroom**. |
| 12 | Stock counts | Property tracks stock | 11 (11) | 1 | The same nine stock counts and thresholds as v3 (a low count raises the existing urgent stock need; it orders nothing), dishwasher tablets, supplies cupboard. |
| 13 | Floors — do these last | Always | 3 (3) | 2 | Vacuum then mop back to the door, two corner close-ups, entry mat. |
| 14 | Final check — walk every room again | Always | 10 (10) | 3 | **A second walk through every room after the final mop**, four ticks (no hair, glass, staging, supplies), living and kitchen from the listing angle, welcome items, anything not as listed. |
| 15 | Safety and lock-up | Always | 11 (11) | 1 (+1 lockbox photo) | As v3: smoke alarm, appliances, air con, taps, windows, balcony door (balcony only), keys and fobs photo, lights, where the key went (lockbox scrambled photo). |
| 16 | Leave and sign off | Always | 9 (8) | 1 (+ video) | Final video on the arrival route, front door locked from outside, **maintenance noticed** (what and where, and log it with + → Maintenance issue — a note alone is not enough), note to the office, optional unusual items, declaration, signature. |

153 questions in total; a cleaner only sees the ones that apply. Ticks are required questions. Whether a missing tick **blocks** submission depends on Settings › Accountability › "Required tick-boxes block submit" (off by default); with it off, an unticked box does not block submission.

The owner's spec numbers sections 1–15; "Supplies" is split into the always-shown part (11) and the stock-tracked counts (12) because a show/hide rule applies to a whole section.

## Photos and time

Standard **2-bed, 1-bath with a balcony**, property tracks stock, key back in a lockbox, nothing wrong: **59 photos** a clean, plus 2 walkthrough videos and about 1–2 rotating close-ups (6 in total, on 3- and 4-clean cycles; all show on the first clean at a property). A property marked with live plants adds 1 photo. Each extra bedroom adds **6** photos, each extra bathroom **11**.

v3 asked for 37. The extra photos are the complaint areas (protector, seal strip, sink drain, cupboards, behind the sofa, toilet paper, vacuum, TV, final walk). With the in-app camera that is roughly 7–9 minutes of photos and taps, mostly done while cleaning each room, plus about 3–4 minutes of video. This has **not** been timed with a real cleaner; time one real clean before you publish, and drop photos you do not need in the builder first.

## Complaint or missed area → the question that now catches it

| Complaint or missed area | Where v4 catches it |
|---|---|
| Clean done at a property nobody stayed in | 1 › "Does it look like nobody stayed?" → STOP, + → Looks unused — ask the office (the office answers in Approvals), 2 photos, the office's answer and who gave it |
| Guest had no toilet paper | 5 › towels photo needs spare rolls in view; 11 › "Is anything low or run out?" (report now) and the toilet paper proof photo, on every clean, stock tracked or not; 12 › toilet paper count below 4 raises the urgent need |
| Restock misses in general | 11 › low supplies with Urgent stock now; 8 › guest detergent; 4 › set-out items tick; 12 › stock counts |
| Beds not hotel standard | 6 › protector photo before sheets, bed photo from the foot plus pillows, "tight, almost no wrinkles" in the AI criteria |
| Stained protectors left on | 6 › protector photo before sheets and the stain question (replace, bag and keep) |
| Hair left behind | 5 › floor tick, toilet corners by hand; 6 › wardrobe and drawers photo; 14 › "No hair anywhere" tick on the final walk |
| Black mould in the shower | 5 › seal strip close-up, "all black mould gone?" (photo and note if not), rotating grout close-up |
| Sink drain and tap base grime | 4 › drain cap lifted and tap base close-up; 5 › basin with drain cap lifted |
| Dirty dishes put back by guests | 4 › "Checked every pot, pan, glass, plate and cutlery by hand?" plus cupboard and cutlery photos |
| Fridge drawers, microwave top, splashback missed | 4 › fridge with drawers out, microwave top and splashback ticks |
| Hidden areas: behind the sofa, under beds, cupboards, wardrobe tops, TV unit | 6 › under the bed with a torch, wardrobe; 7 › behind the sofa, cushions lifted, every cupboard opened; rotating close-ups (wardrobe top, TV unit, rangehood, under the toaster) |
| Lamps, frames, sills, skirting, door tracks | 6 and 7 › ticks, sliding door track photo |
| Weak evidence photos | Required minimums on every photo, AI acceptance criteria on 50 photo questions, an arrival video that must cover ceiling, walls and floor in every room, the same route on the final video |
| Maintenance issues not noted | 2 › electronics working; 5 › leaks and mould; 16 › "Any maintenance issue noticed?" needs what and where, and tells the cleaner to log it with + → Maintenance issue |
| Plants dying or overwatered | 3 › soil checked (water only if dry) and a photo, at properties marked with live plants; the start-of-clean briefing also reminds the cleaner |
| Rushed finish | 14 › the second walk through every room after the final mop |
| Damage blamed on the cleaner | 2 › arrival video, before photos, damage opens the damage report; stained items bagged and kept 40 days |
| Ring and Minut not charged | 3 › device checks every clean; at Jackson properties the existing charging rule adds a charging proof photo when the answer is Yes |

## What changed from v3

- New: looks-unused stop, guest lockbox state with a "no lockbox" answer, TV and electronics, devices and plants section, sink drain and tap base, hand-check of every item, mattress protector before sheets, seal strip and mould, inside the cabinet, behind the sofa and door track, detergent and vacuum, low supplies on every clean, toilet paper proof, the final walk-through, maintenance with the quick action.
- Kept: the damage report effect, Lost item found, Extra pay request, Maintenance issue, Pause, Urgent stock pointers, the nine stock counts with the same SKUs and thresholds, `repeatBy` bedrooms and bathrooms, sofa-bed rules, pool gate safety, lock-up, declaration and signature, `standardSections: false` with its own arrival and sign-off sections.
- Ticks are required in v4 (they were optional in v3).
- Fewer rotating close-ups (6 instead of 11), because the hidden areas they covered are now asked every clean.

## Devices

The Ring and Minut questions are yes/no device checks (`deviceStatus`), the same kind as the smoke alarm, so the existing device check recognises them: Yes means checked and charged; otherwise the cleaner chooses Needs attention, Absent or Not checked and gives a reason. They are shown at **every** property: there is no property fact yet for "this property has a Ring camera", so a property without one is answered "Absent" with a reason. They are deliberately not hidden by a rule, because the Jackson charging rule (`lib/forms/device-charging.ts`, which only applies to properties whose name starts with "Jackson") reuses an always-shown Ring/Minut check and adds a charging proof photo when the answer is Yes. Jackson Property 3's removed Ring camera is still taken out at read time.

## How to import and publish

1. **Import.** Either Forms → Job forms → ⋯ → Import and choose `airbnb-turnover-v4.json` (preview, then a **Draft** is created), or run
   `npx tsx --tsconfig tsconfig.scripts.json scripts/seed/airbnb-turnover-v4.ts` (dry run), then add `--apply`. The script does the same import, links the nine stock counts to your inventory items by SKU, and running it again does nothing.
2. **Stock items.** If you used Import in the app, open each Stock count in "Stock counts" (the names say "pick item") and choose the item.
3. **Live plants.** On each property with live plants, open the property › Checklist › Amenities and switch on "Live plants at this property". The plant questions and the start-of-clean reminder follow automatically.
4. **Example photos.** Add listing photos as examples on the listing-angle questions.
5. **Test.** "Test as cleaner" with a 1-bed and a 3-bed/2-bath property, with and without Live plants ticked. Then do one real clean with a trusted cleaner and time it.
6. **Publish** in the builder. Publishing makes v4 the live Airbnb turnover form and archives the previous global one. Property-specific and job-specific forms are not changed; submitted jobs keep their old form. Nothing is published automatically.

## Not built (engine limits)

The v3 list still applies: no camera-only capture, no video length or clip count, fixed rotation cycles, no pool/pets/BBQ/device property facts, equality-only property rules (1 or 2 sofa beds), no per-bed repeat, no per-property example photos or stock thresholds, no AI checks on video. Also: "one photo per bathroom" for the toilet paper proof is an instruction, not enforced per bathroom (the supplies section is not repeated per bathroom); the bathroom section's towels photo does require spare rolls in view in each bathroom.
