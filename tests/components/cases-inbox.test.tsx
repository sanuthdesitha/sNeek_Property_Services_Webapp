import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { CaseComposer, defaultDraft, type ComposerDraft } from "@/components/v2/admin/cases/case-composer";
import { useCaseDetail } from "@/components/v2/admin/cases/use-case-detail";
import type { CaseDetail } from "@/components/v2/admin/cases/case-types";
import { toClientCaseView } from "@/lib/cases/service";

const detail = (patch: Partial<CaseDetail> = {}): CaseDetail => ({
  id: "c1", title: "Case", description: "", severity: "MEDIUM", status: "OPEN", slaBreachAt: null, caseType: "DAMAGE",
  clientVisible: false, clientCanReply: true, resolutionNote: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
  source: null, jobId: null, reportId: null, clientId: null, propertyId: null, comments: [], attachments: [], ...patch,
});

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial, onSend, caseDetail }: { initial: ComposerDraft; onSend: (draft: ComposerDraft) => void; caseDetail: CaseDetail }) {
  const [draft, setDraft] = React.useState(initial);
  return <CaseComposer detail={caseDetail} draft={draft} onDraft={setDraft} sending={false} uploading={false} onSend={() => onSend(draft)} onAttach={() => undefined} />;
}

describe("composer", () => {
  it("defaults to an internal note when the client cannot see the case and says where a reply goes", () => {
    expect(defaultDraft({ clientVisible: false }).isInternal).toBe(true);
    expect(defaultDraft({ clientVisible: true }).isInternal).toBe(false);
    const onSend = vi.fn();
    render(<Harness initial={{ body: "", isInternal: false }} onSend={onSend} caseDetail={detail()} />);
    expect(screen.getByText(/The client cannot see this case/)).toBeInTheDocument();
  });

  it("Internal note sends isInternal true; Insert template uses the case type's resolution template", () => {
    const onSend = vi.fn();
    render(<Harness initial={{ body: "", isInternal: false }} onSend={onSend} caseDetail={detail({ clientVisible: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Internal note" }));
    fireEvent.click(screen.getByRole("button", { name: /Insert template/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith({ isInternal: true, body: expect.stringContaining("reviewed the reported damage") });
    expect(screen.getByText(/Internal notes are only visible to the office/)).toBeInTheDocument();
  });
});

describe("client view", () => {
  it("never includes an internal note (client-facing view unchanged)", () => {
    const view = toClientCaseView({
      comments: [
        { id: "1", body: "public", isInternal: false, createdAt: new Date(), author: null },
        { id: "2", body: "internal", isInternal: true, createdAt: new Date(), author: null },
      ],
      attachments: [],
      transitions: [],
    } as never);
    expect(view.comments.map((c: { body: string }) => c.body)).toEqual(["public"]);
  });
});

describe("opening cases", () => {
  it("a late response for the previous case never fills the newly opened one", async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    vi.stubGlobal("fetch", vi.fn((url: string) => new Promise((resolve) => resolvers.set(url, resolve))));
    const respond = (url: string, body: unknown) => resolvers.get(url)?.({ ok: true, json: async () => body });
    const { result, rerender } = renderHook(({ id }) => useCaseDetail(id), { initialProps: { id: "a" as string | null } });
    rerender({ id: "b" });
    await act(async () => {
      respond("/api/admin/cases/b", detail({ id: "b", title: "B" }));
      respond("/api/admin/cases/a", detail({ id: "a", title: "A" }));
    });
    await waitFor(() => expect(result.current.detail?.id).toBe("b"));
    expect(result.current.detail?.title).toBe("B");
  });

  it("accept() ignores a saved case that is no longer the open one", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.endsWith("/linked") ? {} : detail({ id: "b" })) })));
    const { result } = renderHook(() => useCaseDetail("b"));
    await waitFor(() => expect(result.current.status).toBe("success"));
    act(() => result.current.accept(detail({ id: "a", title: "Other" })));
    expect(result.current.detail?.id).toBe("b");
  });
});
