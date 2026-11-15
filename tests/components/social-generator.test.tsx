/**
 * Social post generator screens (2026-11-17): the review step never shows
 * "Posted" without the network's confirmation, keeps posting off until the
 * photos were looked at, names every destination in the tier A confirmation
 * and shows refusals with nothing sent; candidates show reasons and never
 * turn a failed read into "no photos"; the phone layout docks the step action;
 * the client's own permission card keeps choices after a failed save.
 */
import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView, CandidateList, GroupView } from "@/lib/marketing/social/view-types";

const phone = vi.hoisted(() => ({ value: false }));
vi.mock("@/components/v2/ui/use-phone", () => ({ useIsPhone: () => phone.value }));
vi.mock("@/components/v2/shared/own-pin-fields", () => ({ useOwnPinPrompt: () => ({ credentials: { pin: "1234" }, fieldProps: { status: "has-pin" }, reset: () => undefined }), OwnPinFields: () => null }));

import { GeneratorReview } from "@/components/v2/admin/marketing/social/generator-review";
import { GeneratorPhotos } from "@/components/v2/admin/marketing/social/generator-photos";
import { MarketingConsentCard } from "@/components/v2/client/marketing-consent-card";

const TZ = "Australia/Sydney";

function post(network: GroupView["posts"][number]["network"], overrides: Partial<GroupView["posts"][number]> = {}): GroupView["posts"][number] {
  return { postId: `post-${network}`, network, status: "DRAFT", deliveryMode: null, caption: "Checkout at 10. Next guests at 3.", hashtags: network === "INSTAGRAM" ? ["#guestready"] : [], scheduledFor: null, publishedAt: null, externalId: null, externalUrl: null, failureReason: null, failureCode: null, attemptCount: 0, removalNeededAt: null, removalDoneAt: null, metrics: null, ...overrides };
}

function group(overrides: Partial<GroupView> = {}): GroupView {
  return {
    id: "g1", title: "Bondi + Coogee, November", format: "CAROUSEL", status: "DRAFT", createdVia: "USER", ratio: "4:5", splitLayout: null, frameText: null, revision: 3,
    reviewedAt: "2026-11-17T00:39:00Z", reviewedByName: "Hannah", plannedFor: null, createdAt: "2026-11-17T00:30:00Z", updatedAt: "2026-11-17T00:41:00Z",
    photos: [
      { photoId: "p1", order: 0, role: "PHOTO", altText: "Bright living room", altHint: "Living room.", room: "Living", fieldLabel: "Final look", fieldKind: "LISTING", jobNumber: "J-2418", propertyName: "Bondi Beach House", beforeCheckedAt: null, refusal: null },
      { photoId: "p2", order: 1, role: "PHOTO", altText: "Made bed", altHint: "Bed.", room: "Bedroom", fieldLabel: "Final look", fieldKind: "LISTING", jobNumber: "J-2418", propertyName: "Bondi Beach House", beforeCheckedAt: null, refusal: null },
    ],
    posts: [post("INSTAGRAM"), post("FACEBOOK"), post("TIKTOK"), post("GOOGLE_BUSINESS"), post("LINKEDIN")],
    derivatives: [],
    ...overrides,
  };
}

const facebook: AccountView = { id: "a1", network: "FACEBOOK", displayName: "sNeek Property Services", status: "CONNECTED", statusReason: null, connectedByName: "Hannah", connectedAt: "2026-11-02T03:05:00Z", lastCheckAt: null, lastCheckResult: null, scopes: [], tokenExpiresAt: null, publishingLimit: null };

