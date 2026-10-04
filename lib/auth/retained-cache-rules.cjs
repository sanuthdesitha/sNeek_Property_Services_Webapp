// Shared with the worker upgrade browser fixture: these rules precede defaults.
module.exports = [{
  urlPattern: ({ sameOrigin, url: { pathname } }) => sameOrigin &&
    (pathname.startsWith("/_accounts/") || pathname === "/accounts" || pathname.startsWith("/api/auth/")),
  handler: "NetworkOnly",
  method: "GET",
}];
