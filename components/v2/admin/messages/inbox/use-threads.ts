"use client";

/**
 * Client conversations: the list (`GET /api/admin/messages`), the open thread
 * (`GET /api/admin/messages?clientId=`, which marks the client's messages
 * read, as before) and replies (`POST /api/admin/messages`). Both refresh
 * every 10 seconds; a read for a thread that is no longer open is dropped.
 * A reply shows "Sending…" until the route answers, then the saved message;
 * a failed reply stays in the thread with its error and a Retry.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadMessage, ThreadSummary } from "@/lib/messages/thread-model";

const REFRESH_MS = 10_000;

export type LoadState = "loading" | "ready" | "failed";
export type OutboxEntry = { localId: string; clientId: string; body: string; createdAt: string; state: "sending" | "failed"; error: string | null };

type ListPayload = { clients?: ThreadSummary[]; messages?: ThreadMessage[]; error?: string };

export function useThreads(initialClientId: string | null) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [listState, setListState] = useState<LoadState>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialClientId);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadState, setThreadState] = useState<LoadState>("loading");
  const [threadError, setThreadError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const loadList = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/messages", { cache: "no-store", signal });
      const body = (await res.json().catch(() => ({}))) as ListPayload;
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(body.error ?? "Could not load conversations.");
      setThreads(Array.isArray(body.clients) ? body.clients : []);
      setListState("ready");
      setListError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setListError(err instanceof Error ? err.message : "Could not load conversations.");
      setListState((prev) => (prev === "loading" ? "failed" : prev));
    }
  }, []);

  const loadThread = useCallback(async (clientId: string, opts: { silent?: boolean; signal?: AbortSignal } = {}) => {
    if (!opts.silent) setThreadState("loading");
    try {
      const res = await fetch(`/api/admin/messages?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: opts.signal });
      const body = (await res.json().catch(() => ({}))) as ListPayload;
      // Check after parsing: the person may have opened another thread meanwhile.
      if (opts.signal?.aborted || selectedRef.current !== clientId) return;
      if (!res.ok) throw new Error(body.error ?? "Could not load this conversation.");
      setMessages(Array.isArray(body.messages) ? body.messages : []);
      if (Array.isArray(body.clients)) setThreads(body.clients);
      setThreadState("ready");
      setThreadError(null);
    } catch (err) {
      if (opts.signal?.aborted || selectedRef.current !== clientId) return;
      setThreadError(err instanceof Error ? err.message : "Could not load this conversation.");
      if (!opts.silent) setThreadState("failed");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadList(controller.signal);
    const timer = window.setInterval(() => {
      void loadList();
      if (selectedRef.current) void loadThread(selectedRef.current, { silent: true });
    }, REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadList, loadThread]);

  useEffect(() => {
    setMessages([]);
    if (!selectedId) return;
    const controller = new AbortController();
    void loadThread(selectedId, { signal: controller.signal });
    return () => controller.abort();
  }, [selectedId, loadThread]);

  async function deliver(entry: OutboxEntry) {
    setOutbox((prev) => prev.map((e) => (e.localId === entry.localId ? { ...e, state: "sending", error: null } : e)));
    try {
      const res = await fetch("/api/admin/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: entry.clientId, body: entry.body }) });
      const saved = (await res.json().catch(() => ({}))) as ThreadMessage & { error?: string };
      if (!res.ok) throw new Error(saved.error ?? "The message was not saved.");
      setOutbox((prev) => prev.filter((e) => e.localId !== entry.localId));
      if (selectedRef.current === entry.clientId) setMessages((prev) => [...prev, saved]);
      void loadList();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : "The message was not saved.";
      setOutbox((prev) => prev.map((e) => (e.localId === entry.localId ? { ...e, state: "failed", error } : e)));
      return false;
    }
  }

  function send(body: string): Promise<boolean> {
    const clientId = selectedRef.current;
    if (!clientId || !body.trim()) return Promise.resolve(false);
    const entry: OutboxEntry = { localId: `local-${Date.now().toString(36)}`, clientId, body, createdAt: new Date().toISOString(), state: "sending", error: null };
    setOutbox((prev) => [...prev, entry]);
    return deliver(entry);
  }

  return {
    threads,
    listState,
    listError,
    selectedId,
    select: setSelectedId,
    messages,
    threadState,
    threadError,
    reloadThread: () => selectedId && void loadThread(selectedId),
    reloadList: () => void loadList(),
    outbox: outbox.filter((e) => e.clientId === selectedId),
    send,
    retry: (entry: OutboxEntry) => deliver(entry),
    discard: (entry: OutboxEntry) => setOutbox((prev) => prev.filter((e) => e.localId !== entry.localId)),
  };
}

export type ThreadsState = ReturnType<typeof useThreads>;
