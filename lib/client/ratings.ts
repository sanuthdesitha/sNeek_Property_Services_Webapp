import crypto from "crypto";

const SECRET = process.env.RATING_TOKEN_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "sneek-rating";

export function buildRatingToken(jobId: string, clientId: string) {
  return crypto.createHmac("sha256", SECRET).update(`${jobId}:${clientId}`).digest("hex");
}
