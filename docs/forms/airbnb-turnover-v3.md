# Airbnb turnover v3 — owner guide

A draft cleaner form for short-stay turnovers. It is quick for an honest cleaner and hard to fill in convincingly without doing the work. Every answer either proves something or sends the cleaner to a flow the app already has. It is **not live**. You review it and publish it yourself.

File: `docs/forms/airbnb-turnover-v3.json` (Forms library export format, one form, service type Airbnb turnover).

## Sections and what each proves

| # | Section | Shown when | Questions (required) | What it proves |
|---|---|---|---|---|
| 1 | Before you start | Always | 7 (7) | How they got in, the key/lockbox state on arrival (photo if wrong), and whether a guest was still there (with the time). Records whether there is a pool or spa. |
| 2 | Arrival evidence | Always | 8 (8) | Arrival video before anything is touched, 3 "before" photos, damage (Yes opens the damage report), guest items (sends them to Lost item found), mess level (Excessive: 3 photos plus the Extra pay request), smoke/party/pets/smell/pests/mould (photos). |
| 3 | Kitchen | Always | 11 (8) | Fridge, oven and microwave photographed with the doors open, dishwasher empty with the filter cleared, benches/sink/cooktop, bins with new liners. One rotating close-up. |
| 4 | Bathroom | Once per bathroom | 13 (10) | Toilet bowl **and** the base and floor behind it, shower glass/grout/drain, basin/mirror, towels and amenities, leaks (go to Maintenance), exhaust fan. Rotating close-up. |
| 5 | Bedroom | Once per bedroom | 11 (8) | Bed photo from the foot with all four corners plus a pillow close-up, protector stains, under the bed with a torch, items in drawers (Lost item found), final look from the doorway. Rotating close-up. |
| 6 | Living and dining | Always | 10 (6) | Under the cushions and under the sofa, remotes, pet hair (only if pets were reported on arrival), sofa beds (1 or 2, from the property's sofa-bed count). Rotating close-up. |
| 7 | Balcony and outdoor | Property has a balcony | 6 (6) | Floor, furniture and glass; butts, vape items or bottles (photo before clearing them); BBQ cleaned (photo) or the reason it was not. |
| 8 | Pool or spa | Cleaner answered Yes in section 1 | 2 (2) | Pool and surrounds photos; the pool gate shuts and latches by itself (NSW pool safety). |
| 9 | Supplies left | Property tracks stock | 11 (11) | Nine stock counts of what is left. A count below the line raises the existing urgent stock need (it orders nothing). Dishwasher tablets as a range. Supplies cupboard photo. |
| 10 | Linen | Always | 4 (4) | Dirty linen left behind (Yes needs a reason), clean spare sets left, linen cupboard photo. Points to Wrap up → Laundry handoff for the bag count. |
| 11 | Floors (do these last) | Always | 3 (2) | Vacuum then mop, back to the door; two corner/skirting close-ups. |
| 12 | Safety and lock-up | Always | 11 (11) | Smoke alarm, appliances off (each needs a confirm or a reason), air con, taps, windows, balcony door (balcony only), keys/fobs/remotes photo, lights, where the key went (lockbox photo with the code scrambled). |
| 13 | Guest-ready look | Always | 7 (5) | Living and kitchen from the listing angle, welcome items, and anything not as the listing shows. |
| 14 | Leave and sign off | Always | 7 (6) | Exit video on the same route as arrival, front door locked from outside, note to the office, optional unusual items, the declaration, signature. |

There are 111 questions in total, but a cleaner only sees the ones that apply. The 11 rotating close-ups (marked "Every 3rd/4th/5th clean") are not shown on every clean. On the first clean at a property all of them show; after that they spread out to about three a clean.

## Estimated time

Standard 2-bed, 1-bath with a balcony, nothing wrong: **37 photos** a clean, plus about 3 rotating close-ups and 2 walkthrough videos. Each extra bedroom adds 4 photos and each extra bathroom adds 6.

With the in-app camera that is about 4–5 minutes of photos and taps, most of it done while cleaning each room. On top of that come about 3 minutes of walkthrough video (arrival and exit). This has not been timed with a real cleaner on a phone, so time one real clean before you publish.

## Loophole → evidence

| Loophole | Cheapest evidence in v3 |
|---|---|
| Blamed for damage or mess that was already there | Arrival video before touching anything, 3 before photos, damage → existing damage report |
| Guest still inside / late checkout not recorded | Yes/No plus the time, and the Pause or continue tomorrow flow |
| Access, key or lockbox problems hidden | Answer with a reason and a photo when it is wrong; lockbox scrambled photo at exit |
| Guest items kept or binned | Arrival and bedroom questions send them to Lost item found |
| Over-time with no proof | "Excessive" mess needs 3 photos and an Extra pay request (office approves) |
| Smoking, party, pets not reported | Arrival list with required photos; balcony butts/bottles photo; pet hair check appears only when pets were reported |
| Fridge/oven/microwave "wiped" but not | One photo each, doors open, with AI criteria |
| Dishwasher left full or filter dirty | Yes/No with N/A; "No" needs a reason |
| Under beds and sofa skipped | Torch photo under each bed; cushions-lifted photo and under-sofa photo |
| Toilet base and behind skipped | Second toilet photo of the base and floor behind |
| Shower glass, grout, drain hair | Photo with the drain visible; rotating grout close-up |
| Bins not emptied or relined | Lids-open photo with new liners |
| Beds made with used linen | Corners-visible bed photo per bedroom plus a pillow close-up; AI flags slept-in creases |
| Stained protectors left | Yes/No with a stain photo |
| Spare linen run down | Spare sets count plus cupboard photo |
| Dirty linen count disagreeing with laundry | Not counted here; one count only, in Wrap up → Laundry handoff |
| Consumables run out | Stock counts raise the existing urgent stock need below the line |
| Appliances, taps, windows, balcony door left | Each needs a confirm or an explicit reason; device-style checks need "needs attention / not checked" plus a reason |
| Keys, remotes, fobs missing | Photo of the key spot |
| Not staged like the listing | Listing-angle photos (add example photos, below) and a "not as listed" question |
| Recycled photos from an earlier clean | In-app camera stamps time and address; the photo integrity checks flag reuse, duplicates and camera time outside the clock times |
| Same close-up every time | Rotating close-ups on different cycles |
| "Yes" always the easy answer | Problem questions are phrased so that Yes means a problem (and asks for more), while confirmations need a reason when the answer is No |
| Ticking without doing | Declaration plus signature; every section has at least one required photo or answer that is always shown |

## What changed from v1 / v2

- **v1** (`airbnb-turnover-v1`, the live form in the fixture) uses legacy `upload`, `textarea`, `inventory` and `laundry_confirm` types and lets checkboxes stand in for proof. It asks for photos without minimums or acceptance criteria, has no per-room repeat (one "Bedroom photo" for any number of bedrooms) and duplicates the laundry confirmation the Wrap up card now owns.
- **v2** (seed `Airbnb Turnover v2`, `lib/forms/seed-templates/airbnb-turnover.ts`, not in the fixture database) adds scoring and more checkboxes. It still has one photo per room type, free-text damage notes instead of the damage report, a supplies multiselect instead of counts, and its own laundry fields.
- **v3** replaces checkboxes with proof photos where it matters and repeats bedroom and bathroom sections per room. It uses the existing damage, lost-item, extra-pay, maintenance, pause and urgent-stock flows instead of collecting them as text. Stock is counted with the Stock count type, and laundry bags are left to the Laundry handoff card. It adds AI acceptance criteria on 37 photo questions, rotating close-ups, pool-gate safety, a declaration and an exit video. It owns its arrival, exception and sign-off sections, so nothing is injected on top.

## How to import and publish

1. **Import.** Either use Forms → Job forms → ⋯ → Import and choose `airbnb-turnover-v3.json` (it shows a preview, then creates a **Draft**), or run
   `npx tsx --tsconfig tsconfig.scripts.json scripts/seed/airbnb-turnover-v3.ts` (dry run), then add `--apply`. The script does the same import. It also links the nine stock counts to your inventory items by SKU, and running it again does nothing.
2. **Stock items.** If you used Import in the app, open each Stock count in section 9 (the names say "pick item") and choose the item. Until you do, those counts go to office review and no urgent need is raised.
3. **Example photos.** On the listing-angle and key photo questions, add the listing photo as an example (Example media). Example photos are the same for every property, so for exact angles make a property copy of the form.
4. **Test.** Use "Test as cleaner" with a 1-bed and a 3-bed/2-bath property. Then do one real clean with a trusted cleaner and time it.
5. **Publish** in the builder. Publishing makes v3 the live Airbnb turnover form and archives the previous global one (v1). Property-specific and job-specific forms are not changed, and jobs already submitted keep their old form. Nothing is published automatically.

## Recommended engine additions

These were **not** built. The form works without them; each would close a gap that the form can only partly close today.

1. **Camera-only capture per question.** Gallery picks are allowed and are not stamped. A "camera only" setting would stop old photos being uploaded.
2. **Minimum number of video clips, and a minimum video length.** A required video accepts one clip of any length.
3. **Randomised close-ups.** Rotation is a fixed cycle per property, and all cycles start together on the first clean. A random pick from a pool per clean would be harder to predict.
4. **More property facts for show/hide rules:** pool/spa, BBQ, pets allowed, linen service type, smart lock vs lockbox. Pool/spa is currently the cleaner's own answer.
5. **Number comparisons on property facts** (for example "more than 2 sofa beds"). Property rules are equality only, so v3 covers 1 or 2 sofa beds.
6. **Per-bed repeat** (beds per bedroom), not just per bedroom.
7. **Per-property example photos**, so the listing-angle photo can differ by property without copying the form.
8. **Per-property stock thresholds on the Stock count type.** Thresholds are the same for every property.
9. **Cross-checks between answers and other records**, such as spare linen sets against the property's linen buffer, or the arrival "guest items" answer against a lost-item record.
10. **A mid-stay variant** of the same form. There are no variants. Mid-stay uses its own form (the existing "Mid-stay refresh" template).
11. **AI checks on videos.** Acceptance criteria apply to photos only.