const fetchMock = vi.fn();
beforeEach(() => {
  phone.value = false;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("review and post", () => {
  it("keeps posting off until the photos were looked at and alt text is written", () => {
    render(<GeneratorReview group={group({ reviewedAt: null, photos: group().photos.map((photo, index) => ({ ...photo, altText: index ? "" : photo.altText })) })} accounts={{ state: "ready", accounts: [facebook], publicProblem: null, stubbed: false }} dirty={false} timeZone={TZ} onGroup={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText(/Tick "I looked at every photo" \(step 1, or below\)/)).toBeInTheDocument();
    expect(screen.getByText(/Alt text missing on photo 2/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Post to 1 network/ })[0]).toBeDisabled();
  });

  it("names every destination in the tier A confirmation and shows only what the network confirmed", async () => {
    const onGroup = vi.fn();
    render(<GeneratorReview group={group()} accounts={{ state: "ready", accounts: [facebook], publicProblem: null, stubbed: false }} dirty={false} timeZone={TZ} onGroup={onGroup} onError={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Post to 1 network…" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Facebook Page sNeek Property Services/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Not sent: Instagram, TikTok, Google Business Profile, LinkedIn page/)).toBeInTheDocument();
    const failed = group({ posts: [post("INSTAGRAM"), post("FACEBOOK", { status: "FAILED", deliveryMode: "API", failureReason: "Facebook refused: the sign-in was revoked or has expired (code 190). Reconnect in Social accounts. Nothing was posted on Facebook.", failureCode: "TOKEN_INVALID" }), post("TIKTOK"), post("GOOGLE_BUSINESS"), post("LINKEDIN")] });
    fetchMock.mockImplementation(() => respond({ results: [{ network: "FACEBOOK", outcome: "FAILED", message: "Facebook refused", externalUrl: null }], group: failed }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Post to 1 network" }));
    await waitFor(() => expect(onGroup).toHaveBeenCalledWith(failed));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/marketing/social/groups/g1/publish", expect.objectContaining({ method: "POST", body: JSON.stringify({ networks: ["FACEBOOK"] }) }));
  });

  it("a failed network says why and offers a retry; posted shows the network's link; never 'Posted' without an id", () => {
    const view = group({ posts: [
      post("INSTAGRAM", { status: "PUBLISHED", deliveryMode: "API", externalId: "18034567", externalUrl: "https://www.instagram.com/p/abc/" }),
      post("FACEBOOK", { status: "FAILED", deliveryMode: "API", failureReason: "Facebook refused (code 190). Nothing was posted on Facebook." }),
      post("TIKTOK", { status: "UNCONFIRMED", deliveryMode: "API", failureReason: "Not confirmed: check TikTok before retrying." }),
      post("GOOGLE_BUSINESS"), post("LINKEDIN"),
    ] });
    render(<GeneratorReview group={view} accounts={{ state: "ready", accounts: [facebook], publicProblem: null, stubbed: false }} dirty={false} timeZone={TZ} onGroup={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText("Posted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View post/ })).toHaveAttribute("href", "https://www.instagram.com/p/abc/");
    expect(screen.getByText(/code 190/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Facebook Page" })).toBeInTheDocument();
    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /I checked: it is not there/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download images + copy caption" }).length).toBeGreaterThanOrEqual(2);
  });

  it("an unreadable account list blocks posting with the reason, never as 'not connected'", () => {
    render(<GeneratorReview group={group()} accounts={{ state: "failed", message: "Server error." }} dirty={false} timeZone={TZ} onGroup={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText(/Connected accounts could not be loaded: Server error\. Nothing can be posted until they load\./)).toBeInTheDocument();
  });
});

const list: CandidateList = {
  from: "2026-10-16", to: "2026-11-15", ratio: "4:5",
  summary: { jobsCompleted: 41, qaPassedClean: 29, qaNotReviewed: 8, qaFailed: 3, openCase: 1, atPermission: 11, noPermission: 18, photosScored: 63, stillChecking: 5, usable: 2, leftOut: 1 },
  jobs: [{ jobId: "j1", jobNumber: "J-2418", propertyId: "pa", propertyName: "Bondi Beach House", suburb: "Bondi", bedrooms: 3, finishedOn: "2026-11-12", qaScore: 96, state: "usable", reason: null, permission: { givenByName: "Sarah Chen", method: "PORTAL", givenAt: "2026-10-03T05:22:00Z", allowSuburb: true, allowBefore: true }, counts: { usable: 2, listing: 1, before: 0, usedInPost: 0, leftOut: 1, checking: 0 } }],
  photos: [
    { photoId: "p1", jobId: "j1", jobNumber: "J-2418", propertyName: "Bondi Beach House", room: "Living", fieldLabel: "Final look", fieldKind: "LISTING", score: 91, scoreWord: "Strong", components: null, reasons: ["Sharp: fine detail high (Laplacian 412)"], leftOutReason: null, state: "usable", usedBefore: false, fits: ["4:5"], finishedOn: "2026-11-12" },
    { photoId: "p3", jobId: "j1", jobNumber: "J-2418", propertyName: "Bondi Beach House", room: "Benches and sink", fieldLabel: "Benches", fieldKind: "FINAL", score: 38, scoreWord: "Weak", components: null, reasons: [], leftOutReason: "Blurry (Laplacian 41, needs 120)", state: "left_out", usedBefore: false, fits: [], finishedOn: "2026-11-12" },
  ],
};
const filters = { days: 30, ratio: "4:5" as const, includeBefore: false, hideUsed: false, listingFirst: true };

describe("pick photos", () => {
  it("shows the score with reasons and the left-out reason in words", () => {
    render(<GeneratorPhotos load={{ state: "ready", list }} filters={filters} onFilters={vi.fn()} chosen={[]} onToggle={vi.fn()} onMove={vi.fn()} onCheckBefore={vi.fn()} reviewed={false} onReviewed={vi.fn()} onRetry={vi.fn()} onScoreNow={vi.fn()} scoring={false} frozen={false} />);
    expect(screen.getAllByText("Sharp: fine detail high (Laplacian 412)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blurry (Laplacian 41, needs 120)").length).toBeGreaterThan(0);
    expect(screen.getByText(/18 have no permission recorded/)).toBeInTheDocument();
    expect(screen.getByText(/I looked at every photo/)).toBeInTheDocument();
  });

  it("a failed read is a failure with Try again, never 'no photos'", () => {
    const retry = vi.fn();
    render(<GeneratorPhotos load={{ state: "failed", message: "Server error." }} filters={filters} onFilters={vi.fn()} chosen={[]} onToggle={vi.fn()} onMove={vi.fn()} onCheckBefore={vi.fn()} reviewed={false} onReviewed={vi.fn()} onRetry={retry} onScoreNow={vi.fn()} scoring={false} frozen={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Candidate photos could not be loaded.");
    expect(screen.queryByText(/No usable photos/)).not.toBeInTheDocument();
    expect(screen.getAllByText("–").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });

  it("on a phone the job list becomes a labelled selector", () => {
    phone.value = true;
    render(<GeneratorPhotos load={{ state: "ready", list }} filters={filters} onFilters={vi.fn()} chosen={[]} onToggle={vi.fn()} onMove={vi.fn()} onCheckBefore={vi.fn()} reviewed={false} onReviewed={vi.fn()} onRetry={vi.fn()} onScoreNow={vi.fn()} scoring={false} frozen={false} />);
    expect(screen.getByLabelText("Job")).toBeInTheDocument();
  });
});

describe("the client's own permission", () => {
  it("keeps the choices on screen when the save fails", async () => {
    fetchMock.mockImplementationOnce(() => respond({ properties: [{ id: "pa", name: "Bondi Beach House", suburb: "Bondi" }], consent: null }));
    render(<MarketingConsentCard />);
    const yes = await screen.findByLabelText(/Yes, sNeek may use photos of my properties/);
    fireEvent.click(yes);
    fireEvent.click(screen.getByLabelText(/You may name the suburb/));
    fetchMock.mockImplementationOnce(() => respond({ error: "Your choice was not saved." }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Save my choice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not saved/);
    expect(screen.getByLabelText(/Yes, sNeek may use photos/)).toBeChecked();
    expect(screen.getByLabelText(/You may name the suburb/)).toBeChecked();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ allow: true, propertyIds: ["pa"], allowSuburb: true, allowBefore: false });
  });
});
