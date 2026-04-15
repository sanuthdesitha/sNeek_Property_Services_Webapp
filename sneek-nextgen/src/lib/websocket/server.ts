import { Server as HttpServer } from "http";
import { Server, ServerOptions } from "socket.io";
import { auth } from "@/lib/auth";

let io: Server | null = null;

export function initSocketServer(
  httpServer: HttpServer,
  options?: Partial<ServerOptions>,
): Server {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin: process.env.APP_URL ?? "http://localhost:3000",
      credentials: true,
    },
    ...options,
  });

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const session = await auth();
      if (!session?.user) {
        return next(new Error("Unauthorized"));
      }
      socket.data.user = session.user;
      socket.data.tenantId = (session.user as { tenantId?: string }).tenantId;
      next();
    } catch {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as Record<string, unknown> | undefined;
    const tenantId = socket.data.tenantId as string | undefined;

    // Join tenant room for tenant-scoped broadcasts
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
    }

    // Join user room for direct messages
    if (user?.id) {
      socket.join(`user:${user.id}`);
    }

    // Join job room for job-specific updates
    socket.on("join-job", (jobId: string) => {
      socket.join(`job:${jobId}`);
    });

    socket.on("leave-job", (jobId: string) => {
      socket.leave(`job:${jobId}`);
    });

    // Cleaner location ping
    socket.on("location-ping", (data: { jobId: string; lat: number; lng: number }) => {
      io?.to(`job:${data.jobId}`).emit("cleaner-location", {
        userId: user?.id,
        ...data,
      });
    });

    socket.on("disconnect", () => {
      // Cleanup handled by Socket.io
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

// Helper to emit events from server-side code
export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

export function emitToTenant(tenantId: string, event: string, data: unknown): void {
  io?.to(`tenant:${tenantId}`).emit(event, data);
}

export function emitToJob(jobId: string, event: string, data: unknown): void {
  io?.to(`job:${jobId}`).emit(event, data);
}
