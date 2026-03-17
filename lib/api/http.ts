type ErrorLike = {
  message?: string;
  code?: string;
};

export function getApiErrorStatus(err: unknown, fallback = 400): number {
  const error = (err ?? {}) as ErrorLike;
  if (error.message === "UNAUTHORIZED") return 401;
  if (error.message === "FORBIDDEN") return 403;
  if (error.code === "P2025") return 404;
  return fallback;
}

