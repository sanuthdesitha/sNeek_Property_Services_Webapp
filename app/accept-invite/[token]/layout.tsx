import "@/app/v2/estate.css";

/**
 * Loads the Estate tokens for the invitation screens (board "Public and sign
 * in", 2026-11). The tokens are scoped by `data-skin="estate"`, so nothing
 * outside the invitation card changes. The URL stays /accept-invite/[token]:
 * it is in every invitation email and the middleware's public list.
 */
export default function AcceptInviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
