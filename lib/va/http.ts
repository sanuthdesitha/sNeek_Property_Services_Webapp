/**
 * Map the errors this feature throws onto HTTP status codes.
 *
 * Shared so every VA route answers the same way: the client-portal routes each
 * inline this mapping today, and four routes inlining five error names is how
 * one of them ends up returning 400 for an auth failure.
 */
export function vaTeamErrorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  switch (message) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "TEAM_NOT_FOUND":
    case "MEMBER_NOT_FOUND":
      return 404;
    case "EMAIL_IN_USE":
    case "PROPERTY_NOT_FOUND":
      return 409;
    default:
      return 400;
  }
}
