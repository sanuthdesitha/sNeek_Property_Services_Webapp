"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

let sharedSocket: Socket | null = null;

export function useWebSocket(options?: {
  autoConnect?: boolean;
  onJobUpdate?: (data: unknown) => void;
  onLocationPing?: (data: unknown) => void;
  onNotification?: (data: unknown) => void;
}) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = sharedSocket ?? io(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", {
      path: "/api/socket",
      withCredentials: true,
    });

    if (!sharedSocket) {
      sharedSocket = socket;
    }

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      setError(err.message);
      setConnected(false);
    });

    if (options?.onJobUpdate) {
      socket.on("job-update", options.onJobUpdate);
    }

    if (options?.onLocationPing) {
      socket.on("cleaner-location", options.onLocationPing);
    }

    if (options?.onNotification) {
      socket.on("notification", options.onNotification);
    }

    socketRef.current = socket;
  }, [options?.onJobUpdate, options?.onLocationPing, options?.onNotification]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setConnected(false);
    }
  }, []);

  const joinJob = useCallback((jobId: string) => {
    socketRef.current?.emit("join-job", jobId);
  }, []);

  const leaveJob = useCallback((jobId: string) => {
    socketRef.current?.emit("leave-job", jobId);
  }, []);

  const sendLocationPing = useCallback((data: { jobId: string; lat: number; lng: number }) => {
    socketRef.current?.emit("location-ping", data);
  }, []);

  useEffect(() => {
    if (options?.autoConnect !== false) {
      connect();
    }
    return () => {
      if (options?.autoConnect === false) return;
      // Don't disconnect on unmount — keep socket alive for SPA navigation
    };
  }, [connect, options?.autoConnect]);

  return {
    socket: socketRef.current,
    connected,
    error,
    connect,
    disconnect,
    joinJob,
    leaveJob,
    sendLocationPing,
  };
}
